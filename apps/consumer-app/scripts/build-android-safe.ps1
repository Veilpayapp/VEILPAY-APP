$ErrorActionPreference = 'Stop'

# PowerShell 7 can convert native stderr output into terminating errors when
# ErrorActionPreference is Stop. Gradle writes warnings to stderr, so rely on
# process exit codes instead of stderr channel semantics.
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $projectRoot 'android'

# Keep Gradle cache root short to reduce Windows path-length risk.
$env:GRADLE_USER_HOME = 'D:\g'
$env:NODE_ENV = 'development'

$buildArgs = @('assembleDebug', '--no-daemon')
$pathLengthPattern = 'Filename longer than 260 characters|ninja:\s+error:\s+Stat\('
$staleAutolinkingPattern = 'ReactNativeApplicationEntryPoint\.java|BuildConfig\.IS_NEW_ARCHITECTURE_ENABLED|package\s+com\.anonymous\.consumerapp\s+does not exist'

function Invoke-GradleBuild {
  param(
    [string]$WorkingDirectory,
    [string[]]$Arguments
  )

  $stdOutFile = [System.IO.Path]::GetTempFileName()
  $stdErrFile = [System.IO.Path]::GetTempFileName()

  try {
    $startProcessParams = @{
      FilePath = (Join-Path $WorkingDirectory 'gradlew.bat')
      ArgumentList = $Arguments
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

    foreach ($line in $output) {
      Write-Host $line
    }

    return @{
      ExitCode = $process.ExitCode
      Output = ($output | Out-String)
    }
  }
  finally {
    Remove-Item -Path $stdOutFile -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $stdErrFile -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-GradleClean {
  param(
    [string]$WorkingDirectory
  )

  $stdOutFile = [System.IO.Path]::GetTempFileName()
  $stdErrFile = [System.IO.Path]::GetTempFileName()

  try {
    $startProcessParams = @{
      FilePath = (Join-Path $WorkingDirectory 'gradlew.bat')
      ArgumentList = @('clean', '--no-daemon', '--no-configuration-cache')
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

    foreach ($line in $output) {
      Write-Host $line
    }

    return @{
      ExitCode = $process.ExitCode
      Output = ($output | Out-String)
    }
  }
  finally {
    Remove-Item -Path $stdOutFile -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $stdErrFile -Force -ErrorAction SilentlyContinue
  }
}

function Clear-NativeCaches {
  param([string]$Root)

  Write-Host '[build:safe] Path-length signature detected. Cleaning stale native caches and retrying once...'

  Get-ChildItem -Path (Join-Path $Root 'node_modules') -Directory -Recurse -Filter .cxx -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  Remove-Item -Recurse -Force (Join-Path $Root 'android/app/.cxx') -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $Root 'android/app/build/intermediates/cxx') -ErrorAction SilentlyContinue
}

function Clear-StaleAutolinkingArtifacts {
  param([string]$Root)

  Write-Host '[build:safe] Stale autolinking/package mismatch detected. Cleaning generated artifacts and retrying once...'

  Remove-Item -Recurse -Force (Join-Path $Root 'android/app/build/generated/autolinking') -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $Root 'android/app/build/generated/source/buildConfig') -ErrorAction SilentlyContinue
}

Write-Host '[build:safe] Stopping Gradle daemons...'
Push-Location $androidDir
try {
  & .\gradlew.bat --stop | Out-Host
}
finally {
  Pop-Location
}

Write-Host '[build:safe] Starting full debug build...'
$firstAttempt = Invoke-GradleBuild -WorkingDirectory $androidDir -Arguments $buildArgs

if ($firstAttempt.ExitCode -eq 0) {
  Write-Host '[build:safe] Build succeeded on first attempt.'
  exit 0
}

if ($firstAttempt.Output -match $pathLengthPattern) {
  Clear-NativeCaches -Root $projectRoot

  $secondAttempt = Invoke-GradleBuild -WorkingDirectory $androidDir -Arguments $buildArgs
  if ($secondAttempt.ExitCode -eq 0) {
    Write-Host '[build:safe] Build succeeded after auto-clean retry.'
  }
  else {
    Write-Host '[build:safe] Retry failed. See Gradle output above.'
  }

  exit $secondAttempt.ExitCode
}

if ($firstAttempt.Output -match $staleAutolinkingPattern) {
  Clear-StaleAutolinkingArtifacts -Root $projectRoot

  $cleanAttempt = Invoke-GradleClean -WorkingDirectory $androidDir
  if ($cleanAttempt.ExitCode -ne 0) {
    Write-Host '[build:safe] Clean step failed while recovering stale autolinking artifacts.'
    exit $cleanAttempt.ExitCode
  }

  $secondAttempt = Invoke-GradleBuild -WorkingDirectory $androidDir -Arguments $buildArgs
  if ($secondAttempt.ExitCode -eq 0) {
    Write-Host '[build:safe] Build succeeded after stale-autolinking recovery retry.'
  }
  else {
    Write-Host '[build:safe] Retry failed after stale-autolinking recovery. See Gradle output above.'
  }

  exit $secondAttempt.ExitCode
}

Write-Host '[build:safe] Build failed with a non-path-length error. No auto-clean retry performed.'
exit $firstAttempt.ExitCode
