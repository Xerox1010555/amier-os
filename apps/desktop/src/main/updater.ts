import { app } from "electron";

/**
 * Optional signed auto-update. Uses electron-updater only when it's a packaged
 * app (never in dev), and never crashes the app if the channel is offline.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return;
  try {
    // Lazy import keeps the dev path free of updater noise.
    const updater = require("electron-updater") as {
      autoUpdater: {
        autoDownload: boolean;
        checkForUpdatesAndNotify: () => Promise<unknown>;
        on: (event: string, cb: (arg0?: unknown) => void) => void;
      };
    };
    const autoUpdater = updater.autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.on("error", (arg0?: unknown) => {
      console.warn("[updater] error", arg0);
    });
    autoUpdater
      .checkForUpdatesAndNotify()
      .catch((err: unknown) => console.warn("[updater] check failed", err));
  } catch (err) {
    console.warn("[updater] electron-updater not available", err);
  }
}
