import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Amier OS — Android companion.
 * The webDir is the static Vite build; no native plugins in v1 — everything
 * talks to the orchestrator over HTTP from the WebView.
 */
const config: CapacitorConfig = {
  appId: "com.amier.os",
  appName: "Amier OS",
  webDir: "dist",
  android: {
    // Allow plain HTTP to the LAN orchestrator (dev/companion use).
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "http",
  },
};

export default config;
