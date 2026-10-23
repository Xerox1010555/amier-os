# Amier OS — Android Companion

The Android app (`apps/mobile`) is a **companion client**, not a runtime. It renders
what the AI orchestrator proposes — plans (with the provider's advisory risk
levels), streamed chat (SSE), and a live health probe — while honoring the
platform's security law:

> **The phone never executes OS commands.** Proposals are classified
> authoritatively by the deterministic rules engine inside the desktop Rust
> kernel, and every human-approved step is executed + audited on that machine.
> The mobile app displays the advisory view only.

## Stack

| Layer      | Choice                                        |
| ---------- | --------------------------------------------- |
| UI         | React 18 + Vite (same Aurora-Glass language)  |
| Native     | Capacitor 6 (`com.amier.os`, webDir `dist`)   |
| API        | Orchestrator REST/SSE over HTTP + secret header |
| Auth       | `X-Jarvis-Secret` shared secret (Settings tab) |

Project layout:

```
apps/mobile/
  capacitor.config.ts   appId com.amier.os · appName "Amier OS"
  src/                  App.tsx (Plan · Chat · Settings) · api.ts · styles.css
  assets/logo.png       icon source (1024) → npx @capacitor/assets
  android/              Gradle project (committed; regenerable via cap add)
  www/manifest.json     helper manifest used by the asset generator
```

Icons were generated with `scripts/make_icons.ps1` (256 DPI desktop + 1024
mobile) and stamped into Android mipmaps/splash via `@capacitor/assets`.

## Build the APK

**CI (recommended — no local Android SDK needed):**
1. Push to `main` (or trigger `.github/workflows/mobile.yml` manually via
   *workflow_dispatch*).
2. Download the `Amier-OS-debug-apk` artifact from the workflow run summary
   (on tags `v*` the APK is also attached to the release).
3. Side-load: allow "install unknown apps" → open the APK.

**Locally (requires JDK 17 + Android SDK):**

```pwsh
npm install --workspaces --include-workspace-root
npm run build --workspace apps/mobile        # web bundle → dist/
npx cap sync android                         # copy dist into the android project
cd apps/mobile/android
.\gradlew assembleDebug                      # APK at app/build/outputs/apk/debug/
```

Or open `apps/mobile/android` in Android Studio and press Run.

## Pair the phone with your desktop service

The orchestrator listens on loopback by default — for the phone to reach it,
run it LAN-exposed **with its shared secret**:

```pwsh
# desktop, from repo root
$env:JARVIS_BIND_HOST = "0.0.0.0"
$env:JARVIS_CORS_ORIGINS = "*"          # the Capacitor WebView origin is dynamic
$env:JARVIS_SHARED_SECRET = "<64-hex>"  # same value typed into the app
npm run dev --workspace apps/desktop    # or: python -m ai_orchestrator (services/)
```

Find your desktop LAN IP (`ipconfig` → e.g. `192.168.1.10`), then in the app:
**Settings → Server URL** `http://192.168.1.10:8000` → **Shared secret** (same
value) → **Save**. The topbar pill turns green and shows provider + version.
Android-emulator note: the emulator reaches the host via `http://10.0.2.2:8000`.

## Security posture on LAN

- Requests carry only the shared-secret header; the floor is *plain HTTP* —
  treat the LAN as semi-trusted, or front the service with a TLS-terminating
  reverse proxy for anything beyond home use.
- The plan view shows the provider's advisory risk badges (🟢🟡🔴⛔);
  approval and execution live exclusively in the desktop session.
- Rate limiter and audit log on the orchestrator apply to phone traffic too.
