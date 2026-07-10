# Desktop CAP_POOL_OPS dogfood - builds/runs on X: (keeps C: free).
#
# Prerequisites: VS Build Tools (vcvars64), rustup MSVC 1.92, stellar CLI, alice identity.
#
# Usage:
#   .\scripts\desktop-pool-demo.ps1 ping
#   .\scripts\desktop-pool-demo.ps1 open
#   .\scripts\desktop-pool-demo.ps1 deposit 0.1
#   .\scripts\desktop-pool-demo.ps1 transfer 0.05 G...
#   .\scripts\desktop-pool-demo.ps1 withdraw 0.05
#
# Optional env:
#   SPP_IDENTITY=alice|bob   (default alice)
#   SPP_DEMO_ROOT=X:\veilpay\spp-demo

param(
  [Parameter(Position = 0)]
  [string]$Command = "ping",
  [Parameter(Position = 1)]
  [string]$Arg1 = "",
  [Parameter(Position = 2)]
  [string]$Arg2 = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$SppNative = Join-Path $RepoRoot "packages\spp-native"
$DemoRoot = if ($env:SPP_DEMO_ROOT) { $env:SPP_DEMO_ROOT } else { "X:\veilpay\spp-demo" }
$CargoHome = "X:\veilpay\cargo-home"
$TargetDir = "X:\veilpay\cargo-target\spp-native"
$Identity = if ($env:SPP_IDENTITY) { $env:SPP_IDENTITY } else { "alice" }

foreach ($d in @($DemoRoot, (Join-Path $DemoRoot "circuits"), (Join-Path $DemoRoot "data"), $CargoHome, $TargetDir)) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

$pk = Join-Path $DemoRoot "circuits\policy_tx_2_2_proving_key.bin"
if (-not (Test-Path $pk)) {
  Write-Host "Staging circuit assets..."
  $stage = Join-Path $SppNative "scripts\stage-circuit-assets.ps1"
  & powershell -NoProfile -File $stage -OutDir (Join-Path $DemoRoot "circuits")
}

$UserAddress = (& stellar keys address $Identity 2>$null | Out-String).Trim()
if (-not $UserAddress.StartsWith("G")) {
  throw "stellar keys address $Identity failed"
}
Write-Host "identity=$Identity address=$UserAddress"

$secret = (& stellar keys secret $Identity 2>$null | Out-String).Trim()
if (-not $secret.StartsWith("S")) {
  throw "stellar keys secret $Identity did not return S key"
}

$env:CARGO_HOME = $CargoHome
$env:CARGO_TARGET_DIR = $TargetDir
$env:SPP_SECRET_KEY = $secret
$env:SPP_USER_ADDRESS = $UserAddress
$env:SPP_CIRCUITS_DIR = (Join-Path $DemoRoot "circuits")

# Prefer Phase 0 onboarded SQLite (has note/enc keys + ASP secret). Fresh DBs need onboard.
$walletPath = Join-Path $DemoRoot "data\$Identity-wallet.sqlite"
$phase0Db = Join-Path $RepoRoot ".local\spp-phase0\$Identity\spp.db"
if (-not (Test-Path $walletPath) -and (Test-Path $phase0Db)) {
  Write-Host "Seeding wallet from Phase 0 $Identity spp.db"
  Copy-Item -Force $phase0Db $walletPath
}
$env:SPP_STORAGE_PATH = $walletPath

if (-not $env:SPP_RPC_URL) { $env:SPP_RPC_URL = "https://soroban-testnet.stellar.org" }
if (-not $env:SPP_NETWORK_PASSPHRASE) { $env:SPP_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015" }
if (-not $env:SPP_POOL_ID) { $env:SPP_POOL_ID = "CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH" }

$deployJson = Join-Path $RepoRoot "packages\vendor\spp\deployments\testnet\deployments.json"
if (Test-Path $deployJson) {
  $env:SPP_CONTRACT_CONFIG = $deployJson
}

$vcvarsCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
  "$env:ProgramFiles\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
  "$env:ProgramFiles\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)
$vcvars = $vcvarsCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $vcvars) {
  throw "vcvars64.bat not found. Install VS Build Tools (link.exe)."
}

Write-Host "CARGO_HOME=$CargoHome"
Write-Host "CARGO_TARGET_DIR=$TargetDir"
Write-Host "circuits=$($env:SPP_CIRCUITS_DIR)"
Write-Host "storage=$($env:SPP_STORAGE_PATH)"

$bin = Join-Path $TargetDir "release\spp_pool_demo.exe"
$skipBuild = ($env:SPP_DEMO_SKIP_BUILD -eq "1") -and (Test-Path $bin)

if (-not $skipBuild) {
  Write-Host "Building spp_pool_demo (pool-ops) on X: ..."
  $inner = @(
    "set RUSTFLAGS=-C link-arg=/STACK:0x20000000",
    "cd /d `"$SppNative`"",
    "rustup run 1.92.0-x86_64-pc-windows-msvc cargo build --release --features pool-ops --bin spp_pool_demo"
  ) -join " && "
  cmd /c "`"$vcvars`" && $inner"
  if ($LASTEXITCODE -ne 0) {
    throw "cargo build failed exit=$LASTEXITCODE"
  }
} else {
  Write-Host "SPP_DEMO_SKIP_BUILD=1 - using existing $bin"
}

if (-not (Test-Path $bin)) {
  $found = Get-ChildItem -Path $TargetDir -Recurse -Filter "spp_pool_demo.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "release" } |
    Select-Object -First 1
  if ($found) { $bin = $found.FullName }
}
if (-not (Test-Path $bin)) {
  throw "spp_pool_demo.exe not found under $TargetDir"
}

Write-Host "Running: $bin $Command $Arg1 $Arg2"
$demoArgs = @($Command)
if ($Arg1) { $demoArgs += $Arg1 }
if ($Arg2) { $demoArgs += $Arg2 }
& $bin @demoArgs
$code = $LASTEXITCODE

Remove-Item Env:SPP_SECRET_KEY -ErrorAction SilentlyContinue
exit $code
