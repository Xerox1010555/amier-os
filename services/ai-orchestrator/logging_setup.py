"""Structured JSON logging with automatic secret redaction.

Every line: {"ts", "level", "msg", "request_id", ...} — request ids correlate
client-side problem+json documents with server logs.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from config import get_settings
from redact import redact

_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "taskName", "message", "asctime",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        rid = getattr(record, "request_id", None)
        if rid:
            payload["request_id"] = rid
        for key, value in record.__dict__.items():
            if key not in _RESERVED and key.startswith("x_"):
                payload[key[2:]] = value if isinstance(value, (int, float, bool)) else redact(str(value))
        if record.exc_info:
            payload["exc"] = json.dumps([
                type(record.exc_info[1]).__name__ if record.exc_info[1] else "Exception"
            ])
        return json.dumps(payload, ensure_ascii=False)


def setup_logging() -> None:
    settings = get_settings()
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(settings.log_level)
    for noisy in ("uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
