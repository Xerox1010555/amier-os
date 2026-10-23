//! SQLite persistence layer (rusqlite, bundled, WAL).
//!
//! All schema changes go through migrations embedded at compile time.

use std::path::Path;

use rusqlite::Connection;

use crate::audit;

const MIGRATION_0001: &str = include_str!("../../migrations/0001_init.sql");

pub struct Repo {
    pub conn: Connection,
}

impl Repo {
    pub fn open(path: &Path) -> napi::Result<Self> {
        let conn = Connection::open(path).map_err(db_err)?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(db_err)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(db_err)?;
        let repo = Self { conn };
        repo.migrate()?;
        Ok(repo)
    }
}

impl Repo {
    pub fn open_sqlite(path: &Path) -> napi::Result<Self> {
        // WAL gives concurrent readers with one writer thread (the engine).
        Self::open(path)
    }

    fn migrate(&self) -> napi::Result<()> {
        self.conn
            .execute_batch(MIGRATION_0001)
            .map_err(db_err)?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Option<String> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> napi::Result<()> {
        let now = crate::audit::now_iso();
        self.conn
            .execute(
                "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
                [key, value, now.as_str()],
            )
            .map_err(db_err)?;
        Ok(())
    }

    pub fn seal_genesis_if_empty(&self) -> napi::Result<()> {
        // Ensure the audit chain always has a genesis anchor.
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))
            .map_err(db_err)?;
        if count == 0 {
            audit::append(
                &self.conn,
                "genesis",
                "{\"note\":\"audit chain initialized\"}",
            )?;
        }
        Ok(())
    }
}

impl Repo {
    pub fn count_steps_for_task(&self, task_id: &str) -> (f64, f64, f64) {
        let (total, done, denied): (i64, i64, i64) = self
            .conn
            .query_row(
                "SELECT COUNT(*),
                        SUM(CASE WHEN status IN ('done','failed') THEN 1 ELSE 0 END),
                        SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END)
                 FROM task_steps WHERE task_id = ?1",
                [task_id],
                |row| {
                    Ok((
                        row.get(0).unwrap_or(0),
                        row.get(1).unwrap_or(0),
                        row.get(2).unwrap_or(0),
                    ))
                },
            )
            .map(|(t, d, dn)| (t, d, dn))
            .unwrap_or((0, 0, 0));
        (total as f64, done as f64, denied as f64)
    }

    pub fn active_task_count(&self) -> f64 {
        let n: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE status IN ('running','pending_approval','paused')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        n as f64
    }
}

pub(crate) fn db_err(e: rusqlite::Error) -> napi::Error {
    napi::Error::from_reason(format!("database error: {e}"))
}
