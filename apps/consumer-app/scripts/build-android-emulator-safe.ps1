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

$buildArgs = @('assembleDebug', '-PreactNativeArchitectures=x86_64', '--no-daemon')
$pathLengthPattern = 'Filename longer than 260 characters|ninja:\s+error:\s+Stat\('

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

function Clear-NativeCaches {
  param([string]$Root)

  Write-Host '[build:emulator] Path-length signature detected. Cleaning stale native caches and retrying once...'

  Get-ChildItem -Path (Join-Path $Root 'node_modules') -Directory -Recurse -Filter .cxx -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  Remove-Item -Recurse -Force (Join-Path $Root 'android/app/.cxx') -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $Root 'android/app/build/intermediates/cxx') -ErrorAction SilentlyContinue
}

Write-Host '[build:emulator] Starting x86_64 debug build...'
$firstAttempt = Invoke-GradleBuild -WorkingDirectory $androidDir -Arguments $buildArgs

if ($firstAttempt.ExitCode -eq 0) {
  Write-Host '[build:emulator] Build succeeded on first attempt.'
  exit 0
}

if ($firstAttempt.Output -match $pathLengthPattern) {
  Clear-NativeCaches -Root $projectRoot

  $secondAttempt = Invoke-GradleBuild -WorkingDirectory $androidDir -Arguments $buildArgs
  if ($secondAttempt.ExitCode -eq 0) {
    Write-Host '[build:emulator] Build succeeded after auto-clean retry.'
  }
  else {
    Write-Host '[build:emulator] Retry failed. See Gradle output above.'
  }

  exit $secondAttempt.ExitCode
}

Write-Host '[build:emulator] Build failed with a non-path-length error. No auto-clean retry performed.'
exit $firstAttempt.ExitCode
