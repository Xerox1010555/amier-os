-- Jarvis OS kernel database (single SQLite file, WAL mode).
-- Rust core owns this schema; the desktop UI and the Python orchestrator
-- never write to it directly.

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rule       TEXT NOT NULL,
    result     TEXT NOT NULL CHECK (result IN ('allow', 'require_confirm', 'deny')),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    user_prompt TEXT NOT NULL,
    plan_json  TEXT NOT NULL,
    status     TEXT NOT NULL
      CHECK (status IN ('draft','pending_approval','running','paused','completed','failed','cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_steps (
    id                    TEXT PRIMARY KEY,
    task_id               TEXT NOT NULL REFERENCES tasks(id),
    idx                   INTEGER NOT NULL,
    description           TEXT NOT NULL,
    command               TEXT NOT NULL,
    risk_level            TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','deny')),
    llm_risk_level        TEXT,
    risk_source           TEXT NOT NULL DEFAULT 'rule',
    requires_confirmation INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS step_executions (
    id          TEXT PRIMARY KEY,
    step_id     TEXT NOT NULL REFERENCES task_steps(id),
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    exit_code   INTEGER,
    stdout      TEXT,
    stderr      TEXT,
    timed_out   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS approvals (
    id         TEXT PRIMARY KEY,
    step_id    TEXT NOT NULL REFERENCES task_steps(id),
    decision   TEXT NOT NULL CHECK (decision IN ('approved','denied')),
    decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    kind      TEXT NOT NULL,
    payload   TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    id         TEXT PRIMARY KEY,
    task_id    TEXT NOT NULL REFERENCES tasks(id),
    path       TEXT NOT NULL,
    sha256     TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
    id         TEXT PRIMARY KEY,
    content    TEXT NOT NULL,
    embedding  BLOB,
    source     TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steps_task  ON task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_exec_step   ON step_executions(step_id);
CREATE INDEX IF NOT EXISTS idx_audit_kind  ON audit_log(kind);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
