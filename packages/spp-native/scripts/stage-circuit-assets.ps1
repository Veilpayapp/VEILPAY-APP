# Stage policy_tx_2_2 circuit assets for app / desktop dogfood.
#
# Sources (first hit wins):
#   1. .local/spp-phase0/alice/circuits
#   2. packages/vendor/spp/testdata + target/circuits-artifacts/release
#   3. packages/vendor/spp/deployments/testnet/circuit_keys (proving key only)
#
# Dest (default): apps/consumer-app/assets/spp/circuits/
#
# Usage:
#   .\scripts\stage-circuit-assets.ps1
#   .\scripts\stage-circuit-assets.ps1 -OutDir "D:\path\to\circuits"

param(
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
if (-not $OutDir) {
  $OutDir = Join-Path $RepoRoot "apps\consumer-app\assets\spp\circuits"
}

$candidates = @(
  (Join-Path $RepoRoot ".local\spp-phase0\alice\circuits"),
  (Join-Path $RepoRoot "packages\vendor\spp\testdata\release"),
  (Join-Path $RepoRoot "packages\vendor\spp\target\circuits-artifacts\release")
)

function Find-File([string]$name) {
  foreach ($c in $candidates) {
    $p = Join-Path $c $name
    if (Test-Path $p) { return $p }
  }
  $extra = @(
    (Join-Path $RepoRoot "packages\vendor\spp\testdata\$name"),
    (Join-Path $RepoRoot "packages\vendor\spp\deployments\testnet\circuit_keys\$name")
  )
  foreach ($p in $extra) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

$needed = @(
  "policy_tx_2_2_proving_key.bin",
  "policy_tx_2_2.wasm",
  "policy_tx_2_2.r1cs"
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
foreach ($n in $needed) {
  $src = Find-File $n
  if (-not $src) {
    Write-Error "Missing $n - run Phase 0 circuits build or copy from .local/spp-phase0/alice/circuits"
  }
  $dst = Join-Path $OutDir $n
  Copy-Item -Force $src $dst
  $len = (Get-Item $dst).Length
  Write-Host ("OK {0} ({1} bytes) from {2}" -f $n, $len, $src)
}

Write-Host ""
Write-Host ("Staged circuits -> {0}" -f $OutDir)
Write-Host ("Desktop: set EXPO_PUBLIC_SPP_CIRCUITS_DIR={0}" -f $OutDir)
Write-Host "Device: copy this dir into app documents spp/circuits (or future asset unpack)."
