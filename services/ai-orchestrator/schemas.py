"""Pydantic v2 API schemas — the single source of truth for wire contracts.

The TypeScript mirror lives in ``packages/shared/src/schema.ts`` and CI keeps
the two in parity; do not edit one side only.
"""
from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

RiskLevel = Literal["low", "medium", "high", "deny"]

_SHORT = Annotated[str, Field(max_length=2000)]
_COMMAND = Annotated[str, Field(max_length=1200)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class UserIntent(StrictModel):
    prompt: Annotated[str, Field(min_length=1, max_length=8000)]
    context: dict[str, Any] | None = None
    persona: Literal["default", "developer", "admin", "writer"] | None = None


class TaskStep(StrictModel):
    """A step produced by the PLANNER.

    ``risk_level``/``requires_confirmation`` fields coming from an LLM are
    advisory — the Rust security engine re-derives authoritative values and
    always escalates to ``max(llm, rule)``. Wire field names keep the ``llm_``
    prefix to make that non-negotiable.
    """

    description: _SHORT
    command: _COMMAND
    llm_risk_level: RiskLevel = "medium"
    llm_requires_confirmation: bool = True
    rationale: _SHORT | None = None

    @field_validator("description", "command", "rationale")
    @classmethod
    def non_empty(cls, v: str | None) -> str | None:  # noqa: D102
        if v is not None and not v.strip():
            raise ValueError("must not be empty")
        return v


class ExecutionPlan(StrictModel):
    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    provider: str = "unknown"
    model: str | None = None
    steps: Annotated[list[TaskStep], Field(min_length=1)]

    @field_validator("task_id")
    @classmethod
    def _valid_uuid(cls, v: str) -> str:
        try:
            uuid.UUID(v)
        except (ValueError, AttributeError) as exc:
            raise ValueError("task_id must be a UUID") from exc
        return v


class CritiqueRequest(StrictModel):
    prompt: Annotated[str, Field(min_length=1, max_length=8000)]
    plan: ExecutionPlan


class CritiqueResult(StrictModel):
    ok: bool
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    flags: list[str] = []
    corrected_plan: ExecutionPlan | None = None


class ExplainRequest(StrictModel):
    plan: ExecutionPlan


class ChatMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: Annotated[str, Field(max_length=8000)]


class ChatRequest(StrictModel):
    prompt: Annotated[str, Field(min_length=1, max_length=8000)]
    history: Annotated[list[ChatMessage], Field(max_length=30)] = []


class SummarizeRequest(StrictModel):
    events: Annotated[list[dict[str, Any]], Field(max_length=2000)]


class HealthStatus(StrictModel):
    status: Literal["online", "degraded", "offline"]
    version: str
    provider: str
    model: str | None
    feature_flags: dict[str, bool]
    auth_required: bool
