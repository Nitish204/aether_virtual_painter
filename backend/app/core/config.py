from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
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


def _validate_production_settings(s: Settings) -> None:
    """
    Refuse to boot with settings that would silently break or lose data
    in production, rather than starting up "successfully" and failing
    in a confusing way later. This is what turns "no database was ever
    provisioned" from a silent data-loss trap into a startup error that
    says exactly what to fix.
    """
    if s.environment != "production":
        return

    problems = []
    if s.database_url.startswith("sqlite"):
        problems.append(
            "DATABASE_URL is SQLite in production. Render's (and most PaaS) "
            "filesystem is wiped on every redeploy, so every saved painting "
            "and every account would be silently deleted the next time you "
            "push a change. Provision a real Postgres database (Neon's free "
            "tier works well — see the README) and set DATABASE_URL to it."
        )
    if s.jwt_secret == "dev-secret-change-me-in-production":
        problems.append(
            "JWT_SECRET is still the default dev value in production — this "
            "lets anyone forge a valid login session. Generate a real one: "
            "python3 -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    if not s.cookie_secure:
        problems.append(
            "COOKIE_SECURE is false in production — session cookies will be "
            "sent over plain HTTP. Set COOKIE_SECURE=true."
        )
    if problems:
        raise RuntimeError(
            "Refusing to start with unsafe production settings:\n- " + "\n- ".join(problems)
        )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    _validate_production_settings(settings)
    return settings
