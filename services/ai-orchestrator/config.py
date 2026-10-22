"""Application configuration. Read once at startup, frozen afterwards.

Every knob is an environment variable prefixed with ``JARVIS_`` (see
``.env.example``). Secrets are read on demand by the provider factory, never
logged by this module.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    provider: str = "mock"
    model: str | None = None
    bind_host: str = "127.0.0.1"
    port: int = 8000
    require_auth: bool = True
    shared_secret: str | None = None
    request_timeout_s: float = 20.0
    max_steps_per_plan: int = 6
    plans_rate_limit: int = 10          # requests / minute / client
    daily_task_limit: int = 200
    log_level: str = "INFO"
    cors_origins: tuple[str, ...] = field(default_factory=lambda: ())

    @property
    def feature_flags(self) -> dict[str, bool]:
        return {
            "critique": True,
            "chat_stream": True,
            "memory_proxy": True,
            "provider_" + self.provider: True,
        }


def load_settings() -> Settings:
    """Build settings from environment variables (idempotent)."""
    provider = (os.getenv("JARVIS_LLM_PROVIDER") or "openai").strip().lower()
    model = (os.getenv("JARVIS_LLM_MODEL") or "").strip() or None
    default_model = {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-sonnet-20240620",
        "gemini": "gemini-1.5-flash",
        "ollama": "llama3.1",
        "mock": "mock-1",
    }
    resolved_model = model or default_model.get(provider)

    cors_raw = os.getenv("JARVIS_CORS_ORIGINS", "").strip()
    origins = tuple(o for o in (s.strip() for s in cors_raw.split(",")) if o)

    secret = os.getenv("JARVIS_SHARED_SECRET", "").strip() or None
    require_auth = _env_bool("JARVIS_REQUIRE_AUTH", True)

    return Settings(
        provider=provider,
        model=resolved_model,
        bind_host=os.getenv("JARVIS_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=_env_int("JARVIS_PORT", 8000),
        # A secret-less deployment can still boot in mock/dev mode, but the
        # moment a real provider is configured auth is mandatory.
        require_auth=require_auth and secret is not None or provider != "mock",
        shared_secret=secret,
        request_timeout_s=_env_float("JARVIS_REQUEST_TIMEOUT_S", 20.0),
        max_steps_per_plan=_env_int("JARVIS_MAX_STEPS_PER_PLAN", 6),
        plans_rate_limit=_env_int("JARVIS_PLANS_RATE_LIMIT", 10),
        daily_task_limit=_env_int("JARVIS_DAILY_TASK_LIMIT", 200),
        log_level=os.getenv("JARVIS_LOG_LEVEL", "INFO").upper() or "INFO",
        cors_origins=origins,
    )


# Singleton access pattern so tests can swap settings deterministically.
_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings


def set_settings(settings: Settings) -> None:
    global _settings
    _settings = settings
