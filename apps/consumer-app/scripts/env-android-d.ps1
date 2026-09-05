# Source in PowerShell before local Android / EAS local builds.
#   . ./scripts/env-android-d.ps1
#
# Layout produced by setup-android-toolchain-d.ps1
#
# Build caches/toolchains (cargo, rustup, gradle, target dir) live on E: in a
# dedicated folder so they don't fill up the D: drive. If E: is unavailable we
# abort rather than silently recreating the caches on D:.

$Jdk = "D:\jdk\current"
$Sdk = "D:\Android\Sdk"

if (-not (Test-Path "E:\dev-build")) {
  Write-Error "E:\dev-build is not available. Refusing to set build env vars (would recreate build caches on D:). Mount E: and retry."
  exit 1
}

if (-not (Test-Path (Join-Path $Jdk "bin\java.exe"))) {
  Write-Warning "JDK missing at $Jdk — run scripts/setup-android-toolchain-d.ps1 first"
}
if (-not (Test-Path $Sdk)) {
  Write-Warning "SDK missing at $Sdk — run scripts/setup-android-toolchain-d.ps1 first"
}

$env:JAVA_HOME = $Jdk
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:GRADLE_USER_HOME = "E:\dev-build\gradle"

$ndk = Get-ChildItem (Join-Path $Sdk "ndk") -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if ($ndk) {
  $env:ANDROID_NDK_HOME = $ndk.FullName
  $env:ANDROID_NDK_ROOT = $ndk.FullName
}

# Rust + cargo on E: only (never default to C:\Users\...\.cargo / .rustup, and
# never write these caches back to D:). E:\dev-build must exist (guarded above).
$env:RUSTUP_HOME = "E:\dev-build\rustup"
$env:CARGO_HOME = "E:\dev-build\cargo-home"
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = "E:\dev-build\cargo-target\spp-native" }
New-Item -ItemType Directory -Force -Path $env:CARGO_HOME, $env:CARGO_TARGET_DIR, $env:GRADLE_USER_HOME, $env:RUSTUP_HOME -ErrorAction SilentlyContinue | Out-Null

$paths = @(
  (Join-Path $Jdk "bin"),
  (Join-Path $Sdk "platform-tools"),
  (Join-Path $Sdk "cmdline-tools\latest\bin"),
  (Join-Path $Sdk "emulator"),
  (Join-Path $env:CARGO_HOME "bin")
) | Where-Object { Test-Path $_ }

$env:Path = ($paths -join ";") + ";" + $env:Path

Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
Write-Host "ANDROID_NDK_HOME=$env:ANDROID_NDK_HOME"
Write-Host "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
Write-Host "RUSTUP_HOME=$env:RUSTUP_HOME"
Write-Host "CARGO_HOME=$env:CARGO_HOME"
Write-Host "CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR"
try { & java -version 2>&1 | Select-Object -First 1 | ForEach-Object { Write-Host $_ } } catch {}
try { & adb version 2>&1 | Select-Object -First 1 | ForEach-Object { Write-Host $_ } } catch { Write-Host "adb not on PATH yet (install platform-tools)" }
