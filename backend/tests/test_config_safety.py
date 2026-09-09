"""
Regression tests for _validate_production_settings — the guard that
stops Aether from booting in production with settings that would
silently lose data (SQLite on an ephemeral filesystem) or leave auth
insecure (default JWT secret, cookies not marked Secure).

These test the function directly rather than through app startup,
since get_settings() is cached process-wide via lru_cache and importing
app.main already triggers it once for the whole test session.
"""
import pytest

from app.core.config import Settings, _validate_production_settings


def test_plain_postgresql_url_is_normalized_to_asyncpg():
    """
    Regression test for a real deploy failure: Neon's connection string
    starts with plain "postgresql://" (the sync driver format), which
    SQLAlchemy's async engine can't use — it needs "+asyncpg" explicitly,
    or it tries to import psycopg2 (not installed) and crashes on boot.
    """
    s = Settings(database_url="postgresql://user:pass@host.neon.tech/db?ssl=require")
    assert s.database_url == "postgresql+asyncpg://user:pass@host.neon.tech/db?ssl=require"


def test_postgres_short_scheme_is_also_normalized():
    s = Settings(database_url="postgres://user:pass@host/db")
    assert s.database_url == "postgresql+asyncpg://user:pass@host/db"


def test_already_correct_asyncpg_url_is_left_alone():
    s = Settings(database_url="postgresql+asyncpg://user:pass@host/db")
    assert s.database_url == "postgresql+asyncpg://user:pass@host/db"


def test_sqlite_url_is_left_alone():
    s = Settings(database_url="sqlite+aiosqlite:///./x.db")
    assert s.database_url == "sqlite+aiosqlite:///./x.db"


def test_sslmode_query_param_is_converted_to_ssl():
    """
    Regression test for a real deploy failure: Neon's dashboard gave a
    "sslmode=require" query param (psycopg2's name for it), but
    asyncpg.connect() has no "sslmode" parameter at all — confirmed
    directly against its function signature — only "ssl". Passing
    "sslmode" through crashed with "connect() got an unexpected keyword
    argument 'sslmode'" on every boot attempt.
    """
    s = Settings(database_url="postgresql://u:p@host.neon.tech/db?sslmode=require")
    assert s.database_url == "postgresql+asyncpg://u:p@host.neon.tech/db?ssl=require"


def test_already_correct_ssl_param_is_left_alone():
    s = Settings(database_url="postgresql+asyncpg://u:p@host/db?ssl=require")
    assert s.database_url == "postgresql+asyncpg://u:p@host/db?ssl=require"


def test_channel_binding_param_is_stripped():
    """
    Regression test for a real deploy failure: Neon's dashboard gave a
    connection string with BOTH "sslmode=require" AND
    "channel_binding=require". The first fix renamed "sslmode" to "ssl"
    but didn't account for "channel_binding" — another libpq-only
    parameter with no asyncpg equivalent at all (confirmed against
    asyncpg.connect()'s actual signature) — so the crash just moved to
    a different unexpected keyword argument instead of being fixed.
    This is exactly why the fix now uses an allow-list instead of
    renaming known-bad names one at a time: any parameter that isn't in
    _ASYNCPG_ALLOWED_QUERY_PARAMS gets dropped, regardless of what it's
    called or whether this specific test anticipated it.
    """
    s = Settings(database_url="postgresql://u:p@host.neon.tech/db?sslmode=require&channel_binding=require")
    assert s.database_url == "postgresql+asyncpg://u:p@host.neon.tech/db?ssl=require"


def test_development_settings_are_never_rejected():
    """The guard must stay out of the way entirely outside production —
    local dev and CI both rely on the SQLite + dev-secret defaults."""
    s = Settings(environment="development")
    _validate_production_settings(s)  # should not raise


def test_production_with_sqlite_is_rejected():
    s = Settings(
        environment="production", database_url="sqlite+aiosqlite:///./x.db",
        jwt_secret="a-real-random-secret", cookie_secure=True,
    )
    with pytest.raises(RuntimeError, match="SQLite in production"):
        _validate_production_settings(s)


def test_production_with_default_jwt_secret_is_rejected():
    s = Settings(
        environment="production", database_url="postgresql+asyncpg://u:p@host/db",
        jwt_secret="dev-secret-change-me-in-production", cookie_secure=True,
    )
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _validate_production_settings(s)


def test_production_with_insecure_cookie_is_rejected():
    s = Settings(
        environment="production", database_url="postgresql+asyncpg://u:p@host/db",
        jwt_secret="a-real-random-secret", cookie_secure=False,
    )
    with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
        _validate_production_settings(s)


def test_production_with_correct_settings_boots_cleanly():
    s = Settings(
        environment="production", database_url="postgresql+asyncpg://u:p@host/db",
        jwt_secret="a-real-random-secret", cookie_secure=True,
    )
    _validate_production_settings(s)  # should not raise
