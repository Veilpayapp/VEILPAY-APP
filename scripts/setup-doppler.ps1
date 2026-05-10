<#
.SYNOPSIS
  Bootstrap Doppler CLI for VeilPay secret management.

.DESCRIPTION
  Installs the Doppler CLI, authenticates, sets up the project, and pulls
  secrets into the local .env files so the app can run without any manual
  secret editing.

.USAGE
  .\scripts\setup-doppler.ps1 [-Project veilpay] [-Config dev]

.REQUIREMENTS
  - Windows PowerShell 5.1+ or PowerShell 7+
  - Internet access
  - Doppler account at https://doppler.com

.NOTES
  Production deployments: secrets are injected at runtime via
    doppler run -- npm start
  Never store real secrets in .env files — only in Doppler.
#>

param(
  [string]$Project = "veilpay",
  [string]$Config  = "dev"
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
  Write-Host "`n>>> $msg" -ForegroundColor Cyan
}

function Write-OK([string]$msg) {
  Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Warn([string]$msg) {
  Write-Host "  [!]  $msg" -ForegroundColor Yellow
}

# ── 1. Install Doppler CLI ────────────────────────────────────────────────────
Write-Step "Checking Doppler CLI installation..."

if (-not (Get-Command doppler -ErrorAction SilentlyContinue)) {
  Write-Warn "Doppler CLI not found. Installing via Scoop..."

  if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
    Write-Warn "Scoop not found. Installing Scoop first..."
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
    Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
  }

  scoop install doppler
  Write-OK "Doppler CLI installed."
} else {
  $version = (doppler --version 2>&1)
  Write-OK "Doppler CLI already installed: $version"
}

# ── 2. Authenticate ──────────────────────────────────────────────────────────
Write-Step "Authenticating with Doppler..."

$authStatus = (doppler me 2>&1)
if ($LASTEXITCODE -ne 0) {
  Write-Warn "Not authenticated. Opening browser for login..."
  doppler login
} else {
  Write-OK "Already authenticated: $authStatus"
}

# ── 3. Configure project ─────────────────────────────────────────────────────
Write-Step "Configuring Doppler project: $Project / $Config"

Push-Location $PSScriptRoot\..

doppler setup `
  --project $Project `
  --config  $Config `
  --no-interactive

Write-OK "Project configured."

# ── 4. Pull secrets into local .env ──────────────────────────────────────────
Write-Step "Pulling secrets to .env (backend)..."

doppler secrets download `
  --no-file `
  --format env `
  > .env

Write-OK "Backend .env written."

Write-Step "Pulling EXPO_PUBLIC_* secrets to apps/consumer-app/.env.local..."

# Filter only EXPO_PUBLIC_* variables for the mobile app
doppler secrets download `
  --no-file `
  --format env `
  | Select-String "^EXPO_PUBLIC_" `
  | ForEach-Object { $_.Line } `
  | Out-File -FilePath "apps\consumer-app\.env.local" -Encoding utf8

Write-OK "Consumer-app .env.local written."

Pop-Location

# ── 5. Verify ────────────────────────────────────────────────────────────────
Write-Step "Verifying required secrets..."

$required = @(
  "JWT_SECRET",
  "API_KEY_SALT",
  "WEBHOOK_SIGNING_SECRET",
  "DATABASE_URL",
  "ALCHEMY_API_KEY",
  "INFURA_API_KEY"
)

$missing = @()
foreach ($key in $required) {
  $val = doppler secrets get $key --plain 2>$null
  if ([string]::IsNullOrWhiteSpace($val)) {
    $missing += $key
    Write-Warn "Missing: $key"
  } else {
    Write-OK "Present: $key (length=$($val.Length))"
  }
}

if ($missing.Count -gt 0) {
  Write-Host "`n[ERROR] The following required secrets are missing in Doppler:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Write-Host "`nAdd them at https://dashboard.doppler.com/workplace/projects/$Project/configs/$Config/secrets" -ForegroundColor Yellow
  exit 1
}

Write-Host "`n[SUCCESS] All required secrets present. Run 'doppler run -- npm start' to start the backend." -ForegroundColor Green
