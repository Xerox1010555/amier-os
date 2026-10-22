"""Critic agent — adversarial reviewer for generated plans.

Flags hallucinated paths, dangerous sequences, and unfulfilled intent; may
return a corrected plan. The caller (desktop app) shows flags before running.
Never trusts the planner's own claims.
"""
from __future__ import annotations

import json
import logging

from agents.base import Agent
from problems import ProblemError
from pydantic import ValidationError
from schemas import CritiqueResult, ExecutionPlan, TaskStep

log = logging.getLogger("jarvis.critic")

_CRITIC_SYSTEM = """\
You are the Critic Agent of a high-security AI assistant. A planner produced an
execution plan for a user request. Review it adversarially.

Return JSON exactly:
{"ok":bool,"confidence":0.0..1.0,"flags":["..."],
 "corrected_plan":{"task_id":"same","steps":[
   {"description":str,"command":str,"rationale":str,
    "llm_risk_level":"low|medium|high","llm_requires_confirmation":true|false}]}}

Checks:
1. Do the commands actually achieve the user's request (intent match)?
2. Are referenced paths/apps plausible (no hallucinated paths)?
3. Is any step unnecessary, duplicated, or dangerous beyond the user's ask?
4. Are destructive steps properly flagged for confirmation?
If corrections are needed, provide corrected_plan (same task_id). If the plan
is fine, set corrected_plan to null and ok=true with high confidence. JSON only.
"""


class CriticAgent(Agent):
    async def critique(self, prompt: str, plan: ExecutionPlan) -> CritiqueResult:
        review_input = {
            "user_request": prompt,
            "plan": plan.model_dump(mode="json", exclude_none=True),
        }
        try:
            data = await self._complete_json_with_retry(_CRITIC_SYSTEM, json.dumps(review_input, ensure_ascii=False), operation="critique")
        except ProblemError as exc:
            if exc.code in {"E_NO_KEY"}:
                raise
            # Soft-fail: the critic is a quality gate, not an availability gate.
            log.warning("critic_fallback", extra={"x_code": exc.code})
            return CritiqueResult(ok=True, confidence=0.0, flags=[f"critic_unavailable:{exc.code}"])

        corrected_plan: ExecutionPlan | None = None
        corrected_raw = data.get("corrected_plan")
        if isinstance(corrected_raw, dict) and isinstance(corrected_raw.get("steps"), list) and corrected_raw["steps"]:
            steps: list[TaskStep] = []
            for raw in corrected_raw["steps"]:
                try:
                    steps.append(TaskStep.model_validate(raw))
                except ValidationError:
                    continue
            if steps:
                corrected_plan = plan.model_copy(update={"steps": steps})

        flags = [str(f).strip()[:200].lower() for f in data.get("flags", []) if str(f).strip()]
        try:
            confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5
        return CritiqueResult(
            ok=bool(data.get("ok", True)),
            confidence=confidence,
            flags=flags,
            corrected_plan=corrected_plan,
        )
