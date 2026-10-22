/**
 * Dev orchestrator: starts Vite, waits for its port, then launches Electron
 * with JARVIS_DEV_SERVER pointing at the renderer (hot reload UI, main proc
 * via Ctrl+R on Electron — no nodemon needed for this release).
 */
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const electronBin = join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");

function waitPort(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolveP, rejectP) => {
    const probe = () => {
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
  if (!existsSync(electronBin)) {
    console.error("Electron not found. Run: npm install --workspace apps/desktop");
    process.exit(1);
  }
  const vite = spawn(process.execPath, [join(desktopRoot, "node_modules", "vite", "bin", "vite.js"), "--port", "5173"], {
    cwd: desktopRoot,
    env: process.env,
    stdio: "inherit",
  });
  vite.on("exit", (code) => {
    if (code !== 0) console.error(`[dev-electron] vite exited with code ${code}`);
    process.exit(code ?? 1);
  });

  try {
    await waitPort("http://127.0.0.1:5173");
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
