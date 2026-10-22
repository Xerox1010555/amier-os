"""Seed helper: inspect/touch the kernel DB without Rust.

Uses stdlib sqlite3 with the same schema migrations, handy for:
  * creating a throwaway DB for the Python service's integration tests
  * reading audit/tasks during support sessions

Usage:
  python scripts/seed_db.py [--db path] [--show audit|tasks] [--demo]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

MIGRATION = Path(__file__).resolve().parent.parent / "core" / "migrations" / "0001_init.sql"


def ensure_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(MIGRATION.read_text(encoding="utf-8"))
    return conn


def demo(conn: sqlite3.Connection) -> None:
    """Insert a tiny demo task + two steps + audit chain anchor."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    task_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO tasks(id, user_prompt, plan_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (task_id, "list downloads folder contents", json.dumps({"task_id": task_id, "steps": []}),
         "completed", now, now),
    )
    conn.executemany(
        "INSERT OR REPLACE INTO task_steps(id, task_id, idx, description, command, risk_level, llm_risk_level, risk_source, requires_confirmation, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
            (f"st-demo-1", task_id, 0, "List the Downloads folder", "dir /b %USERPROFILE%\\Downloads", "low", "low", "rule", 0, "done"),
            (f"st-demo-2", task_id, 1, "Show sizes summary", "echo summary", "low", "low", "rule", 0, "done"),
        ],
    )
    prev = "0" * 64
    for i, (kind, payload) in enumerate(
        [("genesis", json.dumps({"note": "seed"})),
         ("task_created", json.dumps({"task_id": task_id})) ]
    ):
        import hashlib
        ts = now
        digest = hashlib.sha256(prev.encode() + b"||" + ts.encode() + b"||" + kind.encode() + b"||" + payload.encode()).hexdigest()
        conn.execute(
            "INSERT INTO audit_log(ts, kind, payload, prev_hash, hash) VALUES (?,?,?,?,?)",
            (ts, kind, payload, prev, digest),
        )
        prev = digest
    conn.commit()
    print(f"seeded task {task_id}")


def show(conn: sqlite3.Connection, what: str) -> None:
    table, cols = {
        "audit": ("audit_log", ["seq", "ts", "kind", "hash"]),
        "tasks": ("tasks", ["id", "status", "created_at"]),
    }[what]
    rows = conn.execute(f"SELECT {','.join(cols)} FROM {table} ORDER BY rowid DESC LIMIT 20").fetchall()
    for row in rows:
        print(json.dumps(dict(zip(cols, [str(r)[:24] for r in row])), ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=None, help="sqlite path (default: %TEMP%/jarvis-seed.db)")
    parser.add_argument("--show", choices=["audit", "tasks"], default=None)
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()

    db_path = args.db or str(Path(__import__("tempfile").gettempdir()) / "jarvis-seed.db")
    conn = ensure_db(db_path)
    print(f"db ready: {db_path}")
    try:
        if args.demo:
            demo(conn)
        if args.show:
            show(conn, args.show)
        if not args.demo and not args.show:
            tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            print("tables:", ", ".join(tables))
    finally:
        conn.close()
        sys.exit(0)


if __name__ == "__main__":
    main()
