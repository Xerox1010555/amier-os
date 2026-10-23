//! NAPI bridge — all functions exposed to JavaScript via napi-rs.
//!
//! Called strictly from the Electron MAIN process (never the renderer).
//! The renderer reaches these only through the typed IPC surface defined in
//! `packages/shared/src/ipc.ts` and enforced by the preload whitelist.

use std::sync::atomic::Ordering;

use napi::threadsafe_function::ThreadsafeFunction;

use crate::audit;
use crate::engine::{self, core};
use crate::security::rules;
use crate::{AuditEntry, ChainStatus, EventEnvelope, PermissionEntry, RiskVerdict, StatusInfo, StepDetail, TaskDetail, TaskSummary};

/// Boot the engine against a database file (absolute or relative path).
/// Resolved order: argument → JARVIS_DB env → default local ./db/jarvis.db.
#[napi]
pub fn initialize_core(db_path: Option<String>) -> Result<String, napi::Error> {
    let path = db_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| {
            std::env::var("JARVIS_DB")
                .ok()
                .filter(|p| !p.trim().is_empty())
                .unwrap_or_else(|| "./db/jarvis.db".to_string())
        });
    engine::boot(std::path::Path::new(&path))?;
    Ok(format!("AI OS Core {} initialized at {path}", crate::VERSION))
}

const _VERSION_REEXPORT: &str = crate::VERSION;

/// Deterministic risk classification. Authoritative; the LLM level is a
/// hint only (`classify` always keeps the stricter of the two).
#[napi]
pub fn classify_risk(command: String, llm_risk_level: Option<String>) -> RiskVerdict {
    rules::classify(&command, llm_risk_level.as_deref())
}

/// Why a command was blocked (UI + audit convenience).
#[napi]
pub fn get_deny_explanation(command: String) -> Option<String> {
    let verdict = rules::classify_rules(&command);
    if verdict.risk_level != rules::RISK_DENY {
        return None;
    }
    let rule = verdict.matched_rule.as_deref().and_then(|id| {
        rules::default_rules().iter().find(|r| r.id == id)
    });
    Some(match rule {
        Some(r) => format!("Blocked: {} (rule {}).", r.why, r.id),
        None => "Blocked by policy (llm:deny).".to_string(),
    })
}

#[napi]
pub fn get_status() -> Result<StatusInfo, napi::Error> {
    match core() {
        Some(shard) => Ok(engine::status(shard)),
        None => Ok(StatusInfo {
            version: crate::VERSION.to_string(),
            engine_ready: false,
            db_ok: false,
            rules_count: rules::default_rules().len() as f64,
            active_tasks: 0.0,
            decisions_waiting: 0.0,
        }),
    }
}

/// Start executing a plan from JSON ({"task_id": ...,"steps":[...]}).
/// The planner's task id is used so desktop ↔ service references line up.
#[napi]
pub fn execute_task(task_id: String, user_prompt: String, plan_json: String) -> Result<String, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized; call initializeCore() first"))?;
    let steps = engine::parse_plan(&plan_json)?;
    engine::run_task(shard, &task_id, &user_prompt, &plan_json, steps)?;
    Ok(format!("task {task_id} queued"))
}

/// Approve or deny a step awaiting human decision.
#[napi]
pub fn approve_step(step_id: String, approved: bool) -> Result<bool, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    Ok(shard.approvals.resolve(&step_id, approved))
}

#[napi]
pub fn cancel_task(task_id: String) -> Result<bool, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    let runtime = shard
        .tasks
        .lock()
        .map_err(|_| napi::Error::from_reason("tasks lock poisoned"))?
        .get(&task_id)
        .map(|r| r.cancel.clone());
    match runtime {
        Some(cancel_flag) => {
            cancel_flag.store(true, Ordering::SeqCst);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[napi]
pub fn list_tasks() -> Result<Vec<TaskSummary>, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    let guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    let conn = &guard.conn;
    let mut stmt = conn
        .prepare(
            "SELECT id, user_prompt, status, created_at FROM tasks ORDER BY updated_at DESC LIMIT 200",
        )
        .map_err(crate::db::db_err)?;
    let rows = stmt
        .query_map([], |row| {
            let task_id: String = row.get(0).unwrap_or_default();
            let (total, done, denied) = guard.count_steps_for_task(&task_id);
            Ok(TaskSummary {
                task_id: task_id,
                user_prompt: row.get(1).unwrap_or_default(),
                status: row.get(2).unwrap_or_default(),
                created_at: row.get(3).unwrap_or_default(),
                steps_total: total,
                steps_done: done,
                steps_denied: denied,
            })
        })
        .map_err(crate::db::db_err)?;
    let mut out = Vec::new();
    for row in rows {
        if let Ok(summary) = row {
            out.push(summary);
        }
    }
    Ok(out)
}

#[napi]
pub fn get_task(task_id: String) -> Result<Option<TaskDetail>, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    let guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    let conn = &guard.conn;
    let summary = match conn.query_row(
        "SELECT id, user_prompt, status, created_at, plan_json FROM tasks WHERE id = ?1",
        [&task_id],
        |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
                row.get::<_, String>(3).unwrap_or_default(),
                row.get::<_, String>(4).unwrap_or_default(),
            ))
        },
    ) {
        Ok((id, prompt, status, created, plan)) => TaskSummary {
            task_id: id,
            user_prompt: prompt,
            status,
            created_at: created,
            steps_total: 0.0,
            steps_done: 0.0,
            steps_denied: 0.0,
        },
        Err(_) => return Ok(None),
    };
    let (total, done, denied) = guard.count_steps_for_task(&task_id);
    let mut steps: Vec<StepDetail> = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.idx, s.description, s.command, s.risk_level, s.llm_risk_level,
                    s.risk_source, s.requires_confirmation, s.status,
                    COALESCE(e.exit_code, -1), COALESCE(e.timed_out, 0)
             FROM task_steps s
             LEFT JOIN step_executions e ON e.step_id = s.id
             WHERE s.task_id = ?1 ORDER BY s.idx ASC",
        )
        .map_err(crate::db::db_err)?;
    let rows = stmt
        .query_map([&task_id], |row| {
            Ok(StepDetail {
                step_id: row.get(0).unwrap_or_default(),
                idx: row.get::<_, i64>(1).map(|v| v as f64).unwrap_or(0.0),
                description: row.get(2).unwrap_or_default(),
                command: row.get(3).unwrap_or_default(),
                risk_level: row.get(4).unwrap_or_default(),
                llm_risk_level: row.get(5).unwrap_or_default(),
                risk_source: row.get(6).unwrap_or_default(),
                requires_confirmation: row.get::<_, i64>(7).map(|v| v == 1).unwrap_or(false),
                status: row.get(8).unwrap_or_default(),
                exit_code: {
                    let code: i64 = row.get(9).unwrap_or(-1);
                    if code < 0 {
                        None
                    } else {
                        Some(code as f64)
                    }
                },
                timed_out: row.get::<_, i64>(10).map(|v| v == 1).unwrap_or(false),
            })
        })
        .map_err(crate::db::db_err)?;
    for row in rows {
        if let Ok(step) = row {
            steps.push(step);
        }
    }
    Ok(Some(TaskDetail {
        plan_json: summary_plan_json(conn, &task_id),
        summary: TaskSummary {
            steps_total: total,
            steps_done: done,
            steps_denied: denied,
            ..summary
        },
        steps,
    }))
}

fn summary_plan_json(conn: &rusqlite::Connection, task_id: &str) -> String {
    conn.query_row(
        "SELECT plan_json FROM tasks WHERE id = ?1",
        [task_id],
        |row| row.get(0),
    )
    .unwrap_or_else(|_| "{}".to_string())
}

#[napi]
pub fn get_audit_trail(cursor: Option<f64>, limit: Option<f64>) -> Result<Vec<AuditEntry>, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    let guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    audit::trail(&guard, cursor, limit)
}

#[napi]
pub fn verify_audit_chain() -> Result<ChainStatus, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    let guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    audit::verify(&guard)
}

#[napi]
pub fn upsert_permission(rule: String, result: String) -> Result<bool, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    if !matches!(result.as_str(), "allow" | "require_confirm" | "deny") {
        return Err(napi::Error::from_reason("result must be allow|require_confirm|deny"));
    }
    let guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    let now = audit::now_iso();
    guard
        .conn
        .execute(
            "INSERT INTO permissions(rule, result, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(rule) DO UPDATE SET result = ?2, updated_at = ?3",
            rusqlite::params![rule, result, now],
        )
        .map_err(crate::db::db_err)?;
    audit::append(
        &guard.conn,
        "permission_changed",
        &serde_json::json!({"rule": rule, "result": result}).to_string(),
    )?;
    Ok(true)
}

#[napi]
pub fn delete_permission(rule: String) -> Result<bool, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    let guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    guard
        .conn
        .execute("DELETE FROM permissions WHERE rule = ?1", [rule])
        .map_err(crate::db::db_err)?;
    Ok(true)
}

#[napi]
pub fn list_permissions() -> Result<Vec<PermissionEntry>, napi::Error> {
    let shard = core().ok_or_else(|| napi::Error::from_reason("engine not initialized"))?;
    let guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    let mut stmt = guard
        .conn
        .prepare("SELECT id, rule, result, updated_at FROM permissions ORDER BY id ASC")
        .map_err(crate::db::db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PermissionEntry {
                id: row.get::<_, i64>(0).map(|v| v as f64).unwrap_or(0.0),
                rule: row.get(1).unwrap_or_default(),
                result: row.get(2).unwrap_or_default(),
                updated_at: row.get(3).unwrap_or_default(),
            })
        })
        .map_err(crate::db::db_err)?;
    let mut out = Vec::new();
    for row in rows {
        if let Ok(entry) = row {
            out.push(entry);
        }
    }
    Ok(out)
}

/// Live event subscription: registered once by the Electron main process.
#[napi]
pub fn register_event_listener(callback: ThreadsafeFunction<EventEnvelope>) -> Result<String, napi::Error> {
    match core() {
        Some(shard) => {
            shard.events.register_listener(callback);
            Ok("listener registered".to_string())
        }
        None => Err(napi::Error::from_reason("engine not initialized")),
    }
}

/// Pull-based events (head cursor). Reliable fallback for UI rehydration.
#[napi]
pub fn poll_events(cursor: Option<f64>) -> Result<Vec<EventEnvelope>, napi::Error> {
    match core() {
        Some(shard) => Ok(shard.events.since(cursor.unwrap_or(0.0).max(0.0) as u64)),
        None => Ok(Vec::new()),
    }
}

#[napi]
pub fn event_head() -> Result<f64, napi::Error> {
    Ok(core()
        .map(|s| s.events.cursor() as f64)
        .unwrap_or(0.0))
}
