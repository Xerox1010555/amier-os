"""Auth + middleware hardening.

* Shared-secret auth (``X-Jarvis-Secret`` or ``Authorization: Bearer``) using
  constant-time comparison.
* Security-headers + request-id middleware on every response.
"""
from __future__ import annotations

import hmac
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.responses import Response

from config import get_settings
from problems import ProblemError

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Mining-Permitted": "no",
}


def extract_client_secret(request: Request) -> str | None:
    header = request.headers.get("x-jarvis-secret")
    if header:
        return header.strip()
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


async def require_auth(request: Request) -> None:
    settings = get_settings()
    if not settings.require_auth:
        return
    provided = extract_client_secret(request)
    if not provided or not settings.shared_secret or not hmac.compare_digest(
        provided.encode(), settings.shared_secret.encode()
    ):
        # Deliberately identical response shape for "absent" and "wrong" secret.
        raise ProblemError(401, "E_FORBIDDEN")


async def middleware_security_and_request_id(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    request.state.request_id = uuid.uuid4().hex
    rid = request.state.request_id
    response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers[key] = value
    response.headers["X-Request-Id"] = rid
    return response
