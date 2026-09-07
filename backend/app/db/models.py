import uuid
from datetime import datetime, timezone

from sqlmodel import SQLModel, Field


def new_id() -> str:
    return uuid.uuid4().hex


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    email: str = Field(unique=True, index=True)
    password_hash: str
    created_at: datetime = Field(default_factory=utc_now)


class Drawing(SQLModel, table=True):
    """
    A saved painting. `image_base64` stores the PNG directly in the
    database (base64-encoded) rather than in separate object storage —
    a deliberate simplicity trade-off: for a hobby-scale app, avoiding
    an S3/Cloudinary dependency (and the credentials that come with it)
    is worth it, and `max_drawing_base64_bytes` in config.py caps how
    much space any single save can take up.
    """
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    image_base64: str
    tool: str
    color: str
    thickness: int
    created_at: datetime = Field(default_factory=utc_now, index=True)
