# Jarvis OS — Security Model

## 1. Threat model (summary)

| Threat | Mitigation (implemented) |
|---|---|
| Prompt injection asks the LLM to mark a destructive command safe | rules engine is authoritative; `stricter_of` merge; `llm:deny` absolute; wire schema keeps `llm_` prefix to make advisory-ness explicit |
| Renderer compromised (XSS in streamed output) | no node integration, sandboxed, CSP default-src 'self', allow-list IPC, no raw net access from renderer |
| Malicious/compromised npm supply chain | deps kept minimal (react/zustand/vite/electron); no runtime SDKs |
| Secret leakage into logs/audit/DB | two-layer redaction (Rust + Python) applied before ANY persistence/rendering; env scrub for child processes |
| History tampering | SHA-256 hash-chained audit log with genesis anchor; `verify_audit_chain()` reports first broken seq; UI banner on failure |
| Unattended destructive runs | deny list, confirmation gate (medium+always-confirm default), human modal, notifications on `security_alert` |
| DoS of local service | token-bucket rate limiting per identity; bounded plan size; bounded events buffer |
| LLM outage | soft-fail critic/summarizer; deterministic fallbacks; mock provider for CI |

## 2. Data handling

- Local DB: `%APPDATA%/<user-data>/jarvis/jarvis.db` (WAL). Contains tasks/steps/
  executions (stdout/stderr redacted), approvals, audit chain, permissions.
- Secrets: OS keychain via `keytar`; fallback AES-256-GCM file keyed by machine-local
  scrypt (`vault.bin`). Shared secret never rendered back to the UI (only "set ✔").
- Provider traffic: prompt only (never command output, never DB contents).
  Provider responses (plans) are re-validated and re-classified on arrival.

## 3. Execution authorization pipeline

```
plan step ─► [rules classify] ─► [merge with llm_risk: stricter] ─►
   deny        → blocked (security_alert, audit, never executed)
   high/medium → confirm modal → approve? → run  (recorded)
   low (rule)  → auto-run        (recorded)
   unmatched   → medium+confirm  (fail-closed default)
```

- Timeouts: 30s (low) / 120s (medium) / 300s (high). Cancel flag kills the child.
- Child env: stripped of anything containing KEY/TOKEN/SECRET or `AWS_*`.
- Output: capped; persisted redacted; previews redacted in events.

## 4. Service hardening checklist (status)

- [x] Auth required whenever a real provider is configured (`JARVIS_REQUIRE_AUTH`)
- [x] Constant-time secret comparison (hmac.compare_digest)
- [x] Identical 401 body for "absent" vs "wrong" secret
- [x] RFC-7807 problem+json for every error, incl. validation & unhandled
- [x] Security headers: nosniff, DENY frames, no-referrer, no-store
- [x] Rate limit 429 as typed problem (E_RATE_LIMIT)
- [x] Structured JSON logging + redaction filter + request-id correlation
- [x] `docs`/`redoc`/`openapi` disabled on the local surface
- [x] CORS disabled unless explicitly configured
- [x] Metrics exposed on `/metrics` (Prometheus text format)
- [x] Desktop binds service on 127.0.0.1 by default; k8s deployment hardened
      (non-root, read-only rootfs, dropped capabilities, secretKeyRefs)

## 5. Audit chain format

```
row 1: hash=SHA256("000…0" || ts || kind || payload)          (genesis)
row n: prev = row n-1.hash; hash = SHA256(prev || ts || kind || payload)
```
Payloads are redacted before hashing; verification walks front-to-back and
fails on the first mismatched `prev_hash` or recomputed hash.
