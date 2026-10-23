//! Secret redaction for logs, stdout/stderr streams, and audit payloads.
//! Mirrors the Python service's engine in `services/ai-orchestrator/redact.py`
//! (defense in depth: both layers redact independently).

use std::sync::OnceLock;

use regex::Regex;
use sha2::{Digest, Sha256};

const MASK_PREFIX: &str = "[REDACTED:";

struct Pattern {
    name: &'static str,
    source: &'static str,
}

fn patterns() -> &'static Vec<Pattern> {
    static PATTERNS: OnceLock<Vec<Pattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Pattern { name: "api_key", source: r"\b(sk|rk|pk)_(?:live|test)_[0-9a-zA-Z]{10,64}\b" },
            Pattern { name: "openai", source: r"\bsk-[A-Za-z0-9_-]{16,64}\b" },
            Pattern { name: "anthropic", source: r"\bsk-ant-[A-Za-z0-9_-]{16,128}\b" },
            Pattern { name: "github", source: r"\bgh[pousr]_[A-Za-z0-9]{20,60}\b" },
            Pattern { name: "slack", source: r"\bxox[baprs]-[A-Za-z0-9-]{10,60}\b" },
            Pattern { name: "aws", source: r"\bAKIA[0-9A-Z]{16}\b" },
            Pattern { name: "gcp", source: r"\bAIza[0-9A-Za-z_-]{20,60}\b" },
            Pattern { name: "jwt", source: r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b" },
            Pattern { name: "bearer", source: r"(?i)\bbearer\s+[A-Za-z0-9._-]{16,}\b" },
            Pattern { name: "password_kv", source: r"(?i)\b(password|passwd|pwd|api[-_]?key|secret|token)\s*[=:]\s*[^\s]{4,}" },
            Pattern { name: "email", source: r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b" },
            Pattern { name: "private_key", source: r"-----BEGIN [A-Z ]*PRIVATE KEY-----" },
        ]
    })
}

fn compiled() -> &'static Vec<(String, Regex)> {
    static COMPILED: OnceLock<Vec<(String, Regex)>> = OnceLock::new();
    COMPILED.get_or_init(|| {
        patterns()
            .iter()
            .filter_map(|p| Regex::new(p.source).ok().map(|re| (p.name.to_string(), re)))
            .collect()
    })
}

fn entropy_token() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b[a-zA-Z0-9+/_-]{32,}\b").unwrap_or_else(|_| {
        // Fallback that never fails: matches the same class loosely.
        Regex::new("[a-zA-Z0-9]{32,}").expect("static regex")
    }))
}

fn entropy_looks_secret(token: &str) -> bool {
    let pool: Vec<char> = token.chars().collect();
    let mut chars = std::collections::HashSet::new();
    for c in &pool {
        chars.insert(*c);
    }
    if chars.len() < 16 {
        return false;
    }
    let digits = pool.iter().filter(|c| c.is_ascii_digit()).count();
    let lower = pool.iter().filter(|c| c.is_ascii_lowercase()).count();
    let upper = pool.iter().filter(|c| c.is_ascii_uppercase()).count();
    let other = pool.len() - digits - lower - upper;
    let threshold = std::cmp::max(2, pool.len() / 8);
    let kinds = [digits >= threshold, lower >= threshold, upper >= threshold, other >= threshold]
        .iter()
        .filter(|b| **b)
        .count();
    chars.len() >= 20 && kinds >= 3
}

/// Replace every detected secret with `[REDACTED:<name>]`.
pub fn redact(text: &str) -> String {
    if text.is_empty() {
        return text.to_string();
    }
    let mut out = text.to_string();
    for (name, re) in compiled() {
        let mask = format!("{MASK_PREFIX}{name}]");
        out = re.replace_all(&out, mask.as_str()).to_string();
    }
    out = entropy_token()
        .replace_all(&out, |caps: &regex::Captures| {
            let tok = &caps[0];
            if entropy_looks_secret(tok) {
                format!("{MASK_PREFIX}entropy]")
            } else {
                tok.to_string()
            }
        })
        .to_string();
    out
}

/// SHA-256 hex digest helper (used by the audit chain and artifact indexing).
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_provider_keys() {
        let out = redact("key: sk-proj-Abc123Def456ghi789 and sk-ant-token-Blah2024long");
        assert!(!out.contains("sk-proj-Abc123"));
        assert!(!out.contains("Blah2024long"));
        assert!(out.contains(MASK_PREFIX));
    }

    #[test]
    fn masks_jwt_and_bearer() {
        let text = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.s1gn4tur3x01";
        assert!(redact(text).contains(MASK_PREFIX));
    }

    #[test]
    fn masks_password_kv_and_email() {
        let out = redact("login user=dev@example.com password=hunter2secret ok");
        assert!(!out.contains("dev@example.com"));
        assert!(!out.contains("hunter2secret"));
    }

    #[test]
    fn entropy_mixed_tokens_masked_but_normal_words_kept() {
        let secret = "aX9_kB3-qR7wZs2Vn8Lm4Tf6Jp0Hc5DgE1Y";
        let ok = "cache_miss_value_that_is_long_but_plain_0000000000000000000";
        let out = redact(&format!("{secret} {ok}"));
        assert!(out.contains(MASK_PREFIX));
        assert!(out.contains("cache_miss"));
    }

    #[test]
    fn sha256_len() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
}
