$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $projectRoot 'android'
$localProps = Join-Path $androidDir 'local.properties'

function Get-SdkPath {
  param([string]$PropertiesPath)

  if (-not (Test-Path $PropertiesPath)) {
    return $null
  }

  $sdkLine = (Get-Content $PropertiesPath -Encoding UTF8 | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1)
  if (-not $sdkLine) {
    return $null
  }

  $sdkPathFromFile = $sdkLine -replace '^sdk\.dir=', ''
  # Gradle properties escape backslashes and colons in Windows paths.
  $sdkPathFromFile = $sdkPathFromFile -replace '\\\\', '\'
  $sdkPathFromFile = $sdkPathFromFile -replace '\\:', ':'
  return $sdkPathFromFile.Trim()
}

function Ensure-Java {
  $candidateJavaHomes = @(
    $env:JAVA_HOME,
    'D:\\Android studio\\Android panda\\jbr',
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jre'),
    (Join-Path $env:LOCALAPPDATA 'Programs\\Android Studio\\jbr'),
    'D:\\Android studio\\jbr'
  ) | Where-Object { $_ -and $_.Trim() -ne '' }

  $gradleManagedJava = $null
  if (Test-Path 'D:\\Gradle\\jdks') {
    $gradleManagedJava = Get-ChildItem -Path 'D:\\Gradle\\jdks' -Filter java.exe -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
    if ($gradleManagedJava) {
      $candidateJavaHomes += (Split-Path -Parent (Split-Path -Parent $gradleManagedJava))
    }
  }

  foreach ($candidate in $candidateJavaHomes) {
    $javaExe = Join-Path $candidate 'bin\java.exe'
    $jvmCfg = Join-Path $candidate 'lib\jvm.cfg'
    if ((Test-Path $javaExe) -and (Test-Path $jvmCfg)) {
      $env:JAVA_HOME = $candidate
      if ($env:PATH -notlike "*$candidate\\bin*") {
        $env:PATH = "$candidate\\bin;$env:PATH"
      }
      return
    }
  }

  throw 'JAVA_HOME is not set and no Java runtime was auto-detected. Install JDK 17/21 or Android Studio and set JAVA_HOME.'
}

function Wait-ForEmulatorDevice {
  param(
    [string]$AdbPath,
    [int]$TimeoutSeconds = 180
  )

  $elapsed = 0
  while ($elapsed -lt $TimeoutSeconds) {
    $deviceLine = (& $AdbPath devices | Select-String 'emulator-\d+\s+device' | Select-Object -First 1)
    if ($deviceLine) {
      return
    }

    Start-Sleep -Seconds 3
    $elapsed += 3
  }

  throw "Timed out waiting for emulator to appear in adb devices after $TimeoutSeconds seconds."
}

function Wait-ForBootCompleted {
  param(
    [string]$AdbPath,
    [int]$TimeoutSeconds = 360
  )

  $elapsed = 0
  while ($elapsed -lt $TimeoutSeconds) {
    $bootRaw = & $AdbPath shell getprop sys.boot_completed 2>$null
    if ($LASTEXITCODE -ne 0) {
      # Recover from occasional adb transport/protocol faults during emulator init.
      & $AdbPath kill-server | Out-Null
      & $AdbPath start-server | Out-Null
      Start-Sleep -Seconds 2
      $elapsed += 2
      continue
    }

    $boot = [string]$bootRaw
    if (-not [string]::IsNullOrWhiteSpace($boot) -and $boot.Trim() -eq '1') {
      return
    }

    Start-Sleep -Seconds 2
    $elapsed += 2
  }

  throw "Timed out waiting for emulator boot completion after $TimeoutSeconds seconds."
}

function Test-MetroRunning {
  try {
    $status = Invoke-WebRequest -Uri 'http://127.0.0.1:8081/status' -UseBasicParsing -TimeoutSec 2
    $content = $status.Content
    if ($content -is [byte[]]) {
      $content = [System.Text.Encoding]::UTF8.GetString($content)
    }

    return ([string]$content) -match 'packager-status:running'
  }
  catch {
    return $false
  }
}

function Ensure-MetroRunning {
  param([string]$WorkingDirectory)

  if (Test-MetroRunning) {
    Write-Host 'Metro is already running on http://127.0.0.1:8081'
    return
  }

  Write-Host 'Starting Metro in background (dev client, localhost host mode)...'

  $metroCommand = 'npx expo start --dev-client --host localhost'

  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $metroCommand) -WorkingDirectory $WorkingDirectory -WindowStyle Minimized | Out-Null

  $elapsed = 0
  $timeoutSeconds = 150
  while ($elapsed -lt $timeoutSeconds) {
    if (Test-MetroRunning) {
      Write-Host 'Metro is running.'
      return
    }

    Start-Sleep -Seconds 2
    $elapsed += 2
  }

  throw "Timed out waiting for Metro to start after $timeoutSeconds seconds."
}

function Ensure-AdbReverse {
  param([string]$AdbPath)

  $deviceLines = & $AdbPath devices | Select-String '^[^\s]+\s+device$' | ForEach-Object { $_.Line }
  foreach ($line in $deviceLines) {
    $serial = ($line -split '\s+')[0]
    if (-not $serial) {
      continue
    }

    & $AdbPath -s $serial reverse tcp:8081 tcp:8081 | Out-Null
  }
}

Ensure-Java

$sdkPath = Get-SdkPath -PropertiesPath $localProps
if (-not $sdkPath) {
  $sdkPath = $env:ANDROID_SDK_ROOT
}
if (-not $sdkPath) {
  $sdkPath = $env:ANDROID_HOME
}
if (-not $sdkPath) {
  throw 'Could not resolve Android SDK path. Set sdk.dir in android/local.properties or ANDROID_SDK_ROOT.'
}

$sdkPath = $sdkPath.Trim()
if (-not (Test-Path $sdkPath)) {
  throw "Android SDK path does not exist: $sdkPath"
}

$emulatorExe = Join-Path $sdkPath 'emulator\emulator.exe'
$adbExe = Join-Path $sdkPath 'platform-tools\adb.exe'

if (-not (Test-Path $emulatorExe)) {
  throw "emulator.exe not found at $emulatorExe"
}
if (-not (Test-Path $adbExe)) {
  throw "adb.exe not found at $adbExe"
}

# Start an AVD if none is running.
$runningEmulators = & $adbExe devices | Select-String 'emulator-' | ForEach-Object { $_.Line }
if (-not $runningEmulators) {
  $avdList = @(& $emulatorExe -list-avds)
  if (-not $avdList -or $avdList.Count -eq 0) {
    throw 'No AVD found. Create one in Android Studio Device Manager first.'
  }

  $avdName = $avdList[0].Trim()
  if (-not $avdName) {
    throw 'Could not resolve a valid AVD name.'
  }

  Write-Host "Starting emulator: $avdName"
  Start-Process -FilePath $emulatorExe -ArgumentList "-avd `"$avdName`"" | Out-Null

  Write-Host 'Waiting for emulator boot...'
  & $adbExe start-server | Out-Null
  Wait-ForEmulatorDevice -AdbPath $adbExe
  Wait-ForBootCompleted -AdbPath $adbExe
}

# Build + install through Expo, then force-launch package in case Studio/Gradle does not auto-open app.
Push-Location $projectRoot
try {
  Ensure-MetroRunning -WorkingDirectory $projectRoot
  Ensure-AdbReverse -AdbPath $adbExe

  $localExpoCmd = Join-Path $projectRoot 'node_modules\.bin\expo.cmd'
  if (Test-Path $localExpoCmd) {
    & $localExpoCmd run:android --no-bundler
  }
  else {
    & npx --yes expo run:android --no-bundler
  }

  if ($LASTEXITCODE -ne 0) {
    throw 'expo run:android failed.'
  }

  & $adbExe shell monkey -p com.veilpay.consumer -c android.intent.category.LAUNCHER 1 | Out-Null
  Write-Host 'App launch command sent to emulator.'
}
finally {
  Pop-Location
}
