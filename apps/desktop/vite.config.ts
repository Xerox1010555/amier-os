import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

/**
 * Dev-only: remove the static CSP meta so the @vitejs/plugin-react preamble
 * (an inline script) can run. Production keeps the meta; the Electron main
 * process applies a dev/prod-aware header CSP too.
 */
function stripCspMetaInDev(): Plugin {
  return {
    name: "jarvis:strip-csp-meta-dev",
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html;
      return html.replace(
        /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i,
        "",
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), stripCspMetaInDev()],
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});

