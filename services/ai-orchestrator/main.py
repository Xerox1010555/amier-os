"""Jarvis OS AI Orchestrator — FastAPI application factory.

Local-first by default: binds to 127.0.0.1, requires a shared secret whenever a
real provider is configured, and returns RFC-7807 problem documents for errors.
"""
from __future__ import annotations

import logging
import time

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import get_settings
from metrics import REQUESTS_TOTAL, metrics_endpoint
from problems import (
    ProblemError,
    problem_http_handler,
    problem_response,
    problem_unhandled_handler,
    problem_validation_handler,
)
from routes import router
from security import SECURITY_HEADERS, middleware_security_and_request_id
from logging_setup import setup_logging

log = logging.getLogger("jarvis.main")


def create_app() -> FastAPI:
    setup_logging()
    settings = get_settings()

    app = FastAPI(
        title="Jarvis OS AI Orchestrator",
        version=_read_version(),
        docs_url=None,          # docs disabled: local surface stays minimal
        redoc_url=None,
        openapi_url=None,
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["X-Jarvis-Secret", "Authorization", "Content-Type"],
            max_age=600,
        )

    app.middleware("http")(middleware_security_and_request_id)

    @app.middleware("http")
    async def metrics_middleware(request: Request, call_next):
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            response = None
            raise
        finally:
            if response is not None:
                REQUESTS_TOTAL.labels(
                    method=request.method, path=request.url.path, outcome=str(response.status_code)
                ).inc()
        return response

    @app.exception_handler(StarletteHTTPException)
    async def _hp(request: Request, exc: StarletteHTTPException) -> Response:  # type: ignore[override]
        return await problem_http_handler(request, exc)

    @app.exception_handler(ProblemError)
    async def _pp(request: Request, exc: ProblemError) -> Response:
        return problem_response(exc.status_code, exc.code, exc.detail, request)

    @app.exception_handler(RequestValidationError)
    async def _vp(request: Request, exc: RequestValidationError) -> Response:
        return await problem_validation_handler(request, exc)

    @app.exception_handler(Exception)
    async def _up(request: Request, exc: Exception) -> Response:
        return await problem_unhandled_handler(request, exc)

    app.include_router(router)

    @app.get("/metrics", include_in_schema=False)
    async def metrics_route() -> Response:
        return await metrics_endpoint(None)  # type: ignore[arg-value]

    @app.get("/", include_in_schema=False)
    async def index() -> Response:
        return Response(
            content=json_brief(),
            media_type="application/json",
            headers=SECURITY_HEADERS,
        )

    return app


def json_brief() -> str:
    settings = get_settings()
    import json

    return json.dumps(
        {"service": "jarvis-ai-orchestrator", "version": _read_version(), "auth": settings.require_auth}
    )


def _read_version() -> str:
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent.parent
    try:
        return (root / "VERSION").read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


app = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(app, host=settings.bind_host, port=settings.port, log_level="info")
