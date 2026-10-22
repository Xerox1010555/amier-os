"""Secret redaction — applied to every log line and to command output that
crosses the API boundary. Defense in depth: the Rust engine redacts too.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

@dataclass(frozen=True)
class _Pattern:
    name: str
    compiled: re.Pattern[str]

_PATTERNS: tuple[_Pattern, ...] = (
    _Pattern("api_key", re.compile(r"\b(sk|rk|pk)_(?:live|test)_[0-9a-zA-Z]{10,64}\b")),
    _Pattern("openai", re.compile(r"\bsk-[A-Za-z0-9_\-]{16,64}\b")),
    _Pattern("anthropic", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{16,128}\b")),
    _Pattern("github", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,60}\b")),
    _Pattern("slack", re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,60}\b")),
    _Pattern("aws", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    _Pattern("gcp", re.compile(r"\bAIza[0-9A-Za-z_\-]{20,60}\b")),
    _Pattern("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{8,}\b")),
    _Pattern("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{16,}\b")),
    _Pattern("password_kv", re.compile(r"(?i)\b(password|passwd|pwd|api[-_]?key|secret|token)\s*[=:]\s*\S{4,}")),
    _Pattern("email", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    _Pattern("windows_pwd", re.compile(r"(?i)/(?:user|p)(?:ass\s*(?:word)?|wd)(?:[:=]|\s+)\S{4,}")),
    _Pattern("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
)

_ENTROPY_RE = re.compile(r"\b[a-zA-Z0-9+/_\-]{32,}\b")


def _entropy_looks_secret(token: str) -> bool:
    """Cheap Shannon-style heuristic: high character diversity + long token."""
    pool = set(token)
    if len(pool) < 16:
        return False
    digits = sum(c.isdigit() for c in token)
    lower = sum(c.islower() for c in token)
    upper = sum(c.isupper() for c in token)
    other = len(token) - digits - lower - upper
    kinds = sum(1 for n in (digits, lower, upper, other) if n >= max(2, len(token) // 8))
    return len(pool) >= 20 and kinds >= 3


def redact(text: str) -> str:
    """Return text with every detected secret replaced by ``[REDACTED:name]``."""
    if not text:
        return text
    out = text
    for pat in _PATTERNS:
        out = pat.compiled.sub(f"[REDACTED:{pat.name}]", out)
    out = _ENTROPY_RE.sub(lambda m: f"[REDACTED:entropy]" if _entropy_looks_secret(m.group(0)) else m.group(0), out)
    return out


def redact_mapping(mapping: dict) -> dict:
    return {redact(str(k)): redact(str(v)) if isinstance(v, str) else v for k, v in mapping.items()}
