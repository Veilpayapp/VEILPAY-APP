#requires -Version 5.1
<#
.SYNOPSIS
  Local pre-push gate approximating .github/workflows/ci.yml (workspace job).

.DESCRIPTION
  Run from repo root before `git push origin main`.
  Skips Foundry contracts job when `forge` is not installed (CI still runs it).
  Does not mutate git state.

.EXAMPLE
  pwsh -File scripts/prepush-ci.ps1
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'pnpm-workspace.yaml'))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

function Step([string]$Name, [scriptblock]$Block) {
  Write-Host ""
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  & $Block
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    throw "FAILED: $Name (exit $LASTEXITCODE)"
  }
}

$failures = @()

try {
  Step 'Prisma generate' {
    pnpm --filter @veilpay/backend db:generate
  }
} catch { $failures += $_.Exception.Message }

try {
  Step 'Backend typecheck' {
    pnpm --filter @veilpay/backend typecheck
  }
} catch { $failures += $_.Exception.Message }

try {
  Step 'Backend test' {
    Push-Location apps/backend
    try { npx jest --forceExit } finally { Pop-Location }
  }
} catch { $failures += $_.Exception.Message }

try {
  Step 'Indexer typecheck' {
    pnpm --filter @veilpay/indexer typecheck
  }
} catch { $failures += $_.Exception.Message }

try {
  Step 'Consumer typecheck' {
    Push-Location apps/consumer-app
    try { npx tsc --noEmit } finally { Pop-Location }
  }
} catch { $failures += $_.Exception.Message }

try {
  Step 'Consumer test' {
    Push-Location apps/consumer-app
    try { npx jest --forceExit --passWithNoTests } finally { Pop-Location }
  }
} catch { $failures += $_.Exception.Message }

try {
  Step 'npm audit high (better-npm-audit)' {
    npx better-npm-audit audit --level=high
  }
} catch {
  $failures += "Audit: $($_.Exception.Message) (install better-npm-audit or fix advisories)"
}

try {
  Step 'Solana veil_pool unit tests' {
    Push-Location packages/contracts-solana/programs/veil_pool
    try { cargo test --lib } finally { Pop-Location }
  }
} catch {
  $failures += "Solana cargo test: $($_.Exception.Message)"
}

if (Get-Command forge -ErrorAction SilentlyContinue) {
  try {
    Step 'Foundry EVM tests' {
      Push-Location packages/contracts-evm
      try { forge test -vvv } finally { Pop-Location }
    }
  } catch { $failures += $_.Exception.Message }
} else {
  Write-Host ""
  Write-Host "=== Foundry (optional locally) ===" -ForegroundColor Yellow
  Write-Host "forge not installed — CI contracts job will still run on GitHub."
}

Write-Host ""
if ($failures.Count -gt 0) {
  Write-Host "PRE-PUSH GATES FAILED:" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "PRE-PUSH GATES PASSED (local). Safe to push when ops checklist is ready." -ForegroundColor Green
Write-Host "Ops: plans/OPS_PREPUSH_CHECKLIST_2026-07-14.md"
exit 0
