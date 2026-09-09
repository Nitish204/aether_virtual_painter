import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


def new_id() -> str:
    return uuid.uuid4().hex


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# Bug fix: a plain `datetime` field with no explicit column type maps
# to Postgres's TIMESTAMP WITHOUT TIME ZONE by default. utc_now() (used
# as every created_at default) returns a timezone-AWARE datetime
# (datetime.now(timezone.utc)) — asyncpg refuses to encode an aware
# Python datetime into a naive Postgres column at all, so every single
# insert into User or Drawing crashed with "can't subtract offset-naive
# and offset-aware datetimes" before a single row could ever be saved.
# DateTime(timezone=True) makes SQLAlchemy create/expect a proper
# TIMESTAMPTZ column instead, which matches what utc_now() actually
# produces.
def _utc_datetime_field(index: bool = False) -> Field:
    return Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), index=index))


class User(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    email: str = Field(unique=True, index=True)
    password_hash: str
    created_at: datetime = _utc_datetime_field()


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
    created_at: datetime = _utc_datetime_field(index=True)
