"""All HTTP routes. Handlers stay thin; agents own the logic."""
from __future__ import annotations

import json
import logging
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse

from agents.critic import CriticAgent
from agents.planner import PlanningAgent
from agents.summarizer import SummarizerAgent
from config import get_settings
from metrics import PLANS_TOTAL, RATE_LIMITED_TOTAL, REQUESTS_TOTAL
from problems import ProblemError, problem_response
from providers import get_provider
from ratelimit import limiter, rate_limited
from schemas import (
    ChatRequest,
    CritiqueRequest,
    CritiqueResult,
    ExecutionPlan,
    ExplainRequest,
    HealthStatus,
    SummarizeRequest,
    UserIntent,
)
from security import require_auth

log = logging.getLogger("jarvis.routes")
router = APIRouter(prefix="/api/v1", tags=["api"])


@router.post("/plan", response_model=ExecutionPlan)
async def create_plan(
    intent: UserIntent,
    request: Request,
    _auth: None = Depends(require_auth),
    _limit: None = Depends(rate_limited()),
) -> ExecutionPlan:
    settings = get_settings()
    provider = get_provider()
    planner = PlanningAgent(provider)
    try:
        plan, refused = await planner.generate_plan(intent)
    except ProblemError as exc:
        PLANS_TOTAL.labels(provider=provider.name, outcome=exc.code.lower()).inc()
        raise
    except Exception as exc:  # noqa: BLE001 - handler stays user-safe
        log.error("plan_failed", exc_info=type(exc), extra={"x_code": type(exc).__name__})
        raise ProblemError(500, "E_INTERNAL") from exc

    PLANS_TOTAL.labels(provider=provider.name, outcome="ok").inc()
    log.info(
        "plan_generated",
        extra={
            "x_task_id": plan.task_id,
            "x_steps": len(plan.steps),
            "x_refused": refused,
            "request_id": getattr(request.state, "request_id", None),
        },
    )
    return plan


@router.post("/critique", response_model=CritiqueResult)
async def critique_plan(
    req: CritiqueRequest,
    _auth: None = Depends(require_auth),
    _limit: None = Depends(rate_limited()),
) -> CritiqueResult:
    critic = CriticAgent(get_provider())
    result = await critic.critique(req.prompt, req.plan)
    if result.corrected_plan is not None:
        # The corrected plan keeps the same task id so the engine can match it.
        result.corrected_plan.task_id = req.plan.task_id
    return result


@router.post("/explain")
async def explain_plan(
    req: ExplainRequest,
    _auth: None = Depends(require_auth),
) -> dict:
    provider = get_provider()
    lines = "\n".join(f"{i + 1}. {s.description} — command: {s.command}" for i, s in enumerate(req.plan.steps))
    system = (
        "You explain OS command plans to non-technical users in plain language. "
        "Be concrete about what each command changes on the machine. 120 words max, no markdown."
    )
    try:
        text = await provider.complete_text(system, lines)
    except ProblemError as exc:
        if exc.code in {"E_NO_KEY", "E_NOT_FOUND"}:
            raise
        # Soft failure: fall back to a deterministic explanation.
        determinism = [f"{i + 1}) {s.description or s.command}" for i, s in enumerate(req.plan.steps)]
        text = "\n".join(determinism)
    return {"explanation": text}


@router.post("/chat")
async def chat(req: ChatRequest, _auth: None = Depends(require_auth)) -> StreamingResponse:
    provider = get_provider()
    system = (
        "You are Jarvis, an AI assistant embedded in an operating-system helper. "
        "You have NO direct ability to execute anything: you only discuss and "
        "propose plans which a human confirms. Be concise, friendly, and precise. "
        "If the user asks for a device/system action, outline the steps."
    )
    history = [{"role": m.role, "content": m.content} for m in req.history]

    async def sse() -> AsyncIterator[bytes]:
        request_id = uuid.uuid4().hex
        label = "assistant"
        yield _sse_event("meta", {"request_id": request_id, "label": label})
        buffer: list[str] = []
        try:
            async for chunk in provider.stream_text(system, req.prompt, history):
                buffer.append(chunk)
                if sum(len(c) for c in buffer[-40:]) > 1200:
                    text = "".join(buffer)
                    buffer.clear()
                    buffer.append(text[-1200:])
                yield _sse_event("delta", {"text": chunk})
        except ProblemError as exc:
            yield _sse_event("error", {"code": exc.code, "detail": exc.detail or exc.default_title})
        finally:
            yield _sse_event("done", {})

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


def _sse_event(event: str, data: dict) -> bytes:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n".encode()


@router.post("/summarize")
async def summarize_events(
    req: SummarizeRequest,
    _auth: None = Depends(require_auth),
) -> dict:
    agent = SummarizerAgent(get_provider())
    return await agent.summarize(req.events)


@router.get("/health", response_model=HealthStatus)
async def health(response: Response) -> HealthStatus:
    settings = get_settings()
    provider = get_provider()
    return HealthStatus(
        status="online",
        version=_version(),
        provider=provider.name,
        model=settings.model,
        feature_flags=settings.feature_flags,
        auth_required=settings.require_auth,
    )


def _version() -> str:
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent.parent
    version_file = root / "VERSION"
    try:
        return version_file.read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"
