"""Provider abstractions.

Each provider talks straight to its vendor REST API over ``httpx`` (async,
timeout-bounded) — no heavyweight SDK dependency, fully offline-friendly for
Ollama. All calls are JSON or SSE; nothing here executes anything.
"""
from __future__ import annotations

import json
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

import httpx

import local_assistant
from config import Settings
from metrics import PROVIDER_LATENCY
from problems import ProblemError

SYSTEM_JSON_DIRECTIVE = (
    "You output ONLY a single JSON object. No prose, no markdown fences, "
    "no commentary before or after the JSON."
)

_CONNECT_TIMEOUT = 5.0


class Provider(ABC):
    name: str = "base"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.timeout = httpx.Timeout(settings.request_timeout_s, connect=_CONNECT_TIMEOUT)

    # -- JSON completion ---------------------------------------------------
    async def complete_json(self, system: str, user: str) -> dict[str, Any]:
        raw = await self.complete_text(system + "\n" + SYSTEM_JSON_DIRECTIVE, user)
        from jsonrepair import parse_llm_json  # local import avoids cycle

        return parse_llm_json(raw)

    # -- Plain completion --------------------------------------------------
    @abstractmethod
    async def complete_text(self, system: str, user: str) -> str:  # pragma: no cover - interface
        ...

    # -- Streaming ---------------------------------------------------------
    async def stream_text(self, system: str, user: str, history: list[dict[str, str]] | None = None) -> AsyncIterator[str]:
        # Default: fall back to non-streaming, yielded once.
        text = await self.complete_text(system, user)
        yield text
        return

    # -- Instrumented wrapper ---------------------------------------------
    async def timed_json(self, system: str, user: str, operation: str = "complete_json") -> dict[str, Any]:
        started = time.perf_counter()
        try:
            return await self.complete_json(system, user)
        finally:
            PROVIDER_LATENCY.labels(provider=self.name, operation=operation).observe(time.perf_counter() - started)


# ---------------------------------------------------------------------------
class MockProvider(Provider):
    name = "mock"

    @staticmethod
    def _strip_prompt(user: str) -> str:
        """Extract the raw user prompt — the planner wraps it in triple quotes."""
        marker = '"""'
        if marker in user:
            parts = user.split(marker)
            if len(parts) >= 3:
                return parts[1].strip()
        return user

    async def complete_text(self, system: str, user: str) -> str:
        prompt = self._strip_prompt(user)

        # 1) local heuristic assistant — bilingual everyday skills, no API key
        steps = local_assistant.interpret(prompt)
        if not steps and local_assistant.is_destructive(prompt):
            # 2) destructive intent (Arabic/English) — never propose execution;
            #    surface a high-risk advisory step so the fast-path and engine
            #    gates stay in control (the human denies it or it's denied).
            steps = [
                {
                    "description": "تم رفض ذلك الطلب محلياً (خطر تدميري) | destructive request refused locally",
                    "command": "cmd /c echo refused: destructive request requires explicit approval",
                    "llm_risk_level": "high",
                    "llm_requires_confirmation": True,
                    "rationale": "Destructive intents are never executed. Advisory — the Rust engine re-classifies.",
                }
            ]
        if steps:
            return json.dumps({"steps": steps})

        # 3) legacy deterministic fallback (backs the original unit tests and
        #    unknown free-form prompts until a real provider key is set)
        lowered = user.lower()
        destructive = ("rm -rf", "format", "diskpart", "reg delete", "shutdown",
                       "invoke-expression", "powershell -enc", "del ", "mkdir", "rmdir",
                       " echo ", "clean", "wipe", "delete", "remove", "uninstall",
                       "kill", "taskkill")
        confirm = ("install", "npm", "git push", "git commit", "pip install", "choco", "winget")
        if any(k in lowered for k in destructive):
            risk, confirm_flag = "high", True
        elif any(k in lowered for k in confirm):
            risk, confirm_flag = "medium", True
        else:
            risk, confirm_flag = "low", False
        plan = {
            "steps": [
                {
                    "description": f"Deterministic mock step for: {user[:120]}",
                    "command": self._derive_command(user),
                    "llm_risk_level": risk,
                    "llm_requires_confirmation": confirm_flag,
                    "rationale": "Mock provider (no network). Risk is advisory — the Rust engine re-classifies.",
                }
            ]
        }
        return json.dumps(plan)

    @staticmethod
    def _derive_command(user: str) -> str:
        lowered = user.lower()
        if "downloads folder" in lowered or "delete downloads" in lowered:
            return "rmdir /s /q C:\\Users\\%USERNAME%\\Downloads"
        if "git status" in lowered:
            return "git status"
        return "echo demo"

    async def stream_text(self, system: str, user: str, history: list[dict[str, str]] | None = None) -> AsyncIterator[str]:
        prompt = self._strip_prompt(user)
        reply = local_assistant.chat_reply(prompt)
        if not reply:
            reply = f"[jarvis mock]: here is my plan for '{user[:200]}'. The Rust engine will verify every command."
        for chunk in (reply[i : i + 24] for i in range(0, len(reply), 24)):
            yield chunk


# ---------------------------------------------------------------------------
class OpenAIProvider(Provider):
    name = "openai"
    endpoint = "https://api.openai.com/v1/chat/completions"

    def key(self) -> str:  # pragma: no cover - env driven
        import os

        return os.getenv("OPENAI_API_KEY", "")

    async def complete_text(self, system: str, user: str) -> str:
        key = self.key()
        if not key:
            raise ProblemError(503, "E_NO_KEY")
        payload = {
            "model": self.settings.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    self.endpoint,
                    json=payload,
                    headers={"Authorization": f"Bearer {key}"},
                )
        except httpx.TimeoutException as exc:
            raise ProblemError(504, "E_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise ProblemError(502, "E_PROVIDER_DOWN") from exc
        return self._finish(resp, "choices", "message")

    def _finish(self, resp: httpx.Response, outer: str, inner: str) -> str:
        if resp.status_code in (401, 403):
            raise ProblemError(503, "E_NO_KEY")
        if resp.status_code in (500, 502, 503, 529):
            raise ProblemError(502, "E_PROVIDER_DOWN")
        if resp.status_code == 429:
            raise ProblemError(502, "E_PROVIDER_ERROR", detail="Upstream rate limit reached; retry later.")
        if resp.status_code >= 400:
            raise ProblemError(502, "E_PROVIDER_ERROR")
        body = resp.json()
        if outer == "choices":
            return str(body["choices"][0][inner]["content"])
        return str(body["choices"][0]["text"])

    async def stream_text(self, system: str, user: str, history: list[dict[str, str]] | None = None) -> AsyncIterator[str]:
        key = self.key()
        if not key:
            raise ProblemError(503, "E_NO_KEY")
        messages = [{"role": "system", "content": system}] + (history or []) + [{"role": "user", "content": user}]
        payload = {"model": self.settings.model, "messages": messages, "temperature": 0.4, "stream": True}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", self.endpoint, json=payload, headers={"Authorization": f"Bearer {key}"}) as resp:
                    if resp.status_code >= 400:
                        await resp.aread()
                        raise ProblemError(502, "E_PROVIDER_DOWN")
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content")
                        if delta:
                            yield delta
        except httpx.HTTPError as exc:
            raise ProblemError(502, "E_PROVIDER_DOWN") from exc


# ---------------------------------------------------------------------------
class AnthropicProvider(Provider):
    name = "anthropic"
    endpoint = "https://api.anthropic.com/v1/messages"

    async def complete_text(self, system: str, user: str) -> str:
        import os

        key = os.getenv("ANTHROPIC_API_KEY", "")
        if not key:
            raise ProblemError(503, "E_NO_KEY")
        payload = {
            "model": self.settings.model,
            "system": system,
            "max_tokens": 1200,
            "temperature": 0,
            "messages": [{"role": "user", "content": user}],
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    self.endpoint,
                    json=payload,
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                )
        except httpx.TimeoutException as exc:
            raise ProblemError(504, "E_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise ProblemError(502, "E_PROVIDER_DOWN") from exc
        if resp.status_code == 401:
            raise ProblemError(503, "E_NO_KEY")
        if resp.status_code >= 400:
            raise ProblemError(502, "E_PROVIDER_DOWN")
        content = resp.json()["content"]
        for block in content:
            if block.get("type") == "text":
                return str(block["text"])
        raise ProblemError(502, "E_PROVIDER_ERROR", detail="No text block in response.")


# ---------------------------------------------------------------------------
class GeminiProvider(Provider):
    name = "gemini"
    base = "https://generativelanguage.googleapis.com/v1beta/models"

    async def complete_text(self, system: str, user: str) -> str:
        import os

        key = os.getenv("GEMINI_API_KEY", "")
        if not key:
            raise ProblemError(503, "E_NO_KEY")
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user + "\n(Reply with JSON only.)"}]}],
            "generationConfig": {"temperature": 0, "response_mimeType": "application/json"},
        }
        url = f"{self.base}/{self.settings.model}:generateContent?key={key}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, json=payload)
        except httpx.TimeoutException as exc:
            raise ProblemError(504, "E_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise ProblemError(502, "E_PROVIDER_DOWN") from exc
        if resp.status_code in (401, 403):
            raise ProblemError(503, "E_NO_KEY")
        if resp.status_code >= 400:
            raise ProblemError(502, "E_PROVIDER_DOWN")
        body = resp.json()
        try:
            return str(body["candidates"][0]["content"]["parts"][0]["text"])
        except (KeyError, IndexError, TypeError) as exc:
            raise ProblemError(502, "E_PROVIDER_ERROR", detail="Unexpected Gemini response shape.") from exc


# ---------------------------------------------------------------------------
class OllamaProvider(Provider):
    name = "ollama"

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        import os

        self.base_url = (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").rstrip("/")

    async def complete_text(self, system: str, user: str) -> str:
        payload = {
            "model": self.settings.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0},
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.base_url}/api/chat", json=payload)
        except httpx.TimeoutException as exc:
            raise ProblemError(504, "E_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise ProblemError(502, "E_PROVIDER_DOWN", detail="Is Ollama running (ollama serve)?") from exc
        if resp.status_code >= 400:
            raise ProblemError(502, "E_PROVIDER_DOWN")
        try:
            return str(resp.json()["message"]["content"])
        except (KeyError, TypeError) as exc:
            raise ProblemError(502, "E_PROVIDER_ERROR") from exc

    async def stream_text(self, system: str, user: str, history: list[dict[str, str]] | None = None) -> AsyncIterator[str]:
        messages = ([{"role": "system", "content": system}] if system else []) + (history or []) + [{"role": "user", "content": user}]
        payload = {"model": self.settings.model, "messages": messages, "stream": True, "options": {"temperature": 0.4}}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as resp:
                    if resp.status_code >= 400:
                        await resp.aread()
                        raise ProblemError(502, "E_PROVIDER_DOWN")
                    async for line in resp.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        delta = chunk.get("message", {}).get("content")
                        if delta:
                            yield delta
        except httpx.HTTPError as exc:
            raise ProblemError(502, "E_PROVIDER_DOWN") from exc


# ---------------------------------------------------------------------------
_singleton: Provider | None = None


def get_provider(settings: Settings | None = None) -> Provider:
    """Return a process-wide singleton for the configured provider."""
    global _singleton
    settings = settings or __import__("config", fromlist=["get_settings"]).get_settings()
    factory = {
        "mock": MockProvider,
        "openai": OpenAIProvider,
        "anthropic": AnthropicProvider,
        "gemini": GeminiProvider,
        "ollama": OllamaProvider,
    }
    cls = factory.get(settings.provider)
    if cls is None:
        raise ProblemError(500, "E_INTERNAL", detail=f"Unknown provider {settings.provider!r}")
    if _singleton is None or type(_singleton) is not cls or _singleton.settings is not settings:
        _singleton = cls(settings)
    return _singleton


def reset_provider() -> None:
    global _singleton
    _singleton = None
