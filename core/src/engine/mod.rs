//! The execution engine.
//!
//! Lifecycle of a plan:
//! 1. `execute_task` validates the plan JSON, writes `tasks`/`task_steps`,
//!    and spawns a dedicated worker thread (never blocks the JS thread).
//! 2. Each step: deterministic classify (`security::rules`) → merge with the
//!    LLM's advisory level (stricter_of, never de-escalate) → if confirmation
//!    required, register the pending approval and emit `awaiting_confirmation`
//!    → wait on a condvar (bounded) unless cancelled → sandboxed run with
//!    streaming redacted output → persist `step_executions` → emit
//!    `step_done` / `step_denied` / `security_alert`.
//! 3. Every state change lands in the hash-chained audit log.
//!
//! Threading model: the rusqlite `Connection` is `Send` but NOT `Sync`, so it
//! always lives behind `Mutex<Repo>` (which is `Sync`). Worker threads receive
//! `&'static Shared` and lock the DB only for short write windows — never
//! while a process is running.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use serde_json::Value;

use crate::audit;
use crate::EventEnvelope;

pub const MAX_TASK_WORKERS: usize = 8;
pub const EVENT_BUFFER_CAP: usize = 5000;
pub const APPROVAL_WAIT_SECS: u64 = 24 * 3600;

// ─────────────────────────────── Shared state ───────────────────────────────

pub struct EventSink {
    buf: Mutex<Vec<EventEnvelope>>,
    head: AtomicU64,
    tsfn: Mutex<Option<ThreadsafeFunction<EventEnvelope>>>,
}

impl EventSink {
    fn new() -> Self {
        EventSink {
            buf: Mutex::new(Vec::new()),
            head: AtomicU64::new(0),
            tsfn: Mutex::new(None),
        }
    }

    pub fn emit(&self, ev: EventEnvelope) {
        if let Ok(mut buf) = self.buf.lock() {
            if buf.len() >= EVENT_BUFFER_CAP {
                let drop = buf.len() - EVENT_BUFFER_CAP / 2;
                buf.drain(0..drop);
            }
            buf.push(ev.clone());
        }
        self.head.fetch_add(1, Ordering::SeqCst);
        if let Ok(guard) = self.tsfn.lock() {
            if let Some(tsfn) = guard.as_ref() {
                let _ = tsfn.call(Ok(ev), ThreadsafeFunctionCallMode::Blocking);
            }
        }
    }

    pub fn since(&self, cursor: u64) -> Vec<EventEnvelope> {
        match self.buf.lock() {
            Ok(buf) => {
                let cap = self.head.load(Ordering::SeqCst);
                let total = buf.len() as u64;
                let base = cap.saturating_sub(total);
                let offset = cursor.saturating_sub(base);
                buf.iter().skip(offset as usize).cloned().collect()
            }
            Err(_) => Vec::new(),
        }
    }

    pub fn cursor(&self) -> u64 {
        self.head.load(Ordering::SeqCst)
    }

    pub fn register_listener(&self, tsfn: ThreadsafeFunction<EventEnvelope>) {
        if let Ok(mut guard) = self.tsfn.lock() {
            *guard = Some(tsfn);
        }
    }
}

#[derive(Clone, Copy)]
struct ApprovalState {
    decided: bool,
    approved: bool,
}

pub struct Approvals {
    map: Mutex<HashMap<String, ApprovalState>>,
    cond: Condvar,
}

impl Approvals {
    fn new() -> Self {
        Approvals {
            map: Mutex::new(HashMap::new()),
            cond: Condvar::new(),
        }
    }

    pub fn request(&self, step_id: &str) {
        if let Ok(mut map) = self.map.lock() {
            map.insert(step_id.to_string(), ApprovalState { decided: false, approved: false });
        }
    }

    pub fn resolve(&self, step_id: &str, approved: bool) -> bool {
        if let Ok(mut map) = self.map.lock() {
            if let Some(state) = map.get_mut(step_id) {
                state.decided = true;
                state.approved = approved;
                drop(map);
                self.cond.notify_all();
                return true;
            }
        }
        false
    }

    /// Returns the decision, or false when cancelled / timed out.
    pub fn wait(&self, step_id: &str, cancel: &AtomicBool) -> bool {
        let started = Instant::now();
        let Ok(mut map) = self.map.lock() else {
            return false;
        };
        loop {
            if cancel.load(Ordering::SeqCst) {
                return false;
            }
            if let Some(state) = map.get(step_id) {
                if state.decided {
                    return state.approved;
                }
            } else {
                // Unknown/undecided step: fail closed.
                return false;
            }
            let remaining = APPROVAL_WAIT_SECS.saturating_sub(
                started.elapsed().as_secs(),
            );
            if remaining == 0 {
                return false;
            }
            let (guard, _) = match self
                .cond
                .wait_timeout(map, Duration::from_millis(300))
            {
                Ok(pair) => pair,
                Err(_) => return false,
            };
            map = guard;
        }
    }

    pub fn pending_count(&self) -> f64 {
        match self.map.lock() {
            Ok(map) => map.values().filter(|s| !s.decided).count() as f64,
            Err(_) => 0.0,
        }
    }
}

pub struct TaskRuntime {
    pub cancel: Arc<AtomicBool>,
}

pub struct Shared {
    pub repo: Mutex<RepoGuard>,
    pub events: Arc<EventSink>,
    pub approvals: Approvals,
    pub tasks: Mutex<HashMap<String, Arc<TaskRuntime>>>,
}

type RepoGuard = crate::db::Repo;

static SHARED: OnceLock<Shared> = OnceLock::new();

pub fn core() -> Option<&'static Shared> {
    SHARED.get()
}

pub fn boot(db_path: &std::path::Path) -> napi::Result<()> {
    if SHARED.get().is_some() {
        return Ok(());
    }
    if let Some(parent) = db_path.parent().filter(|p| !p.as_os_str().is_empty()) {
        let _ = std::fs::create_dir_all(parent);
    }
    let repo = crate::db::Repo::open(db_path)?;
    repo.seal_genesis_if_empty()?;
    let shared = Shared {
        repo: Mutex::new(repo),
        events: Arc::new(EventSink::new()),
        approvals: Approvals::new(),
        tasks: Mutex::new(HashMap::new()),
    };
    shared.events.emit(EventEnvelope::new(
        "engine_ready",
        None,
        None,
        "{\"source\":\"rust-kernel\",\"mode\":\"deterministic-rules\"}".to_string(),
    ));
    let _ = SHARED.set(shared);
    Ok(())
}

// ─────────────────────────────── Plan handling ──────────────────────────────

pub struct PlanStep {
    pub step_id: String,
    pub idx: usize,
    pub description: String,
    pub command: String,
    pub llm_risk_level: String,
    pub llm_requires_confirmation: bool,
}

static STEP_SEQ: AtomicU64 = AtomicU64::new(0);

impl PlanStep {
    fn from_value(v: &Value, idx: usize) -> Option<PlanStep> {
        let description = v.get("description").and_then(Value::as_str)?;
        let command = v.get("command").and_then(Value::as_str)?;
        if description.trim().is_empty() || command.trim().is_empty() {
            return None;
        }
        let seq = STEP_SEQ.fetch_add(1, Ordering::SeqCst);
        let step_id = format!("st-{}-{}-{seq}", Utc::now().timestamp_millis(), idx);
        Some(PlanStep {
            step_id,
            idx,
            description: description.to_string(),
            command: command.to_string(),
            llm_risk_level: v
                .get("llm_risk_level")
                .and_then(Value::as_str)
                .unwrap_or("medium")
                .to_string(),
            llm_requires_confirmation: v
                .get("llm_requires_confirmation")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        })
    }
}

pub fn parse_plan(plan_json: &str) -> napi::Result<Vec<PlanStep>> {
    let value: Value = serde_json::from_str(plan_json)
        .map_err(|e| napi::Error::from_reason(format!("plan_json is not valid JSON: {e}")))?;
    let steps_value = value.as_object().and_then(|o| o.get("steps")).cloned();
    let Some(steps_value) = steps_value else {
        return Err(napi::Error::from_reason("plan_json lacked a steps array"));
    };
    let arr = steps_value.as_array().cloned().unwrap_or_default();
    let mut steps = Vec::new();
    for (idx, raw) in arr.iter().enumerate() {
        if let Some(s) = PlanStep::from_value(raw, idx) {
            steps.push(s);
        }
    }
    if steps.is_empty() {
        return Err(napi::Error::from_reason("plan_json had no valid steps"));
    }
    Ok(steps)
}

// ───────────────────────────── The worker pipeline ──────────────────────────

/// Write task + step rows before execution begins.
fn ensure_task_rows(shard: &Shared, task_id: &str, user_prompt: &str, plan_json: &str, steps: &[PlanStep]) -> napi::Result<()> {
    let now = audit::now_iso();
    let guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    guard.conn.execute(
        "INSERT INTO tasks(id, user_prompt, plan_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pending_approval', ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET plan_json = ?3, updated_at = ?4",
        rusqlite::params![task_id, user_prompt, plan_json, now],
    )
    .map_err(crate::db::db_err)?;
    for s in steps {
        guard.conn.execute(
            "INSERT OR REPLACE INTO task_steps
                (id, task_id, idx, description, command, risk_level, llm_risk_level,
                 risk_source, requires_confirmation, status)
             VALUES (?1, ?2, ?3, ?4, ?5, 'medium', ?6, 'plan', ?7, 'pending')",
            rusqlite::params![
                s.step_id,
                task_id,
                s.idx as i64,
                s.description,
                s.command,
                s.llm_risk_level,
                if s.llm_requires_confirmation { 1 } else { 0 }
            ],
        )
        .map_err(crate::db::db_err)?;
    }
    audit::append(
        &guard.conn,
        "task_created",
        &serde_json::json!({
            "task_id": task_id,
            "user_prompt": crate::security::secrets::redact(user_prompt),
            "steps": steps.len(),
        })
        .to_string(),
    )?;
    Ok(())
}

/// Bridge entrypoint: returns immediately, work runs on a dedicated thread.
pub fn run_task(
    shard: &'static Shared,
    task_id: &str,
    user_prompt: &str,
    plan_json: &str,
    steps: Vec<PlanStep>,
) -> napi::Result<()> {
    let over_limit = shard
        .tasks
        .lock()
        .map(|m| m.len() >= MAX_TASK_WORKERS)
        .unwrap_or(true);
    if over_limit {
        return Err(napi::Error::from_reason("concurrent task limit reached (max 8)"));
    }
    ensure_task_rows(shard, task_id, user_prompt, plan_json, &steps)?;

    let runtime = Arc::new(TaskRuntime {
        cancel: Arc::new(AtomicBool::new(false)),
    });
    if let Ok(mut map) = shard.tasks.lock() {
        map.insert(task_id.to_string(), runtime.clone());
    }
    shard.events.emit(EventEnvelope::new(
        "task_started",
        Some(task_id),
        None,
        serde_json::json!({"steps": steps.len()}).to_string(),
    ));

    let events = shard.events.clone();
    let task_id_owned = task_id.to_string();
    let prompt_owned = user_prompt.to_string();
    let cancel = runtime.cancel.clone();

    std::thread::Builder::new()
        .name(format!("jarvis-exec-{task_id}"))
        .spawn(move || {
            if let Some(static_shard) = core() {
                execute_pipeline(static_shard, &events, &task_id_owned, &prompt_owned, steps, &cancel);
            } else {
                // Boot was not finalized — task cannot run safely anywhere.
                let _ = events;
            }
            // Free the runtime slot.
            if let Some(s) = core() {
                if let Ok(mut tasks) = s.tasks.lock() {
                    tasks.remove(&task_id_owned);
                }
            }
        })
        .map_err(|e| napi::Error::from_reason(format!("failed to spawn worker: {e}")))?;
    Ok(())
}

fn execute_pipeline(
    shard: &'static Shared,
    events: &EventSink,
    task_id: &str,
    user_prompt: &str,
    steps: Vec<PlanStep>,
    cancel: &Arc<AtomicBool>,
) {
    let _ = user_prompt;
    let mut completed = 0usize;
    let mut denied = 0usize;
    let mut failed = 0usize;

    for step in steps {
        if cancel.load(Ordering::SeqCst) {
            finish_task(shard, events, task_id, "cancelled", completed, denied, failed);
            return;
        }

        // ── Authoritative classification (rules + advisory LLM merge) ──
        let verdict = crate::security::rules::classify(&step.command, Some(&step.llm_risk_level));
        let risk_source = if verdict.risk_level == step.llm_risk_level {
            "rule"
        } else {
            "rule+llm"
        };

        let _ = set_step_risk(shard, &step, &verdict, risk_source, "pending");

        if verdict.risk_level == crate::security::rules::RISK_DENY {
            denied += 1;
            deny_step(shard, events, task_id, &step, &verdict, "policy_deny");
            continue;
        }

        events.emit(EventEnvelope::new(
            "step_started",
            Some(task_id),
            Some(&step.step_id),
            serde_json::json!({
                "idx": step.idx,
                "description": step.description,
                "command": crate::security::secrets::redact(&step.command),
                "risk_level": verdict.risk_level,
                "matched_rule": verdict.matched_rule,
                "risk_source": risk_source,
                "requires_confirmation": verdict.requires_confirmation,
            })
            .to_string(),
        ));

        if verdict.requires_confirmation {
            shard.approvals.request(&step.step_id);
            events.emit(EventEnvelope::new(
                "awaiting_confirmation",
                Some(task_id),
                Some(&step.step_id),
                serde_json::json!({
                    "command": crate::security::secrets::redact(&step.command),
                    "risk_level": verdict.risk_level,
                    "matched_rule": verdict.matched_rule,
                })
                .to_string(),
            ));
            audit_task(shard, "awaiting_confirmation", task_id, Some(&step.step_id), &verdict);
            let approved = shard.approvals.wait(&step.step_id, cancel);
            let _ = record_approval(shard, &step.step_id, approved);
            if !approved {
                denied += 1;
                let _ = set_step_status(shard, &step.step_id, "denied");
                events.emit(EventEnvelope::new(
                    "step_denied",
                    Some(task_id),
                    Some(&step.step_id),
                    serde_json::json!({"reason": "user_denied_or_cancelled"}).to_string(),
                ));
                audit_task(shard, "step_denied", task_id, Some(&step.step_id), &verdict);
                continue;
            }
        }

        let _ = set_step_status(shard, &step.step_id, "running");
        let outcome = run_command(&step.command, &verdict.risk_level, cancel);
        let _ = record_execution(shard, &step, &outcome);
        let ok = outcome.exit_code == Some(0);
        let _ = set_step_status(shard, &step.step_id, if ok { "done" } else { "failed" });
        if ok {
            completed += 1;
        } else {
            failed += 1;
        }
        events.emit(EventEnvelope::new(
            "step_done",
            Some(task_id),
            Some(&step.step_id),
            serde_json::json!({
                "exit_code": outcome.exit_code,
                "ok": ok,
                "stdout_preview": crate::security::secrets::redact(&preview_lines(&outcome.stdout, 12)),
                "stderr_preview": crate::security::secrets::redact(&preview_lines(&outcome.stderr, 6)),
                "timed_out": outcome.timed_out,
                "cancelled": outcome.cancelled,
            })
            .to_string(),
        ));
        audit_task(shard, "step_done", task_id, Some(&step.step_id), &verdict);
    }

    let status = if failed > 0 && completed == 0 {
        "failed"
    } else {
        "completed"
    };
    finish_task(shard, events, task_id, status, completed, denied, failed);
}

fn finish_task(shard: &'static Shared, events: &EventSink, task_id: &str, status: &str, completed: usize, denied: usize, failed: usize) {
    if let Ok(mut guard) = shard.repo.lock() {
        let now = audit::now_iso();
        let _ = guard.conn.execute(
            "UPDATE tasks SET status = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![task_id, status, now],
        );
        let _ = audit::append(
            &guard.conn,
            "task_done",
            &serde_json::json!({"task_id": task_id, "status": status,
                "completed": completed, "denied": denied, "failed": failed}).to_string(),
        );
    }
    events.emit(EventEnvelope::new(
        "task_done",
        Some(task_id),
        None,
        serde_json::json!({"status": status, "completed": completed, "denied": denied, "failed": failed}).to_string(),
    ));
}

fn deny_step(shard: &'static Shared, events: &EventSink, task_id: &str, step: &PlanStep, verdict: &crate::RiskVerdict, reason: &str) {
    let _ = set_step_risk(shard, step, verdict, "rule", "denied");
    events.emit(EventEnvelope::new(
        "security_alert",
        Some(task_id),
        Some(&step.step_id),
        serde_json::json!({
            "kind": "denied",
            "reason": reason,
            "command": crate::security::secrets::redact(&step.command),
            "risk_level": verdict.risk_level,
            "matched_rule": verdict.matched_rule,
        })
        .to_string(),
    ));
    events.emit(EventEnvelope::new(
        "step_denied",
        Some(task_id),
        Some(&step.step_id),
        serde_json::json!({"risk_level": verdict.risk_level, "reason": reason}).to_string(),
    ));
    audit_task(shard, "step_denied", task_id, Some(&step.step_id), verdict);
}

fn audit_task(shard: &'static Shared, kind: &str, task_id: &str, step_id: Option<&str>, verdict: &crate::RiskVerdict) {
    if let Ok(mut guard) = shard.repo.lock() {
        let _ = audit::append(
            &guard.conn,
            kind,
            &serde_json::json!({
                "task_id": task_id,
                "step_id": step_id,
                "risk_level": verdict.risk_level,
                "rule": verdict.matched_rule,
            })
            .to_string(),
        );
    }
}

fn set_step_risk(shard: &'static Shared, step: &PlanStep, verdict: &crate::RiskVerdict, risk_source: &str, status: &str) -> napi::Result<()> {
    let mut guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    guard
        .conn
        .execute(
            "UPDATE task_steps SET risk_level = ?2, risk_source = ?3,
                  requires_confirmation = ?4, status = ?5
             WHERE id = ?1",
            rusqlite::params![
                step.step_id,
                verdict.risk_level,
                risk_source,
                if verdict.requires_confirmation { 1 } else { 0 },
                status
            ],
        )
        .map_err(crate::db::db_err)?;
    Ok(())
}

fn set_step_status(shard: &'static Shared, step_id: &str, status: &str) -> napi::Result<()> {
    let mut guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    guard
        .conn
        .execute(
            "UPDATE task_steps SET status = ?2 WHERE id = ?1",
            rusqlite::params![step_id, status],
        )
        .map_err(crate::db::db_err)?;
    Ok(())
}

fn record_approval(shard: &'static Shared, step_id: &str, approved: bool) -> napi::Result<()> {
    let mut guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    let decision = if approved { "approved" } else { "denied" };
    guard
        .conn
        .execute(
            "INSERT OR REPLACE INTO approvals(id, step_id, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![format!("ap-{step_id}"), step_id, decision, audit::now_iso()],
        )
        .map_err(crate::db::db_err)?;
    Ok(())
}

fn record_execution(shard: &'static Shared, step: &PlanStep, outcome: &ExecOutcome) -> napi::Result<()> {
    let mut guard = shard
        .repo
        .lock()
        .map_err(|_| napi::Error::from_reason("engine db lock poisoned"))?;
    guard
        .conn
        .execute(
            "INSERT OR REPLACE INTO step_executions
                 (id, step_id, started_at, ended_at, exit_code, stdout, stderr, timed_out)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                format!("ex-{}", step.step_id),
                step.step_id,
                audit::now_iso(),
                audit::now_iso(),
                outcome.exit_code,
                outcome.stdout,
                outcome.stderr,
                if outcome.timed_out || outcome.cancelled { 1 } else { 0 },
            ],
        )
        .map_err(crate::db::db_err)?;
    Ok(())
}

fn preview_lines(out: &str, max: usize) -> String {
    let lines: Vec<&str> = out.lines().collect();
    let start = lines.len().saturating_sub(max);
    lines[start..].join("\n")
}

// ───────────────────────────── Process execution ───────────────────────────

pub struct ExecOutcome {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

type StreamTx = std::sync::mpsc::Sender<(String, String)>;

pub fn run_command(command: &str, risk_level: &str, cancel: &Arc<AtomicBool>) -> ExecOutcome {
    use std::process::{Command, Stdio};

    let spec = crate::security::sandbox::spawn_spec(command);
    let mut child = match Command::new(&spec.program)
        .args(&spec.args)
        .env_clear()
        .envs(crate::security::sandbox::scrub_env())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return ExecOutcome {
                exit_code: Some(-1),
                stdout: String::new(),
                stderr: format!("failed to spawn: {e}"),
                timed_out: false,
                cancelled: false,
            };
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, rx) = std::sync::mpsc::channel::<(String, String)>();

    let mut readers = Vec::new();
    if let Some(out_stream) = stdout {
        spawn_reader(out_stream, "stdout", tx.clone(), &mut readers);
    }
    if let Some(err_stream) = stderr {
        spawn_reader(err_stream, "stderr", tx.clone(), &mut readers);
    }
    drop(tx);

    let timeout = Duration::from_secs(crate::security::rules::timeout_for(risk_level));
    let started = Instant::now();
    let mut collected: Vec<(String, String)> = Vec::new();
    let mut timed_out = false;
    let mut cancelled = false;
    use wait_timeout::ChildExt;

    let mut status: Option<std::process::ExitStatus> = None;
    loop {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            let _ = child.kill();
            status = child.wait().ok();
            break;
        }
        let mut got_chunk = false;
        while let Ok((stream, line)) = rx.try_recv() {
            if collected.len() < 20_000 {
                collected.push((stream, line));
            }
            got_chunk = true;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            let _ = child.kill();
            status = child.wait().ok();
            break;
        }
        match child.wait_timeout(Duration::from_millis(120)) {
            Ok(Some(s)) => {
                status = Some(s);
                break;
            }
            Ok(None) => {
                let _ = got_chunk;
                continue;
            }
            Err(_) => break,
        }
    }
    while let Ok((stream, line)) = rx.try_recv() {
        collected.push((stream, line));
    }

    // Drain final exit status if wait_timeout timed out earlier already handled.
    if status.is_none() {
        status = child.wait().ok();
    }

    for reader in readers {
        let _ = reader.join();
    }

    ExecOutcome {
        exit_code: status.as_ref().and_then(std::process::ExitStatus::code),
        stdout: join_lines(&collected, "stdout"),
        stderr: join_lines(&collected, "stderr"),
        timed_out,
        cancelled,
    }
}

fn spawn_reader<R: std::io::Read + Send + 'static>(stream: R, name: &'static str, tx: StreamTx, readers: &mut Vec<std::thread::JoinHandle<()>>) {
    if let Ok(handle) = std::thread::Builder::new()
        .name(format!("jarvis-{name}"))
        .spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                if tx.send((name.to_string(), line)).is_err() {
                    break;
                }
            }
        })
    {
        readers.push(handle);
    }
}

fn join_lines(items: &[(String, String)], which: &str) -> String {
    items
        .iter()
        .filter(|(s, _)| s == which)
        .map(|(_, l)| l.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

// ─────────────────────────────── Status view ───────────────────────────────

pub fn status(shard: &'static Shared) -> crate::StatusInfo {
    let (active, db_ok) = match shard.repo.lock() {
        Ok(guard) => (guard.active_task_count(), true),
        Err(_) => (0.0, false),
    };
    crate::StatusInfo {
        version: crate::VERSION.to_string(),
        engine_ready: true,
        db_ok,
        rules_count: crate::security::rules::default_rules().len() as f64,
        active_tasks: active,
        decisions_waiting: shard.approvals.pending_count(),
    }
}
