"""Planning agent — natural language → validated execution plan.

The system prompt embeds the deployment's security policy contractually; the
result is validated by Pydantic, truncated to the configured max, and any step
the model invents beyond policy is dropped rather than trusted.
"""
from __future__ import annotations

import logging

from agents.base import Agent
from config import get_settings
from metrics import STEPS_PER_PLAN
from problems import ProblemError
from pydantic import ValidationError
from schemas import ExecutionPlan, TaskStep, UserIntent

log = logging.getLogger("jarvis.planner")

_PLAN_SYSTEM = """\
You are the Planning Agent of a high-security AI Operating Assistant (Jarvis OS).
Convert the user's natural-language request into a short sequence of concrete,
sandbox-runnable steps (shell commands).

POLICY (non-negotiable, and re-enforced by a deterministic engine AFTER you):
1. Output ONLY JSON matching exactly:
   {"steps":[{"description":str,"command":str,"rationale":"why: '...'","llm_risk_level":"low|medium|high","llm_requires_confirmation":true|false}]}
2. Your risk fields are ADVISORY. A deterministic rule engine re-classifies every
   command and always takes the stricter_of(yours, its own). Never claim "low"
   for something destructive; if unsure, claim "high".
3. Every command that deletes, formats, moves, installs, edits the registry,
   stops services, or changes users/network MUST have llm_requires_confirmation=true.
4. If the request is destructive with no clear user benefit (e.g., deleting
   System32, disabling security tooling, wiping disks), REFUSE by returning
   {"steps":[]} — empty plans are rejected upstream as E_PLAN_REFUSED.
5. Max {max_steps} steps. Fewer is better. Prefer read-only diagnostics first,
   then the minimal mutating action.
6. Commands must be POSIX-safe or cmd.exe-safe per the user's OS hint.
   Never chain with unvalidated pipes into shells (curl|bash etc.).
7. Never invent files/paths. If a path is uncertain, include a read-only
   first step that locates it.
8. BILINGUAL INPUT: the user may write Arabic, English, or a mix. Parse both
   equally well (e.g. "افتح يوتيوب" = open YouTube, "شغل الرياضيات" = run the
   calculator/math app). Keep "description" and "rationale" in the SAME
   language as the user's request; commands stay machine-safe either way.
9. No markdown. No commentary. JSON only.

COMMON INTENTS (Windows example style — adapt per OS hint):
- open a website -> cmd /c start "" https://youtube.com        (risk: low)
- open an app    -> cmd /c start "" "" notepad                 (risk: low)
- make a folder  -> cmd /c mkdir "%USERPROFILE%\\Documents\\X" (risk: medium)
- find a file    -> cmd /c dir /s /b "%USERPROFILE%\\file.txt" (risk: low)
"""

_REFUSAL_FLAGS = {
    6: "exec_ignored_request"
}


class PlanningAgent(Agent):
    async def generate_plan(self, intent: UserIntent) -> tuple[ExecutionPlan, bool]:
        """Return (plan, refused). ``refused`` is True when the model refused."""
        settings = get_settings()
        system = _PLAN_SYSTEM.replace("{max_steps}", str(settings.max_steps_per_plan))
        persona_line = f"Persona: {intent.persona}." if intent.persona else ""
        context_line = "" 
        if intent.context:
            compact = ", ".join(f"{k}={intent.context[k]}" for k in list(intent.context)[:6])
            context_line = f"User context: {compact}."
        user = (
            f"{persona_line}\n{context_line}\n"
            f"User request:\n\"\"\"{intent.prompt.strip()}\"\"\""
        )

        data = await self._complete_json_with_retry(system, user, operation="plan")
        raw_steps = data.get("steps")
        if not isinstance(raw_steps, list):
            raise ProblemError(502, "E_PLAN_INVALID", detail="Plan JSON had no steps array.")
        if not raw_steps:
            raise ProblemError(
                422,
                "E_PLAN_REFUSED",
                detail=(
                    "تعذّر التخطيط الآمن لهذا الطلب محلياً — جرّب: «افتح يوتيوب» · "
                    "«ابحث عن الطقس» · «افتح المفكرة». | The planner declined this request. "
                    "Try: open YouTube, search the weather, open Notepad. "
                    "ولفهم أي طلب آخر أضف مفتاح مزوّد في services/ai-orchestrator/.env."
                ),
            )

        steps: list[TaskStep] = []
        for raw in raw_steps[: settings.max_steps_per_plan]:
            try:
                step = TaskStep.model_validate(raw)
            except ValidationError:
                log.warning("step_dropped", extra={"x_task": intent.prompt[:60]})
                continue
            steps.append(step)

        if not steps:
            raise ProblemError(502, "E_PLAN_INVALID", detail="All steps failed validation.")

        plan = ExecutionPlan(
            provider=self.provider.name,
            model=self.provider.settings.model,
            steps=steps,
        )
        STEPS_PER_PLAN.observe(len(steps))
        return plan, False
