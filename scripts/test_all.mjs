#!/usr/bin/env node
/**
 * Multi-language test runner for Jarvis OS.
 * Runs everything that is runnable on the current machine and reports a
 * compact, CI-friendly summary. Exit code 1 on any failure.
 *
 *   node scripts/test_all.mjs [--skip-python] [--skip-web]
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const args = new Set(process.argv.slice(2));
const rootDir = join(fileURLToPath(import.meta.url), "..", "..");

function run(name, cmd, cmdArgs, opts = {}) {
  const label = opts.label ?? name;
  const result = spawnSync(cmd, cmdArgs, {
    cwd: join(rootDir, opts.cwd ?? "."),
    shell: process.platform === "win32",
    encoding: "utf8",
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ok = result.status === 0;
  const tail = (result.stdout ?? "").trim().split(/\r?\n/).slice(-3).join(" | ");
  const errTail = (result.stderr ?? "").trim().split(/\r?\n/).slice(-3).join(" | ");
  console.log(`${ok ? "✔" : "✘"} ${label}${tail ? ` — ${tail}` : ""}${ok ? "" : errTail ? ` — ${errTail}` : ""}`);
  return ok;
}

const results = [];

// ── Python orchestrator ──────────────────────────────────────────────────────
if (!args.has("--skip-python")) {
  const venvPy = existsSync(join(rootDir, ".venv", "Scripts", "python.exe"))
    ? join(".venv", "Scripts", "python.exe")
    : "python";
  results.push(
    run("pytest", venvPy, ["-X", "utf8", "-m", "pytest", "services/ai-orchestrator/tests", "-q"], {
      label: "python: ai-orchestrator tests",
    }),
  );
}

// ── TypeScript (packages/shared + desktop) ──────────────────────────────────
if (!args.has("--skip-web")) {
  results.push(run("tsc", "npm", ["run", "typecheck", "--workspace", "packages/shared"], { label: "ts: shared" }));
  results.push(run("tsc", "npm", ["run", "typecheck", "--workspace", "apps/desktop"], { label: "ts: desktop" }));
}

// ── Rust core (skips silently when cargo is absent) ─────────────────────────
if (!args.has("--skip-rust")) {
  const probe = spawnSync("cargo", ["--version"], { shell: true, encoding: "utf8" });
  if (probe.status === 0) {
    results.push(run("cargo", "cargo", ["test", "--manifest-path", "core/Cargo.toml"], { label: "rust: core tests", cwd: "." }));
  } else {
    console.log("○ rust: cargo not installed — skipping core tests (install rustup to run them)");
  }
}

const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? "\nALL RUNNABLE SUITES PASSED" : `\n${failed} suite(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
