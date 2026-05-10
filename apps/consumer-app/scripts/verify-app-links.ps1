param(
  [string]$PackageName = 'com.veilpay.consumer',
  [string]$HostName = 'veilpay.app',
  [switch]$OpenIntents
)

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
  $sdkPathFromFile = $sdkPathFromFile -replace '\\\\', '\'
  $sdkPathFromFile = $sdkPathFromFile -replace '\\:', ':'
  return $sdkPathFromFile.Trim()
}

function Get-AdbPath {
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

  $adbExe = Join-Path $sdkPath 'platform-tools\adb.exe'
  if (-not (Test-Path $adbExe)) {
    throw "adb.exe not found at $adbExe"
  }

  return $adbExe
}

function Ensure-Device {
  param([string]$AdbPath)

  $devices = & $AdbPath devices
  $connected = $devices | Select-String '^[^\s]+\s+device$' | Where-Object { $_.Line -notmatch '^List of devices attached' }

  if (-not $connected) {
    throw 'No connected Android device/emulator found in adb devices.'
  }
}

function Invoke-DeepLinkIntent {
  param(
    [string]$AdbPath,
    [string]$Label,
    [string]$Uri,
    [string]$Component
  )

  Write-Host "[verify:app-links] $Label"

  $quotedUri = '"' + $Uri + '"'

  if ($Component) {
    $quotedComponent = '"' + $Component + '"'
    $result = & $AdbPath shell am start -W -n $quotedComponent -a android.intent.action.VIEW -d $quotedUri
  }
  else {
    $result = & $AdbPath shell am start -W -a android.intent.action.VIEW -d $quotedUri
  }

  $result | ForEach-Object { Write-Host $_ }
}

$adbExe = Get-AdbPath
Ensure-Device -AdbPath $adbExe

Write-Host "[verify:app-links] Checking app links for package: $PackageName"

$appLinksOutput = & $adbExe shell pm get-app-links $PackageName 2>&1
$appLinksOutput | ForEach-Object { Write-Host $_ }

$appLinksText = ($appLinksOutput | Out-String)

if ($appLinksText -match 'verified|approved|always') {
  Write-Host '[verify:app-links] Domain appears verified or approved.'
}
else {
  Write-Warning '[verify:app-links] Domain is not clearly verified yet. Check assetlinks.json and signing fingerprints.'
}

if ($OpenIntents) {
  $sampleAddress = '0x1111111111111111111111111111111111111111'
  $schemeUri = "veilpay://send?address=$sampleAddress"
  $httpsUri = "https://$HostName/send?address=$sampleAddress"

  Invoke-DeepLinkIntent -AdbPath $adbExe -Label 'Custom scheme intent' -Uri $schemeUri
  Invoke-DeepLinkIntent -AdbPath $adbExe -Label 'HTTPS generic intent' -Uri $httpsUri
  Invoke-DeepLinkIntent -AdbPath $adbExe -Label 'HTTPS explicit app intent' -Uri $httpsUri -Component "$PackageName/.MainActivity"
}

Write-Host '[verify:app-links] Completed.'