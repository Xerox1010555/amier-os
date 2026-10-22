"""Prometheus metrics — a single module keeps instrumentation consistent."""
from __future__ import annotations

from fastapi import Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Histogram, generate_latest

from config import get_settings

REGISTRY = CollectorRegistry(auto_describe=True)

REQUESTS_TOTAL = Counter(
    "jarvis_requests_total", "HTTP requests processed.", ["method", "path", "outcome"], registry=REGISTRY
)
PLANS_TOTAL = Counter("jarvis_plans_total", "Plans generated.", ["provider", "outcome"], registry=REGISTRY)
PROVIDER_LATENCY = Histogram(
    "jarvis_provider_latency_seconds", "Provider call latency.", ["provider", "operation"],
    buckets=(0.2, 0.5, 1, 2, 5, 10, 20, 45, 90), registry=REGISTRY,
)
STEPS_PER_PLAN = Histogram(
    "jarvis_steps_per_plan", "Steps per generated plan.", buckets=(1, 2, 3, 4, 5, 6, 9, 12), registry=REGISTRY
)
RATE_LIMITED_TOTAL = Counter("jarvis_rate_limited_total", "Requests rejected by the rate limiter.", registry=REGISTRY)


async def metrics_endpoint(_request: Request | None = None) -> Response:
    settings = get_settings()
    body = generate_latest(REGISTRY)
    body += f'jarvis_build_info{{provider="{settings.provider}"}} 1\n'.encode()
    return Response(content=body, media_type=CONTENT_TYPE_LATEST)
