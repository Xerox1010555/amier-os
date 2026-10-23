/**
 * Package prebuild: stage the Rust NAPI engine into apps/desktop/resources/.
 *
 * electron-builder extraResources copies `resources/` verbatim. The .node
 * binary exists only when the Rust toolchain produced it — an absent engine
 * ships a perfectly degraded app (stub engine, boot banner), never a broken
 * installer.
 */
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const destDir = join(desktop, "resources", "core");
const src = join(root, "core", "ai_os_core.node");

mkdirSync(destDir, { recursive: true });

if (existsSync(src)) {
  copyFileSync(src, join(destDir, "ai_os_core.node"));
  console.log("[prebuild] engine staged: resources/core/ai_os_core.node");
} else {
  console.log("[prebuild] no Rust engine found — packaging WITHOUT it (app boots with engine-offline banner)");
}

// Keep the dir non-empty for electron-builder globbing.
const marker = join(destDir, "README.txt");
if (!existsSync(marker)) {
  writeFileSync(
    marker,
    "core/ai_os_core.node lives here after a Rust build (npm run core:build or CI release job).\n",
  );
}
