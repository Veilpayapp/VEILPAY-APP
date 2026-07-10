# Build libspp_native.so for Android ABIs and copy into the Expo module jniLibs.
#
# Prerequisites:
#   - Android NDK (via Android Studio SDK Manager or ANDROID_NDK_HOME)
#   - rustup targets: aarch64-linux-android, armv7-linux-androideabi, x86_64-linux-android
#   - cargo-ndk: cargo install cargo-ndk
#
# Usage (from packages/spp-native):
#   .\scripts\build-android-ndk.ps1
#
# Product: native mobile only — not WebView of sdk/web.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutJni = Join-Path $Root "..\..\apps\consumer-app\modules\spp-native\android\src\main\jniLibs"
$OutJni = [System.IO.Path]::GetFullPath($OutJni)

Write-Host "spp-native → $OutJni"

$targets = @(
  @{ triple = "aarch64-linux-android"; abi = "arm64-v8a" },
  @{ triple = "armv7-linux-androideabi"; abi = "armeabi-v7a" },
  @{ triple = "x86_64-linux-android"; abi = "x86_64" }
)

foreach ($t in $targets) {
  Write-Host "rustup target add $($t.triple)"
  rustup target add $t.triple 2>$null
}

Push-Location $Root
try {
  cargo ndk `
    -t arm64-v8a `
    -t armeabi-v7a `
    -t x86_64 `
    -o $OutJni `
    -- build --release --features android-jni
  Write-Host "OK: libs under $OutJni"
  Get-ChildItem -Recurse $OutJni -Filter "*.so" | ForEach-Object { Write-Host "  $($_.FullName)" }
} finally {
  Pop-Location
}
