"""Robust JSON parsing for LLM output.

Resilient against the classic failure modes: markdown fences, leading label
text, trailing commas, single-quoted keys, truncated tail. Never executes
model output — only parses/repairs it.
"""
from __future__ import annotations

import json
import re
from typing import Any

_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.MULTILINE)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")
_SINGLE_QUOTES = re.compile(r"(?<![\\\w])'((?:[^'\\]|\\.)*)'")
_CODE_COMMENT = re.compile(r"^\s*//[^\n]*", re.MULTILINE)


def _strip_fences(text: str) -> str:
    if "```" in text:
        matches = _FENCE_RE.findall(text)
        if matches:
            return "\n".join(m.strip() for m in matches)
    return text


def _extract_balanced(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    escape = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}" == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]
    return None


def _common_repairs(candidate: str) -> str:
    candidate = _CODE_COMMENT.sub("", candidate)
    candidate = _TRAILING_COMMA.sub(r"\1", candidate)
    candidate = _SINGLE_QUOTES.sub(r'"\1"', candidate)
    return candidate


def parse_llm_json(raw: str) -> dict[str, Any]:
    """Parse model output into a dict, raising ``ValueError`` if unrecoverable."""
    if not raw or not raw.strip():
        raise ValueError("empty model output")
    candidates = [raw]
    stripped = _strip_fences(raw.strip())
    if stripped != raw:
        candidates.insert(0, stripped)
    balanced = _extract_balanced(stripped)
    if balanced:
        candidates.insert(0, balanced)
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    for candidate in candidates:
        repaired = _common_repairs(candidate)
        try:
            parsed = json.loads(repaired)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("model output is not parseable JSON")
