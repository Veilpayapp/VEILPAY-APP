# Install JDK 17 + Android SDK/NDK onto D: (C: is nearly full).
# Safe to re-run.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup-android-toolchain-d.ps1
#
# After success:
#   . ./scripts/env-android-d.ps1
#   npm run eas:preview:android:local

$ErrorActionPreference = "Stop"
$Root = "D:\Android"
$JdkRoot = "D:\jdk"
$SdkRoot = Join-Path $Root "Sdk"
$CmdlineToolsZip = Join-Path $Root "commandlinetools-win.zip"
$JdkZip = Join-Path $JdkRoot "temurin17.zip"

New-Item -ItemType Directory -Force -Path $Root, $JdkRoot, $SdkRoot | Out-Null

function Write-EnvHint {
  Write-Host ""
  Write-Host "=== Session env (or: . .\scripts\env-android-d.ps1) ==="
  Write-Host "JAVA_HOME=$JdkRoot\current"
  Write-Host "ANDROID_HOME=$SdkRoot"
}

# --- JDK 17 (Temurin portable zip -> D:\jdk) ---
$javaExe = Join-Path $JdkRoot "current\bin\java.exe"
if (-not (Test-Path $javaExe)) {
  Write-Host "Downloading Eclipse Temurin JDK 17 to D:\jdk ..."
  $jdkUrl = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
  Invoke-WebRequest -Uri $jdkUrl -OutFile $JdkZip -UseBasicParsing
  Write-Host "Extracting JDK ..."
  Expand-Archive -Path $JdkZip -DestinationPath $JdkRoot -Force
  $extracted = Get-ChildItem $JdkRoot -Directory | Where-Object { $_.Name -like "jdk-17*" } | Select-Object -First 1
  if (-not $extracted) {
    throw "JDK extract failed: no jdk-17* directory under $JdkRoot"
  }
  $link = Join-Path $JdkRoot "current"
  if (Test-Path $link) { Remove-Item -Recurse -Force $link }
  cmd /c "mklink /J `"$link`" `"$($extracted.FullName)`"" | Out-Null
  if (-not (Test-Path $javaExe)) {
    throw "java.exe missing after extract at $javaExe"
  }
  Remove-Item -Force $JdkZip -ErrorAction SilentlyContinue
  Write-Host "JDK OK"
  # java -version writes to stderr; do not treat as terminating under Stop
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $javaExe -version 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Host $_ }
  $ErrorActionPreference = $prevEap
} else {
  Write-Host "JDK already present: $javaExe"
}

# --- Android command-line tools ---
$sdkmanager = Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkmanager)) {
  Write-Host "Downloading Android command-line tools ..."
  $toolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
  Invoke-WebRequest -Uri $toolsUrl -OutFile $CmdlineToolsZip -UseBasicParsing
  $tmp = Join-Path $Root "cmdline-tmp"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive -Path $CmdlineToolsZip -DestinationPath $tmp -Force
  $dest = Join-Path $SdkRoot "cmdline-tools\latest"
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  $inner = Join-Path $tmp "cmdline-tools"
  if (Test-Path $inner) {
    Move-Item $inner $dest
  } else {
    # Some zips nest differently
    $nested = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if ($nested) { Move-Item $nested.FullName $dest }
    else { throw "Unexpected commandlinetools zip layout" }
  }
  Remove-Item -Force $CmdlineToolsZip -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  if (-not (Test-Path $sdkmanager)) {
    throw "sdkmanager.bat missing at $sdkmanager"
  }
  Write-Host "cmdline-tools OK"
} else {
  Write-Host "cmdline-tools already present"
}

$env:JAVA_HOME = Join-Path $JdkRoot "current"
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:Path = "$env:JAVA_HOME\bin;$SdkRoot\cmdline-tools\latest\bin;$SdkRoot\platform-tools;$env:Path"

# Pre-accept licenses (CI-style hashes) so sdkmanager is non-interactive
$licDir = Join-Path $SdkRoot "licenses"
New-Item -ItemType Directory -Force -Path $licDir | Out-Null
$licenseBodies = @{
  "android-sdk-license" = "`n24333f8a63b6825ea9c5514f83c2829b004d1fee`n"
  "android-sdk-preview-license" = "`n84831b9409646a918e30573bab4c9c91346d8abd`n"
  "android-sdk-arm-dbt-license" = "`n859f317696f67ef3d7f30a50a5560e7834b43992`n"
  "google-gdk-license" = "`n33b6a2b64607f11b759f320ef9dff4ae5c47d97a`n"
  "mips-android-sysimage-license" = "`ne9acab5b5fbb560a72cfaecce8946896ff6aab9d`n"
}
foreach ($kv in $licenseBodies.GetEnumerator()) {
  [System.IO.File]::WriteAllText((Join-Path $licDir $kv.Key), $kv.Value)
}
Write-Host "Licenses pre-accepted under $licDir"
Write-Host "Installing platform-tools, android-35, build-tools, ndk..."
& $sdkmanager --sdk_root=$SdkRoot "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.0.12077973"
if ($LASTEXITCODE -ne 0) {
  Write-Host "WARN: sdkmanager exit code $LASTEXITCODE"
}

$ndk = Get-ChildItem (Join-Path $SdkRoot "ndk") -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if ($ndk) {
  Write-Host "NDK: $($ndk.FullName)"
} else {
  Write-Host "WARN: no NDK dir yet"
}

Write-EnvHint
Write-Host "Done. Next: . .\scripts\env-android-d.ps1"
