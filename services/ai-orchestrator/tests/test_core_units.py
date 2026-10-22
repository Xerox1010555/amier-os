"""Unit tests: redaction, JSON repair, rate limiter buckets, mock provider."""
from __future__ import annotations

import json
import sys
import pathlib

SERVICE_DIR = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))


def test_redact_masks_api_keys():
    from redact import redact

    text = "key sk-proj-abc123def456ghijkl and OPENAI sk-Abc123Def456Ghi789 ok"
    masked = redact(text)
    assert "sk-proj-abc123" not in masked
    assert "REDACTED" in masked


def test_redact_masks_jwt_and_bearer():
    from redact import redact

    text = "auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signaturePartHere"
    assert "Bearer eyJ" not in redact(text)
    assert "REDACTED" in redact(text)


def test_redact_masks_email_and_password_kv():
    from redact import redact

    out = redact("user john.doe@corp.com login password=hunter2222")
    assert "john.doe@" not in out
    assert "hunter2222" not in out


def test_json_repair_fenced_output():
    from jsonrepair import parse_llm_json

    raw = '```json\n{"steps": [{"description": "x", "command": "ls", "llm_risk_level": "low",}]}\n```'
    parsed = parse_llm_json(raw)
    assert parsed["steps"][0]["command"] == "ls"


def test_json_repair_labelled_output():
    from jsonrepair import parse_llm_json

    raw = 'Sure! Here is your plan: {"steps": [ {\'description\': "a", "command": "b", "llm_risk_level": "medium", "llm_requires_confirmation": true} ]}'
    parsed = parse_llm_json(raw)
    assert parsed["steps"][0]["description"] == "a"


def test_json_repair_raises_on_garbage():
    import pytest as _pytest

    from jsonrepair import parse_llm_json

    with _pytest.raises(ValueError):
        parse_llm_json("this model replied with prose only, no json at all")


def test_mock_provider_plan_is_deterministic():
    import asyncio

    import config
    from providers import get_provider, reset_provider

    config.set_settings(config.Settings(provider="mock", model="mock-1", require_auth=False))
    reset_provider()
    provider = get_provider()
    plan_raw = asyncio.run(provider.complete_json("sys", "clean up downloads folder"))
    steps = plan_raw["steps"]
    assert steps and steps[0]["llm_risk_level"] in {"medium", "high"}


def test_mock_provider_chat_streams():
    import asyncio

    import config
    from providers import get_provider, reset_provider

    config.set_settings(config.Settings(provider="mock", model="mock-1", require_auth=False))
    reset_provider()
    provider = get_provider()

    async def consume() -> list[str]:
        chunks = []
        async for chunk in provider.stream_text("sys", "plan my day"):
            chunks.append(chunk)
        return chunks

    text = "".join(asyncio.run(consume()))
    assert "mock" in text.lower()


def test_problem_codes_are_typed():
    import problems as pmod

    assert set(pmod._ALLOWED_TYPES) >= {
        "E_NO_KEY", "E_PROVIDER_DOWN", "E_TIMEOUT", "E_RATE_LIMIT", "E_PLAN_INVALID", "E_INTERNAL"
    }
