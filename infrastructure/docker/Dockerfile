# Jarvis AI orchestrator image — slim, runnable standalone or via compose/k8s.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Requirements first for layer caching.
COPY services/ai-orchestrator/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY services/ai-orchestrator/ ./
COPY VERSION /VERSION

# Local-first hardened defaults (never ship 0.0.0.0 without TLS + auth).
ENV JARVIS_BIND_HOST=0.0.0.0 \
    JARVIS_PORT=8000 \
    JARVIS_REQUIRE_AUTH=true

RUN useradd --create-home jarvis && chown -R jarvis:jarvis /app
USER jarvis

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health').status==200 else 1)"

CMD ["python", "-X", "utf8", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
