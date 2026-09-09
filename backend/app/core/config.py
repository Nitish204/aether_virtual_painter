from functools import lru_cache
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from pydantic import field_validator
from pydantic_settings import BaseSettings

# Query string parameters asyncpg.connect() actually accepts. Anything
# else in a DATABASE_URL's query string gets dropped by
# Settings._ensure_async_driver rather than passed through — see that
# validator's docstring for why.
_ASYNCPG_ALLOWED_QUERY_PARAMS = {"ssl", "timeout", "server_settings", "target_session_attrs"}


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

    # Query string parameters asyncpg.connect() actually accepts.
    # Anything else in the URL's query string gets dropped rather than
    # passed through — see _ensure_async_driver for why.

    @field_validator("database_url")
    @classmethod
    def _ensure_async_driver(cls, v: str) -> str:
        """
        Neon's dashboard connection strings vary by which driver/framework
        tab you copy from, and can include parameters this app's driver
        doesn't understand at all:

        1. Scheme: plain "postgresql://" is the SYNC driver scheme. This
           app's async engine needs "postgresql+asyncpg://" explicitly —
           without it, SQLAlchemy defaults to importing psycopg2 (not
           installed here) and crashes on startup.

        2. Query params: psycopg2-style params like "sslmode=require" and
           "channel_binding=require" are libpq-level options with no
           asyncpg equivalent — confirmed directly against asyncpg's own
           connect() signature, neither exists as a parameter there at
           all. Passing either through crashes with "connect() got an
           unexpected keyword argument". Renaming "sslmode" to "ssl"
           fixed the first case, but Neon can (and did) add further
           params like "channel_binding" that have no asyncpg
           equivalent to rename to — so rather than chase each new
           parameter name one at a time, this now uses an explicit
           allow-list: only params asyncpg's connect() actually accepts
           survive, everything else is dropped silently. TLS itself
           isn't lost by dropping these — asyncpg negotiates TLS with
           Neon automatically; these params were only ever about
           certificate verification strictness, not whether TLS happens
           at all.
        """
        if v.startswith("postgresql://"):
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif v.startswith("postgres://"):
            v = v.replace("postgres://", "postgresql+asyncpg://", 1)

        if "+asyncpg" in v and "?" in v:
            parts = urlsplit(v)
            query_pairs = parse_qsl(parts.query, keep_blank_values=True)
            cleaned = []
            for key, val in query_pairs:
                if key == "sslmode":
                    key = "ssl"
                if key in _ASYNCPG_ALLOWED_QUERY_PARAMS:
                    cleaned.append((key, val))
            v = urlunsplit(parts._replace(query=urlencode(cleaned)))

        return v

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
