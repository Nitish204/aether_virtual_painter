from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./aether.db"
    jwt_secret: str = "dev-secret-change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 14  # 14 days
    allowed_origins: str = "http://localhost:5173"
    cookie_secure: bool = False  # set True in production (HTTPS)

    # Same reasoning as Nexus: only trust X-Forwarded-For if a proxy you
    # control (Render, Railway, etc.) is guaranteed to overwrite it —
    # otherwise it's attacker-supplied text and rate limiting becomes
    # decorative. Set to true in production behind such a proxy.
    trust_proxy_headers: bool = False

    # Rough cap on a single saved drawing's base64-encoded PNG size, to
    # stop one user from filling the database with oversized uploads.
    # ~2MB base64 (~1.5MB raw PNG) is generous for a 640x480 canvas.
    max_drawing_base64_bytes: int = 2 * 1024 * 1024

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
