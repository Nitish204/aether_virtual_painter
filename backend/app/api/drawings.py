from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlmodel import select, delete as sql_delete
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth import get_current_user_id, verify_csrf
from app.core.config import get_settings
from app.core.rate_limit import enforce, save_drawing_limiter
from app.db.models import Drawing
from app.db.session import get_session

router = APIRouter(prefix="/api/drawings", tags=["drawings"])
settings = get_settings()

VALID_TOOLS = {"draw", "line", "rectangle", "circle", "erase"}


class SaveDrawingBody(BaseModel):
    image_base64: str  # raw base64 payload, no "data:image/png;base64," prefix
    tool: str
    color: str
    thickness: int

    @field_validator("image_base64")
    @classmethod
    def check_size(cls, v: str) -> str:
        if len(v) > get_settings().max_drawing_base64_bytes:
            raise ValueError("Drawing is too large to save.")
        return v

    @field_validator("tool")
    @classmethod
    def check_tool(cls, v: str) -> str:
        if v not in VALID_TOOLS:
            raise ValueError("Unrecognized tool.")
        return v

    @field_validator("thickness")
    @classmethod
    def check_thickness(cls, v: int) -> int:
        if not (1 <= v <= 30):
            raise ValueError("Thickness out of range.")
        return v


class DrawingSummary(BaseModel):
    id: str
    tool: str
    color: str
    thickness: int
    created_at: str
    # Note: thumbnail/full image is fetched separately per drawing
    # (GET /api/drawings/{id}) rather than embedded in the list
    # response, so the gallery listing itself stays small and fast even
    # once a user has saved a lot of paintings.


@router.post("")
async def save_drawing(
    body: SaveDrawingBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
):
    verify_csrf(request)
    enforce(save_drawing_limiter, request, extra_key=user_id)

    drawing = Drawing(
        user_id=user_id, image_base64=body.image_base64,
        tool=body.tool, color=body.color, thickness=body.thickness,
    )
    session.add(drawing)
    await session.commit()
    await session.refresh(drawing)
    return {"id": drawing.id, "created_at": drawing.created_at.isoformat()}


@router.get("", response_model=list[DrawingSummary])
async def list_drawings(
    user_id: str = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
):
    result = await session.exec(
        select(Drawing).where(Drawing.user_id == user_id).order_by(Drawing.created_at.desc())
    )
    drawings = result.all()
    return [
        DrawingSummary(
            id=d.id, tool=d.tool, color=d.color, thickness=d.thickness,
            created_at=d.created_at.isoformat(),
        )
        for d in drawings
    ]


async def _get_owned_drawing(drawing_id: str, user_id: str, session: AsyncSession) -> Drawing:
    drawing = await session.get(Drawing, drawing_id)
    if not drawing or drawing.user_id != user_id:
        # Same object for "doesn't exist" and "exists but isn't yours" —
        # a 404 either way avoids leaking which drawing IDs are real.
        raise HTTPException(404, "Drawing not found.")
    return drawing


@router.get("/{drawing_id}")
async def get_drawing(
    drawing_id: str,
    user_id: str = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
):
    drawing = await _get_owned_drawing(drawing_id, user_id, session)
    return {
        "id": drawing.id,
        "image_base64": drawing.image_base64,
        "tool": drawing.tool,
        "color": drawing.color,
        "thickness": drawing.thickness,
        "created_at": drawing.created_at.isoformat(),
    }


@router.delete("/{drawing_id}")
async def delete_drawing(
    drawing_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
):
    verify_csrf(request)
    drawing = await _get_owned_drawing(drawing_id, user_id, session)
    await session.delete(drawing)
    await session.commit()
    return {"ok": True}
