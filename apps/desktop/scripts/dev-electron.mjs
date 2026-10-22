/**
 * Dev orchestrator: starts Vite, waits for its port, then launches Electron
 * with JARVIS_DEV_SERVER pointing at the renderer (hot reload UI, main proc
 * via Ctrl+R on Electron — no nodemon needed for this release).
 *
 * npm workspaces hoist packages to the ROOT node_modules, so binaries are
 * resolved with require.resolve() instead of hardcoded workspace paths.
 */
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");

/** Require that resolves from the desktop workspace (walks up to root node_modules). */
const resolv = createRequire(join(desktopRoot, "package.json"));

function resolveElectronBin() {
  // 1) workspace-local copy (no hoisting scenarios)
  const local = join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
  if (existsSync(local)) return local;
  // 2) resolve the electron package (hoisted to root or anywhere up the tree)
  try {
    const pkgDir = dirname(resolv.resolve("electron/package.json"));
    const bin = join(pkgDir, "dist", "electron.exe");
    if (existsSync(bin)) return bin;
    console.error(`[dev-electron] electron package found at ${pkgDir} but dist/electron.exe missing — postinstall blocked?`);
  } catch {
    /* not installed */
  }
  return null;
}

function resolveViteBin() {
  try {
    const pkgDir = dirname(resolv.resolve("vite/package.json"));
    const bin = join(pkgDir, "bin", "vite.js");
    if (existsSync(bin)) return bin;
  } catch {
    /* fallthrough */
  }
  // workspace-local fallback
  const local = join(desktopRoot, "node_modules", "vite", "bin", "vite.js");
  if (existsSync(local)) return local;
  return null;
}

function waitPort(urls, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolveP, rejectP) => {
    let idx = 0;
    const probe = () => {
      const url = urls[idx % urls.length]; // alternate IPv4/localhost probes
      idx += 1;
      const req = http.get(url, (res) => {
        res.resume();
        resolveP(statusText(res.statusCode));
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) return rejectP(new Error("vite dev server timeout"));
        setTimeout(probe, 400);
      });
      req.setTimeout(1200, () => {
        req.destroy();
        if (Date.now() - started > timeoutMs) return rejectP(new Error("vite dev server timeout"));
        setTimeout(probe, 400);
      });
    };
    function statusText(status) {
      return status >= 200 && status < 500 ? "up" : "warming";
    }
    probe();
  });
}

async function main() {
  const electronBin = resolveElectronBin();
  if (!electronBin) {
    console.error("Electron not found. Run: npm install --workspaces --include-workspace-root");
    process.exit(1);
  }
  const viteBin = resolveViteBin();
  if (!viteBin) {
    console.error("Vite not found. Run: npm install --workspaces --include-workspace-root");
    process.exit(1);
  }

  const vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", "5173"], {
    cwd: desktopRoot,
    env: process.env,
    stdio: "inherit",
  });
  vite.on("exit", (code) => {
    if (code !== 0) console.error(`[dev-electron] vite exited with code ${code}`);
    process.exit(code ?? 1);
  });

  try {
    await waitPort(["http://127.0.0.1:5173", "http://localhost:5173"]);
    console.log("[dev-electron] vite up — launching Electron");
  } catch (err) {
    console.error(String(err));
    vite.kill();
    process.exit(1);
  }

  const electron = spawn(electronBin, ["."], {
    cwd: desktopRoot,
    env: { ...process.env, JARVIS_DEV_SERVER: "http://127.0.0.1:5173", JARVIS_DEV_TOOLS: process.env.JARVIS_DEV_TOOLS ?? "1" },
    stdio: "inherit",
  });
  electron.on("exit", () => {
    vite.kill();
    process.exit(0);
  });
}

void main();
