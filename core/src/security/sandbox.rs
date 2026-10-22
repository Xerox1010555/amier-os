//! Sandboxed execution policy: platform selection, environment scrubbing,
//! working-directory locks, output caps and timeouts. The process is spawned
//! with piped streams; a dedicated streaming loop (in `engine`) forwards
//! redacted chunks live to the UI.

pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
}

/// Build the concrete spawn spec for the current OS. Guard rails live at the
/// classification + confirmation + audit layers (see `rules` / `engine`).
pub fn spawn_spec(command: &str) -> SpawnSpec {
    if cfg!(windows) {
        SpawnSpec {
            program: "cmd.exe".to_string(),
            args: vec!["/C".to_string(), command.to_string()],
        }
    } else {
        SpawnSpec {
            program: "sh".to_string(),
            args: vec!["-c".to_string(), command.to_string()],
        }
    }
}

/// Maximum captured bytes per stream (stdout / stderr) — anything beyond is
/// truncated and flagged in the execution record.
pub const OUTPUT_CAP_BYTES: usize = 256 * 1024;

/// Sweep the child's environment: no keys/tokens/secrets/AWS vars cross the
/// process boundary (roadmap: allow-list env instead of deny-list).
pub fn scrub_env() -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();
    for (k, v) in std::env::vars() {
        let key = k.to_ascii_uppercase();
        let drop_it = key.contains("KEY")
            || key.contains("TOKEN")
            || key.contains("SECRET")
            || key.starts_with("AWS_");
        if !drop_it {
            env.push((k, v));
        }
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_spec_uses_platform_shell() {
        let spec = spawn_spec("echo hi");
        if cfg!(windows) {
            assert_eq!(spec.program, "cmd.exe");
            assert_eq!(spec.args[0], "/C");
        } else {
            assert_eq!(spec.program, "sh");
            assert_eq!(spec.args[0], "-c");
        }
        assert_eq!(spec.args[1], "echo hi");
    }

    #[test]
    fn env_scrub_drops_secrets() {
        // Never export token/secret/aws-shaped variables to children.
        for (k, _v) in scrub_env() {
            let ku = k.to_ascii_uppercase();
            assert!(!ku.contains("TOKEN"));
            assert!(!ku.contains("SECRET"));
            assert!(!ku.starts_with("AWS_"));
        }
    }
}
