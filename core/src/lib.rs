//! Jarvis OS core — deterministic security kernel and sandboxed executor.
//!
//! Architecture invariants (see docs/ARCHITECTURE.md):
//! * The LLM proposes; this kernel decides (risk classification is 100% rule
//!   based — `security::rules`) and executes (sandboxed, audited).
//! * Nothing mutates the machine without a matching audit-log hash-chain entry.
//! * The engine owns the SQLite database as the single source of truth.

#![warn(clippy::unwrap_used)]
#![warn(clippy::expect_used)]

#[macro_use]
extern crate napi_derive;

pub mod audit;
pub mod bridge;
pub mod db;
pub mod engine;
pub mod security;

/// Engine version mirrors the repository VERSION file at release time.
pub const VERSION: &str = "1.0.0";

use napi::bindgen_prelude::*;

/// Wire type for a risk verdict. `risk_level` is authoritative (derived from
/// the ruleset), never a copy of what any LLM suggested.
#[napi(object)]
pub struct RiskVerdict {
    /// low | medium | high | deny
    pub risk_level: String,
    pub matched_rule: Option<String>,
    pub requires_confirmation: bool,
}

#[napi(object)]
pub struct StatusInfo {
    pub version: String,
    pub engine_ready: bool,
    pub db_ok: bool,
    pub rules_count: f64,
    pub active_tasks: f64,
    pub decisions_waiting: f64,
}

#[napi(object)]
pub struct EventEnvelope {
    pub event_type: String,
    pub task_id: Option<String>,
    pub step_id: Option<String>,
    /// JSON object payload, redacted.
    pub payload: String,
}

impl Clone for EventEnvelope {
    fn clone(&self) -> Self {
        EventEnvelope {
            event_type: self.event_type.clone(),
            task_id: self.task_id.clone(),
            step_id: self.step_id.clone(),
            payload: self.payload.clone(),
        }
    }
}

impl EventEnvelope {
    pub fn new(event_type: &str, task_id: Option<&str>, step_id: Option<&str>, payload: String) -> Self {
        EventEnvelope {
            event_type: event_type.to_string(),
            task_id: task_id.map(|s| s.to_string()),
            step_id: step_id.map(|s| s.to_string()),
            payload,
        }
    }
}

#[napi(object)]
pub struct TaskSummary {
    pub task_id: String,
    pub user_prompt: String,
    pub status: String,
    pub created_at: String,
    pub steps_total: f64,
    pub steps_done: f64,
    pub steps_denied: f64,
}

#[napi(object)]
pub struct StepDetail {
    pub step_id: String,
    pub idx: f64,
    pub description: String,
    pub command: String,
    pub risk_level: String,
    pub llm_risk_level: String,
    pub risk_source: String,
    pub requires_confirmation: bool,
    pub status: String,
    pub exit_code: Option<f64>,
    pub timed_out: bool,
}

#[napi(object)]
pub struct TaskDetail {
    pub summary: TaskSummary,
    pub plan_json: String,
    pub steps: Vec<StepDetail>,
}

#[napi(object)]
pub struct AuditEntry {
    pub seq: f64,
    pub ts: String,
    pub kind: String,
    pub hash: String,
    pub payload: String,
}

#[napi(object)]
pub struct ChainStatus {
    pub intact: bool,
    pub broken_at: Option<f64>,
    pub last_hash: Option<String>,
    pub entries: f64,
}

#[napi(object)]
pub struct PermissionEntry {
    pub id: f64,
    pub rule: String,
    /// allow | require_confirm | deny
    pub result: String,
    pub updated_at: String,
}
