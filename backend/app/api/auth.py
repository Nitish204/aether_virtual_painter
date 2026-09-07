from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import get_settings
from app.core.rate_limit import enforce, login_limiter, signup_limiter
from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_csrf_token,
    hash_password,
    verify_password,
)
from app.db.models import User
from app.db.session import get_session

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()

SESSION_COOKIE = "aether_session"
CSRF_COOKIE = "aether_csrf"


class SignupBody(BaseModel):
    email: EmailStr
    password: str


class LoginBody(BaseModel):
    email: EmailStr
    password: str


def _set_session_cookies(response: Response, user_id: str) -> None:
    token = create_access_token(user_id)
    csrf_token = generate_csrf_token()
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, secure=settings.cookie_secure,
        samesite="lax", max_age=settings.access_token_expire_minutes * 60,
    )
    # Deliberately NOT httponly — the frontend needs to read this to echo
    # it back as a header (double-submit CSRF pattern), the same
    # approach already used in Nexus.
    response.set_cookie(
        CSRF_COOKIE, csrf_token, httponly=False, secure=settings.cookie_secure,
        samesite="lax", max_age=settings.access_token_expire_minutes * 60,
    )


async def get_current_user_id(request: Request) -> str:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Not signed in.")
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(401, "Session expired — please sign in again.")
    return user_id


def verify_csrf(request: Request) -> None:
    csrf_cookie = request.cookies.get(CSRF_COOKIE)
    csrf_header = request.headers.get("x-csrf-token")
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(403, "CSRF check failed — please refresh the page and try again.")


@router.post("/signup")
async def signup(body: SignupBody, request: Request, response: Response, session: AsyncSession = Depends(get_session)):
    enforce(signup_limiter, request, extra_key=body.email.lower())

    existing = (await session.exec(select(User).where(User.email == body.email.lower()))).first()
    if existing:
        # Deliberately vague — confirming an email doesn't exist here
        # would let someone enumerate registered accounts.
        raise HTTPException(400, "Couldn't create that account. Try signing in instead.")

    user = User(email=body.email.lower(), password_hash=hash_password(body.password))
    session.add(user)
    await session.commit()
    await session.refresh(user)

    _set_session_cookies(response, user.id)
    return {"id": user.id, "email": user.email}


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response, session: AsyncSession = Depends(get_session)):
    enforce(login_limiter, request, extra_key=body.email.lower())

    user = (await session.exec(select(User).where(User.email == body.email.lower()))).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password.")

    _set_session_cookies(response, user.id)
    return {"id": user.id, "email": user.email}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    response.delete_cookie(CSRF_COOKIE)
    return {"ok": True}


@router.get("/me")
async def me(user_id: str = Depends(get_current_user_id), session: AsyncSession = Depends(get_session)):
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(401, "Not signed in.")
    return {"id": user.id, "email": user.email}
