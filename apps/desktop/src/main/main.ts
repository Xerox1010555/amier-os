/**
 * Jarvis OS — Electron main process.
 *
 * Boot order (security first):
 *  1. single-instance lock
 *  2. hardened window creation (CSP, deny-all permission handler, no devtools)
 *  3. Rust engine load + DB initialization
 *  4. IPC registration + contract self-test
 *  5. tray/window lifecycle
 */
import { app, BrowserWindow, Menu, session, shell } from "electron";
import * as path from "path";
import { loadNative, resolveDbPath } from "./native";
import { registerIpc, selfTestIpcContract, wireEngineEvents, type IpcContext } from "./ipc";
import { createTray, destroyTray } from "./tray";
import { initAutoUpdater } from "./updater";

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function applySecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:*; font-src 'self' data:",
        ],
      },
    });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false); // deny all by default
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#0b0f17",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (!isDev) {
    // No devtools in production builds.
    mainWindow.webContents.on("before-input-event", (_event, input) => {
      if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
        eventPreventDefault(_event);
      }
    });
  }

  const devUrl = process.env.JARVIS_DEV_SERVER;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    if (process.env.JARVIS_DEV_TOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function eventPreventDefault(event: { preventDefault(): void }): void {
  event.preventDefault();
}

app.whenReady().then(() => {
  applySecurityPolicy();

  // ── Rust engine boot ───────────────────────────────────────────────────
  const native = loadNative();
  const { dbPath } = resolveDbPath();
  let engineReady = false;
  try {
    const initMsg = native.initializeCore(dbPath);
    engineReady = native.engineReady;
    console.log(`[engine] ${initMsg}`);
  } catch (err) {
    console.error("[engine] initialization failed — running degraded", err);
  }
  const status = native.getStatus();
  console.log(
    `[engine] ready=${status.engine_ready} rules=${status.rules_count} db=${status.db_ok} (motor=${engineReady})`,
  );

  // ── IPC wiring + self-test ─────────────────────────────────────────────
  const ctx: IpcContext = {
    native,
    win: () => mainWindow,
    notify: (_title, _body) => undefined,
  };
  registerIpc(ctx);
  selfTestIpcContract();

  createWindow();
  createTray(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.show();
    }
  });

  wireEngineEvents(ctx);
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  destroyTray();
});
