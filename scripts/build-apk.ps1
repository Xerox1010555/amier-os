# One-click local APK build for the Amier OS Android companion.
#
# Windows-path requirements discovered on this machine (keep both):
#  1. `gradlew.bat` runs under cmd.exe, which mutates non-ASCII project paths
#     ("مشاريع البرمجه" -> "?????") into an unusable classpath.
#  2. Worse, the JVM itself refuses to load classes from a jar inside a
#     non-ASCII directory (ClassNotFoundException on a perfectly good jar).
#  3. AGP additionally refuses non-ASCII project paths (b.android.com/95744).
#
# Solution: TWO depth-matched NTFS junctions at a pure-ASCII root —
#   C:\Users\<user>\amier-android\node_modules           -> repo/node_modules
#   C:\Users\<user>\amier-android\apps\mobile\android    -> repo android dir
# Depth matters: capacitor.settings.gradle resolves `../../../node_modules`,
# so the mirror must reproduce the repo layout exactly. Gradle runs FROM the
# mirror while every file physically stays in the repo (build outputs too).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1
$ErrorActionPreference = "Stop"

# ── JDK 17 (Gradle 8.2.1 does not run on Java 21) ───────────────────────────
$jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $jdk) { throw "JDK 17 not found — install: winget install -e --id EclipseAdoptium.Temurin.17.JDK" }

# ── Android SDK ───────────────────────────────────────────────────────────────
$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path (Join-Path $sdk "platforms\android-34"))) {
  throw "Android SDK platform-34 missing under $sdk"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$mobile = Join-Path $repoRoot "apps\mobile"
$android = Join-Path $mobile "android"

# ── web bundle + capacitor sync (run in the real repo — npm-aware) ───────────
Push-Location $mobile
npm run build
npx cap sync android
Pop-Location

# ── ASCII mirror with repo-shaped depth (junctions only — links, not copies) ─
$root = "C:\Users\$env:USERNAME\amier-android"
$mirrorApp = Join-Path $root "apps\mobile\android"
$mirrorNode = Join-Path $root "node_modules"

New-Item -ItemType Directory -Force (Split-Path $mirrorApp) | Out-Null
foreach ($pair in @(@($mirrorApp, $android), @($mirrorNode, (Join-Path $repoRoot "node_modules")))) {
  $link = $pair[0]; $target = $pair[1]
  if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.LinkType -ne "Junction") { throw "$link exists and is not a junction — remove it manually" }
  } else {
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  }
}

# ── gradle: wrapper jar + launcher java, both at the ASCII path ──────────────
Push-Location $mirrorApp
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
& (Join-Path $jdk "bin\java.exe") -cp (Join-Path $mirrorApp "gradle\wrapper\gradle-wrapper.jar") `
  org.gradle.wrapper.GradleWrapperMain assembleDebug --console=plain
Pop-Location

# ── publish the artifact ─────────────────────────────────────────────────────
$apk = Join-Path $android "app\build\outputs\apk\debug\app-debug.apk"
$rel = Join-Path $mobile "release"
New-Item -ItemType Directory -Force $rel | Out-Null
Copy-Item $apk (Join-Path $rel "Amier OS 1.0.0.apk") -Force
Write-Host "[amier] APK ready: $rel\Amier OS 1.0.0.apk" -ForegroundColor Green
