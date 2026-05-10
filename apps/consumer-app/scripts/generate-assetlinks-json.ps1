param(
  [string]$PackageName = 'com.veilpay.consumer',
  [string[]]$Variants = @('debug', 'release'),
  [string]$OutputPath,
  [switch]$PrintOnly
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $projectRoot 'android'

if (-not $OutputPath) {
  $OutputPath = Join-Path $projectRoot 'assetlinks.json'
}

function Invoke-GradleSigningReport {
  param([string]$WorkingDirectory)

  $stdOutFile = [System.IO.Path]::GetTempFileName()
  $stdErrFile = [System.IO.Path]::GetTempFileName()

  try {
    $startProcessParams = @{
      FilePath = (Join-Path $WorkingDirectory 'gradlew.bat')
      ArgumentList = @('signingReport', '--no-daemon', '--no-configuration-cache')
      WorkingDirectory = $WorkingDirectory
      NoNewWindow = $true
      Wait = $true
      PassThru = $true
      RedirectStandardOutput = $stdOutFile
      RedirectStandardError = $stdErrFile
    }
    $process = Start-Process @startProcessParams

    $output = @()
    if (Test-Path $stdOutFile) {
      $output += Get-Content -Path $stdOutFile -Encoding UTF8
    }
    if (Test-Path $stdErrFile) {
      $output += Get-Content -Path $stdErrFile -Encoding UTF8
    }

    if ($process.ExitCode -ne 0) {
      $tail = ($output | Select-Object -Last 40) -join [Environment]::NewLine
      throw "gradlew signingReport failed with exit code $($process.ExitCode).`n$tail"
    }

    return $output
  }
  finally {
    Remove-Item -Path $stdOutFile -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $stdErrFile -Force -ErrorAction SilentlyContinue
  }
}

function Get-FingerprintsByVariant {
  param([string[]]$SigningReportLines)

  $map = @{}
  $currentVariant = $null
  $sha256Pattern = '^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$'

  foreach ($line in $SigningReportLines) {
    $trimmed = $line.Trim()

    if ($trimmed -match '^Variant:\s*(.+)$') {
      $currentVariant = $Matches[1].Trim().ToLowerInvariant()
      continue
    }

    if ($currentVariant -and $trimmed -match '^SHA-256:\s*([A-Fa-f0-9:]+)$') {
      $fingerprint = $Matches[1].Trim().ToUpperInvariant()
      if ($fingerprint -match $sha256Pattern) {
        $map[$currentVariant] = $fingerprint
      }
    }
  }

  return $map
}

if (-not (Test-Path $androidDir)) {
  throw "Android directory not found: $androidDir"
}

Write-Host '[app-links:assetlinks] Running gradlew signingReport...'
$signingReport = Invoke-GradleSigningReport -WorkingDirectory $androidDir
$variantFingerprints = Get-FingerprintsByVariant -SigningReportLines $signingReport

if ($variantFingerprints.Count -eq 0) {
  throw 'No SHA-256 fingerprints were parsed from signingReport output.'
}

$selectedFingerprints = New-Object System.Collections.Generic.List[string]
foreach ($variant in $Variants) {
  if (-not $variant) {
    continue
  }

  $normalizedVariant = $variant.Trim().ToLowerInvariant()
  if ($variantFingerprints.ContainsKey($normalizedVariant)) {
    $selectedFingerprints.Add($variantFingerprints[$normalizedVariant])
  }
  else {
    Write-Warning "Variant '$normalizedVariant' was not found in signingReport output."
  }
}

$selectedFingerprints = $selectedFingerprints | Select-Object -Unique
$selectedFingerprints = @($selectedFingerprints)

if (-not $selectedFingerprints -or $selectedFingerprints.Count -eq 0) {
  $available = ($variantFingerprints.Keys | Sort-Object) -join ', '
  throw "No fingerprints selected. Available variants: $available"
}

$payloadObject = @{
  relation = @('delegate_permission/common.handle_all_urls')
  target = @{
    namespace = 'android_app'
    package_name = $PackageName
    sha256_cert_fingerprints = [string[]]$selectedFingerprints
  }
}

$json = "[`n$($payloadObject | ConvertTo-Json -Depth 8)`n]"

Write-Host "[app-links:assetlinks] Package: $PackageName"
Write-Host "[app-links:assetlinks] Variants: $($Variants -join ', ')"
Write-Host '[app-links:assetlinks] Fingerprints:'
foreach ($fingerprint in $selectedFingerprints) {
  Write-Host "  - $fingerprint"
}

if ($PrintOnly) {
  Write-Host ''
  Write-Host $json
  return
}

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and -not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

[System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.Encoding]::ASCII)

Write-Host "[app-links:assetlinks] Wrote: $OutputPath"
Write-Host '[app-links:assetlinks] Publish this file to https://<host>/.well-known/assetlinks.json'