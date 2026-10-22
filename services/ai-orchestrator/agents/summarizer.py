"""Summarizer agent — activity digests for the "Today" dashboard."""
from __future__ import annotations

import json
import logging

from agents.base import Agent
from problems import ProblemError

log = logging.getLogger("jarvis.summarizer")

_SUMMARY_SYSTEM = """\
You are the Summarizer Agent of Jarvis OS. You receive a compact list of task
events and produce a friendly, honest digest. Return JSON exactly:
{"summary": str, "highlights": [str], "risk_notes": [str]}
Rules: ≤120 words summary; up to 5 highlights; never invent events; mention
denied/dangerous actions plainly. JSON only.
"""


class SummarizerAgent(Agent):
    async def summarize(self, events: list[dict]) -> dict:
        compact = [
            {k: ev.get(k) for k in ("task_id", "prompt", "status", "steps", "denied", "blocked") if k in ev}
            for ev in events[:500]
        ]
        user = json.dumps(compact, ensure_ascii=False)
        try:
            return await self._complete_json_with_retry(_SUMMARY_SYSTEM, user, operation="summarize")
        except ProblemError as exc:
            if exc.code in {"E_NO_KEY"}:
                raise
            log.warning("summarizer_fallback", extra={"x_code": exc.code})
            return {
                "summary": "Local summary unavailable (model provider unreachable); show task counts only.",
                "highlights": [],
                "risk_notes": [f"provider:{exc.code}"]
            }
