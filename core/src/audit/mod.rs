//! Append-only, hash-chained audit log.
//!
//! `hash = SHA256(prev_hash || ts || kind || payload)` — any tampering with
//! history invalidates all subsequent entries and `verify_audit_chain()`
//! reports the first broken sequence.

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::db::Repo;
use crate::ChainStatus;

pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn chain_hash(prev: &str, ts: &str, kind: &str, payload: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prev.as_bytes());
    hasher.update("||");
    hasher.update(ts.as_bytes());
    hasher.update("||");
    hasher.update(kind.as_bytes());
    hasher.update("||");
    hasher.update(payload.as_bytes());
    crate::security::secrets::sha256_hex(&hasher.finalize())
}

/// Append one audit entry with automatic redaction and chaining.
pub fn append(conn: &Connection, kind: &str, payload: &str) -> napi::Result<()> {
    let ts = now_iso();
    let prev = last_hash(conn).unwrap_or_else(|| GENESIS_HASH.to_string());
    let redacted = crate::security::secrets::redact(payload);
    let hash = chain_hash(&prev, &ts, kind, &redacted);
    conn.execute(
        "INSERT INTO audit_log(ts, kind, payload, prev_hash, hash) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![ts, kind, redacted, prev, hash],
    )
    .map_err(crate::db::db_err)?;
    Ok(())
}

pub fn last_hash(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

pub fn trail(repo: &Repo, cursor: Option<f64>, limit: Option<f64>) -> napi::Result<Vec<crate::AuditEntry>> {
    let seq_cursor = cursor.unwrap_or(0.0) as i64;
    let cap = limit.unwrap_or(50.0).clamp(1.0, 500.0) as i64;
    let mut stmt = repo
        .conn
        .prepare(
            "SELECT seq, ts, kind, hash, payload FROM audit_log
             WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
        )
        .map_err(crate::db::db_err)?;
    let rows = stmt
        .query_map([seq_cursor, cap], |row| {
            Ok(crate::AuditEntry {
                seq: row.get::<_, i64>(0).map(|v| v as f64).unwrap_or(0.0),
                ts: row.get(1).unwrap_or_default(),
                kind: row.get(2).unwrap_or_default(),
                hash: row.get(3).unwrap_or_default(),
                payload: row.get(4).unwrap_or_default(),
            })
        })
        .map_err(crate::db::db_err)?;
    let mut out = Vec::new();
    for r in rows {
        match r {
            Ok(entry) => out.push(entry),
            Err(_e) => continue,
        }
    }
    Ok(out)
}

/// Walk the chain front-to-back; detect the first inconsistency precisely.
/// Streams rows one at a time (never `collect()` a rusqlite `Row`).
pub fn verify(repo: &Repo) -> napi::Result<ChainStatus> {
    let mut stmt = repo
        .conn
        .prepare("SELECT seq, ts, kind, payload, prev_hash, hash FROM audit_log ORDER BY seq ASC")
        .map_err(crate::db::db_err)?;
    let mut rows = stmt.query([]).map_err(crate::db::db_err)?;
    let mut entries: f64 = 0.0;
    let mut expected_prev = GENESIS_HASH.to_string();
    let mut last_hash_val: Option<String> = None;
    while let Some(row) = rows.next().map_err(crate::db::db_err)? {
        entries += 1.0;
        let seq: i64 = row.get(0).map_err(crate::db::db_err)?;
        let ts: String = row.get(1).map_err(crate::db::db_err)?;
        let kind: String = row.get(2).map_err(crate::db::db_err)?;
        let payload: String = row.get(3).map_err(crate::db::db_err)?;
        let prev_hash: String = row.get(4).map_err(crate::db::db_err)?;
        let hash: String = row.get(5).map_err(crate::db::db_err)?;
        if prev_hash != expected_prev
            || chain_hash(&prev_hash, &ts, &kind, &payload) != hash
        {
            return Ok(ChainStatus {
                intact: false,
                broken_at: Some(seq as f64),
                last_hash: None,
                entries,
            });
        }
        expected_prev = hash;
        last_hash_val = Some(expected_prev.clone());
    }
    Ok(ChainStatus {
        intact: true,
        broken_at: None,
        last_hash: last_hash_val,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo() -> Repo {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(MIGRATION).expect("migrate");
        Repo { conn }
    }

    const MIGRATION: &str = include_str!("../../migrations/0001_init.sql");

    #[test]
    fn chain_grows_and_verifies() {
        let repo = temp_repo();
        append(&repo.conn, "task_started", r#"{"prompt":"clean temp"}"#).unwrap();
        append(&repo.conn, "step_done", r#"{"exit_code":0}"#).unwrap();
        append(
            &repo.conn,
            "step_started",
            r#"{"cmd":"echo hello with sk-proj-abc123def456ghijkl inside"}"#,
        )
        .unwrap();
        let status = verify(&repo).unwrap();
        assert!(status.intact);
        assert_eq!(status.entries, 3.0);
        // Secret redaction crossed into the audit log.
        let contains_secret = repo
            .conn
            .query_row("SELECT COUNT(*) FROM audit_log WHERE payload LIKE '%sk-proj-abc123%'", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap_or(1);
        assert_eq!(contains_secret, 0);
    }

    #[test]
    fn tampering_detects_first_broken_entry() {
        let repo = temp_repo();
        append(&repo.conn, "a", "one").unwrap();
        append(&repo.conn, "b", "two").unwrap();
        repo.conn
            .execute("UPDATE audit_log SET payload = 'tampered' WHERE seq = 2", [])
            .unwrap();
        let status = verify(&repo).unwrap();
        assert!(!status.intact);
        assert_eq!(status.broken_at, Some(2.0));
    }
}
