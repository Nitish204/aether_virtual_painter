from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.core.config import get_settings

settings = get_settings()
engine = create_async_engine(
    settings.database_url,
    echo=False,
    # Same fix applied to Nexus after a real production incident: without
    # this, SQLAlchemy hands out pooled connections without checking
    # they're still alive first. Managed Postgres (Neon included)
    # silently drops idle connections after a period of inactivity —
    # normal on a low-traffic app where requests can be minutes apart.
    # The next request after any idle gap would get a dead connection
    # and crash. pool_pre_ping tests each connection before use and
    # transparently reconnects if it's gone; pool_recycle proactively
    # retires connections before they get old enough to be dropped.
    pool_pre_ping=True,
    pool_recycle=300,
)
async_session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session():
    async with async_session_maker() as session:
        yield session
