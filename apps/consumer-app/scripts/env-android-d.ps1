# Source in PowerShell before local Android / EAS local builds.
#   . ./scripts/env-android-d.ps1
#
# Layout produced by setup-android-toolchain-d.ps1

$Jdk = "D:\jdk\current"
$Sdk = "D:\Android\Sdk"

if (-not (Test-Path (Join-Path $Jdk "bin\java.exe"))) {
  Write-Warning "JDK missing at $Jdk — run scripts/setup-android-toolchain-d.ps1 first"
}
if (-not (Test-Path $Sdk)) {
  Write-Warning "SDK missing at $Sdk — run scripts/setup-android-toolchain-d.ps1 first"
}

$env:JAVA_HOME = $Jdk
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:GRADLE_USER_HOME = "D:\g"

$ndk = Get-ChildItem (Join-Path $Sdk "ndk") -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if ($ndk) {
  $env:ANDROID_NDK_HOME = $ndk.FullName
  $env:ANDROID_NDK_ROOT = $ndk.FullName
}

# Cargo on D: when building NDK locally (keep C: free)
if (-not $env:CARGO_HOME) { $env:CARGO_HOME = "D:\cargo-home" }
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = "D:\cargo-target\spp-native" }
New-Item -ItemType Directory -Force -Path $env:CARGO_HOME, $env:CARGO_TARGET_DIR, $env:GRADLE_USER_HOME -ErrorAction SilentlyContinue | Out-Null

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
Write-Host "CARGO_HOME=$env:CARGO_HOME"
try { & java -version 2>&1 | Select-Object -First 1 | ForEach-Object { Write-Host $_ } } catch {}
try { & adb version 2>&1 | Select-Object -First 1 | ForEach-Object { Write-Host $_ } } catch { Write-Host "adb not on PATH yet (install platform-tools)" }
