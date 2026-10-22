"""In-process token-bucket rate limiting (no extra dependency).

Scope keys are stable client identities (API token hash or remote IP). Suitable
for the single-process localhost deployment; Redis-backed limiting is the
documented upgrade path when the orchestrator is horizontally scaled.
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from collections.abc import Awaitable, Callable

from fastapi import Request

from problems import ProblemError


class _Bucket:
    __slots__ = ("rate", "burst", "tokens", "updated")

    def __init__(self) -> None:
        self.rate = 0.0
        self.burst = 1.0
        self.tokens = 0.0
        self.updated = 0.0


class RateLimiter:
    def __init__(self) -> None:
        self._buckets: dict[str, _Bucket] = {}
        self._lock = asyncio.Lock()

    def configure(self, per_minute: int, burst: int | None = None) -> None:
        self._per_minute = per_minute
        self._burst = burst or max(3, per_minute // 2)

    _per_minute: int = 10
    _burst: int = 5

    async def check(self, key: str) -> None:
        now = time.monotonic()
        async with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = _Bucket()
                bucket.rate = self._per_minute / 60.0
                bucket.burst = float(self._burst)
                bucket.tokens = bucket.burst
                bucket.updated = now
                self._buckets[key] = bucket
            elapsed = now - bucket.updated
            bucket.updated = now
            bucket.tokens = min(bucket.burst, bucket.tokens + elapsed * bucket.rate)
            if bucket.tokens < 1.0:
                raise ProblemError(429, "E_RATE_LIMIT")
            bucket.tokens -= 1.0
            # Opportunistic GC.
            if len(self._buckets) > 4096:
                cutoff = now - 3600
                for k in [k for k, b in self._buckets.items() if b.updated < cutoff]:
                    self._buckets.pop(k, None)

    @staticmethod
    def identity(request: Request) -> str:
        auth = request.headers.get("x-jarvis-secret") or request.headers.get("authorization", "")
        if auth:
            return "tok:" + hashlib.sha256(auth.encode()).hexdigest()[:16]
        ip = request.client.host if request.client else "unknown"
        return "ip:" + ip


limiter = RateLimiter()


def rate_limited(cap: int | None = None, burst: int | None = None) -> Callable[[Request], Awaitable[None]]:
    """FastAPI dependency applying the shared limiter."""
    async def _dep(request: Request) -> None:
        if cap is not None:
            limiter.configure(cap, burst)
        await limiter.check(RateLimiter.identity(request))
    return _dep
