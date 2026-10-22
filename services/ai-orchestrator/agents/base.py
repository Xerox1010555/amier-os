"""LLM agents. Each agent is a thin, testable wrapper over ``Provider``.

Hard rules (anti-regression):
* LLM output is treated as untrusted data — validation happens in Pydantic.
* ``risk_level`` / ``requires_confirmation`` from the model is advisory only;
  the authoritative classification lives in the Rust security engine.
"""
from __future__ import annotations

import asyncio
import logging

from problems import ProblemError
from providers import Provider

log = logging.getLogger("jarvis.agents")

MAX_ATTEMPTS = 2
_RETRY_DELAY_S = 0.35


class Agent:
    """Common retry/observability behavior for all agents."""

    def __init__(self, provider: Provider) -> None:
        self.provider = provider

    async def _complete_json_with_retry(self, system: str, user: str, operation: str) -> dict:
        last_error: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                return await self.provider.timed_json(system, user, operation=operation)
            except ProblemError as exc:
                last_error = exc
                if exc.code in {"E_NO_KEY", "E_TIMEOUT"}:
                    raise
                if attempt < MAX_ATTEMPTS and exc.code in {"E_PROVIDER_DOWN"}:
                    await asyncio.sleep(_RETRY_DELAY_S * attempt)
                    continue
                raise
            except ValueError as exc:  # unparseable JSON from the model
                last_error = exc
                log.warning("agent_parse_failed", extra={"x_operation": operation, "x_attempt": attempt})
                if attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(_RETRY_DELAY_S)
                    continue
                raise ProblemError(502, "E_PLAN_INVALID", detail="The model returned unparseable output.") from exc
        raise ProblemError(502, "E_PLAN_INVALID", detail=str(last_error) or "Unknown provider failure.")


__all__ = ["Agent", "MAX_ATTEMPTS", "ProblemError", "Provider"]
