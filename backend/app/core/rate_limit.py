"""
AETHER — Minimal fixed-window rate limiter.

Same implementation already verified in Nexus: only trusts
X-Forwarded-For when explicitly told to (settings.trust_proxy_headers),
since that header is attacker-controlled text otherwise, and prunes
stale entries so it doesn't grow unbounded in memory over time.
"""
from __future__ import annotations

import time
from collections import defaultdict

from fastapi import HTTPException, Request

from app.core.config import get_settings

settings = get_settings()
_SWEEP_INTERVAL_SECONDS = 600


class RateLimiter:
    def __init__(self, max_attempts: int, window_seconds: int):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._last_sweep = time.monotonic()

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < _SWEEP_INTERVAL_SECONDS:
            return
        window_start = now - self.window_seconds
        stale = [k for k, hits in self._hits.items() if not hits or max(hits) <= window_start]
        for k in stale:
            del self._hits[k]
        self._last_sweep = now

    def check(self, key: str) -> None:
        now = time.monotonic()
        self._sweep(now)
        window_start = now - self.window_seconds
        hits = [t for t in self._hits[key] if t > window_start]
        if len(hits) >= self.max_attempts:
            self._hits[key] = hits
            raise HTTPException(429, "Too many attempts. Please wait a few minutes and try again.")
        hits.append(now)
        self._hits[key] = hits


def _client_ip(request: Request) -> str:
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


login_limiter = RateLimiter(max_attempts=8, window_seconds=300)
signup_limiter = RateLimiter(max_attempts=5, window_seconds=3600)
save_drawing_limiter = RateLimiter(max_attempts=30, window_seconds=300)


def enforce(limiter: RateLimiter, request: Request, extra_key: str = "") -> None:
    limiter.check(f"{_client_ip(request)}:{extra_key}")
