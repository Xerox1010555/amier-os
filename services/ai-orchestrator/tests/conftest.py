"""pytest fixtures — deterministic, offline, no real network calls."""
from __future__ import annotations

import os
import sys
import pathlib

SERVICE_DIR = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))

os.environ.setdefault("JARVIS_LLM_PROVIDER", "mock")
os.environ.setdefault("JARVIS_LLM_MODEL", "mock-1")
os.environ.setdefault("JARVIS_SHARED_SECRET", "test-secret")
os.environ.setdefault("JARVIS_REQUIRE_AUTH", "true")
os.environ.setdefault("JARVIS_PLANS_RATE_LIMIT", "100")

import pytest
from fastapi.testclient import TestClient

import config
from providers import reset_provider


@pytest.fixture()
def app_client():
    config.set_settings(config.Settings(
        provider="mock",
        model="mock-1",
        require_auth=True,
        shared_secret="test-secret",
        request_timeout_s=5,
        max_steps_per_plan=6,
        plans_rate_limit=100,
        cors_origins=(),
    ))
    reset_provider()
    # Reset the shared token bucket so tests never inherit each other's state.
    from ratelimit import limiter

    limiter._buckets.clear()
    limiter.configure(500, 100)
    from main import create_app

    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        assert os.environ["JARVIS_LLM_PROVIDER"] == "mock"
        yield client
    limiter._buckets.clear()
    reset_provider()


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"X-Jarvis-Secret": "test-secret"}
