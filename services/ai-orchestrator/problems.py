"""RFC-7807 problem+json errors. Every client-facing failure is a typed,
user-safe problem document — raw exception strings and stack traces are NOT
repeated to callers (anti-regression rule #7)."""
from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_ALLOWED_TYPES = {
    "E_NO_KEY": "Authentication material is missing for the configured provider.",
    "E_PROVIDER_DOWN": "The language-model provider could not be reached.",
    "E_PROVIDER_ERROR": "The language-model provider returned an unrecoverable error.",
    "E_TIMEOUT": "The request exceeded the provider timeout.",
    "E_RATE_LIMIT": "Too many requests for this client identity.",
    "E_PLAN_INVALID": "The generated plan could not be validated.",
    "E_BAD_REQUEST": "The request body is malformed.",
    "E_FORBIDDEN": "The request identity is not authorised.",
    "E_NOT_FOUND": "The requested resource does not exist.",
    "E_INTERNAL": "An internal error occurred.",
}


class ProblemError(Exception):
    def __init__(self, status_code: int, code: str, detail: str | None = None) -> None:
        if code not in _ALLOWED_TYPES:
            raise ValueError(f"Unknown problem code {code}")
        self.status_code = status_code
        self.code = code
        self.type_uri = f"https://jarvis.local/problems/{code.lower()}"
        self.default_title = _ALLOWED_TYPES[code]
        self.detail = detail


def problem_response(
    status_code: int,
    code: str,
    detail: str | None,
    request: Request,
    extra: dict | None = None,
) -> JSONResponse:
    body: dict = {
        "type": f"https://jarvis.local/problems/{code.lower()}",
        "title": _ALLOWED_TYPES.get(code, "An error occurred."),
        "status": status_code,
        "code": code,
        "detail": detail,
        "instance": request.url.path,
    }
    if extra:
        body.update(extra)
    return JSONResponse(status_code=status_code, media_type="application/problem+json", content=body)


def _detail_for(exc: StarletteHTTPException) -> str:
    mapping = {
        401: "Missing or invalid authentication credentials.",
        403: "Access to this resource is not permitted for this identity.",
        404: "The requested resource does not exist.",
        405: "Method not allowed for this resource.",
        429: "Too many requests for this client identity.",
    }
    return mapping.get(exc.status_code, exc.detail if isinstance(exc.detail, str) else None or "")


async def problem_http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code_by_status = {
        401: "E_FORBIDDEN",
        403: "E_FORBIDDEN",
        404: "E_NOT_FOUND",
        405: "E_NOT_FOUND",
        429: "E_RATE_LIMIT",
    }
    code = code_by_status.get(exc.status_code, "E_INTERNAL")
    detail = exc.detail if isinstance(exc.detail, str) else None
    return problem_response(exc.status_code, code, detail or _detail_for(exc), request)


async def problem_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Report field errors without echoing the offending content wholesale.
    errors = []
    try:
        for err in exc.errors():
            errors.append({"loc": [str(loc) for loc in err.get("loc", [])], "msg": err.get("msg")})
    except Exception:  # never leak internals
        errors = [{"loc": [], "msg": "validation error"}]
    return problem_response(422, "E_BAD_REQUEST", "Request body failed validation.", request, {"errors": errors})


async def problem_unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    # Request id correlation lets ops find the full server-side log line.
    rid = getattr(request.state, "request_id", None) or ""
    return problem_response(500, "E_INTERNAL", "An internal error occurred.", request, {"request_id": rid})
