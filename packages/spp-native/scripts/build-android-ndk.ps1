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
  $oldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  rustup target add $t.triple *> $null
  $targetAddExitCode = $LASTEXITCODE
  $ErrorActionPreference = $oldErrorActionPreference
  if ($targetAddExitCode -ne 0) {
    throw "rustup target add $($t.triple) failed with exit code $targetAddExitCode"
  }
}

# Default stays derive/ASP only (OTA-safe). Full prove: SPP_NATIVE_POOL_OPS=1
# Host toolchain should be MSVC on Windows (dlltool/mingw breaks aws-lc host deps).
$features = "android-jni"
if ($env:SPP_NATIVE_POOL_OPS -eq "1") {
  $features = "android-jni,pool-ops"
  Write-Host "SPP_NATIVE_POOL_OPS=1 - building CAP_POOL_OPS (sdk/pool + wasmer)"
}

# Host build-scripts (SPP circuits/circom parse) need a large PE stack on Windows.
# Use target-scoped flags only — do NOT set env RUSTFLAGS (cargo-ndk would pass
# /STACK into Android clang and break the cross link).
# packages/spp-native/.cargo/config.toml has the same for host MSVC; the env
# var forces rebuild-script link even when cargo-ndk ignores package config.
if (-not $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS) {
  $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = "-C link-arg=/STACK:0x20000000"
  Write-Host "Host MSVC stack: CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS=/STACK:0x20000000"
}

function Get-PeStackReserve([string]$Path) {
  $fs = [IO.File]::OpenRead($Path)
  try {
    $br = New-Object IO.BinaryReader $fs
    $fs.Seek(0x3C, 'Begin') | Out-Null
    $peOff = $br.ReadInt32()
    $optStart = $peOff + 24
    $fs.Seek($optStart, 'Begin') | Out-Null
    $magic = $br.ReadUInt16()
    if ($magic -eq 0x20b) {
      $fs.Seek($optStart + 72, 'Begin') | Out-Null
      return [uint64]$br.ReadUInt64()
    }
    $fs.Seek($optStart + 72, 'Begin') | Out-Null
    return [uint64]$br.ReadUInt32()
  } finally {
    $fs.Close()
  }
}

# Patch cached host circuits build-scripts if they still have the default 1MB stack.
# cargo-ndk may reuse a unit hash linked before host stack flags were set.
function Repair-CircuitsBuildScriptStack {
  $targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $Root "target" }
  $buildRoot = Join-Path $targetDir "release\build"
  if (-not (Test-Path $buildRoot)) { return }
  $editbin = Get-ChildItem "C:\Program Files*\Microsoft Visual Studio" -Recurse -Filter editbin.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'Hostx64\\x64\\editbin\.exe$' } |
    Select-Object -First 1
  Get-ChildItem $buildRoot -Directory -Filter "circuits-*" -ErrorAction SilentlyContinue | ForEach-Object {
    $exe = Join-Path $_.FullName "build-script-build.exe"
    if (-not (Test-Path $exe)) { return }
    $stack = Get-PeStackReserve $exe
    if ($stack -ge 0x20000000) { return }
    Write-Host ("Host circuits build-script stack too small (0x{0:X}); patching /STACK:0x20000000" -f $stack)
    if ($editbin) {
      & $editbin.FullName /STACK:536870912 $exe | Out-Null
    } else {
      $bytes = [IO.File]::ReadAllBytes($exe)
      $peOff = [BitConverter]::ToInt32($bytes, 0x3C)
      $optStart = $peOff + 24
      $magic = [BitConverter]::ToUInt16($bytes, $optStart)
      if ($magic -ne 0x20b) { throw "Unsupported PE magic for stack patch: 0x$($magic.ToString('X'))" }
      [Array]::Copy([BitConverter]::GetBytes([uint64]0x20000000), 0, $bytes, $optStart + 72, 8)
      [IO.File]::WriteAllBytes($exe, $bytes)
    }
    Write-Host ("  -> 0x{0:X}" -f (Get-PeStackReserve $exe))
  }
}

Repair-CircuitsBuildScriptStack

Push-Location $Root
try {
  cargo ndk `
    -t arm64-v8a `
    -t armeabi-v7a `
    -t x86_64 `
    -o $OutJni `
    -- build --release --features $features
  if ($LASTEXITCODE -ne 0) {
    # Retry once after patching any newly linked 1MB circuits build-scripts.
    Repair-CircuitsBuildScriptStack
    Write-Host "Retrying cargo ndk after host stack repair..."
    cargo ndk `
      -t arm64-v8a `
      -t armeabi-v7a `
      -t x86_64 `
      -o $OutJni `
      -- build --release --features $features
    if ($LASTEXITCODE -ne 0) {
      throw "cargo ndk failed with exit code $LASTEXITCODE"
    }
  }
  Write-Host "OK: libs under $OutJni"
  Get-ChildItem -Recurse $OutJni -Filter "*.so" | ForEach-Object {
    Write-Host ("  {0} ({1:N0} bytes)" -f $_.FullName, $_.Length)
  }
} finally {
  Pop-Location
}
