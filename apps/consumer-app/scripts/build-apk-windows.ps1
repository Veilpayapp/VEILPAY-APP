# Build a standalone (embedded JS) release APK on Windows WITHOUT EAS cloud.
# Requires: JDK 17, Android SDK/NDK on D:, Doppler, pool-ops jniLibs already built.
#
# Usage:
#   cd apps/consumer-app
#   . .\scripts\env-android-d.ps1
#   # once: root D:\Veilpay\.npmrc has node-linker=hoisted + pnpm install
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk-windows.ps1
#   # optional debug (expects Metro at runtime - NOT for sideload dogfood):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk-windows.ps1 -Configuration debug
#
# Output (release, default):
#   android\app\build\outputs\apk\release\app-release.apk
#   build-artifacts\veilpay-preview-poolops-release.apk
#   (contains assets/index.android.bundle - opens without Metro)

param(
  [ValidateSet("release", "debug")]
  [string]$Configuration = "release"
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $projectRoot "..\..")).Path
$androidDir = Join-Path $projectRoot "android"
$so = Join-Path $projectRoot "modules\spp-native\android\src\main\jniLibs\arm64-v8a\libspp_native.so"
$isRelease = $Configuration -eq "release"
$gradleTask = if ($isRelease) { "assembleRelease" } else { "assembleDebug" }
$apkRel = if ($isRelease) {
  "app\build\outputs\apk\release\app-release.apk"
} else {
  "app\build\outputs\apk\debug\app-debug.apk"
}
$artifactName = if ($isRelease) {
  "veilpay-preview-poolops-release.apk"
} else {
  "veilpay-preview-poolops-debug.apk"
}
$requiredCircuitAssets = @(
  "policy_tx_2_2_proving_key.bin",
  "policy_tx_2_2.wasm",
  "policy_tx_2_2.r1cs"
)

Write-Host "[apk-win] project=$projectRoot configuration=$Configuration"

# Env
$envScript = Join-Path $PSScriptRoot "env-android-d.ps1"
if (Test-Path $envScript) { . $envScript }
$env:GRADLE_USER_HOME = if ($env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME } else { "D:\g" }
$env:NODE_ENV = if ($isRelease) { "production" } else { "development" }
$env:ANDROID_NDK_HOME = if (Test-Path "D:\Android\Sdk\ndk\27.1.12297006") {
  "D:\Android\Sdk\ndk\27.1.12297006"
} else { $env:ANDROID_NDK_HOME }

if (-not (Test-Path $so)) {
  throw "Missing $so - run packages/spp-native/scripts/build-android-ndk.ps1 with SPP_NATIVE_POOL_OPS=1 first"
}
Write-Host "[apk-win] pool-ops .so OK ($((Get-Item $so).Length) bytes)"

# Hoist check
$rn = Join-Path $repoRoot "node_modules\react-native\package.json"
if (-not (Test-Path $rn)) {
  throw "Missing $rn - set node-linker=hoisted in repo .npmrc and run pnpm install"
}

# Re-point app node_modules junctions from long .pnpm paths to hoisted short roots
function Repair-PnpmJunctions([string]$AppNm, [string]$RootNm) {
  $fixed = 0
  Get-ChildItem $AppNm -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $item = $_
    if ($item.Name -eq ".bin") { return }
    if ($item.PSIsContainer -and $item.Name.StartsWith("@")) {
      Get-ChildItem $item.FullName -Force -EA SilentlyContinue | ForEach-Object {
        $sub = $_
        if ($sub.Attributes -match "ReparsePoint") {
          $target = $sub.Target; if ($target -is [array]) { $target = $target[0] }
          if ($target -and ($target -match "\\\.pnpm\\")) {
            $short = Join-Path $RootNm (Join-Path $item.Name $sub.Name)
            if (Test-Path $short) {
              cmd /c "rmdir `"$($sub.FullName)`"" | Out-Null
              cmd /c "mklink /J `"$($sub.FullName)`" `"$short`"" | Out-Null
              $fixed++
            }
          }
        }
      }
      return
    }
    if ($item.Attributes -match "ReparsePoint") {
      $target = $item.Target; if ($target -is [array]) { $target = $target[0] }
      if ($target -and ($target -match "\\\.pnpm\\")) {
        $short = Join-Path $RootNm $item.Name
        if (Test-Path $short) {
          cmd /c "rmdir `"$($item.FullName)`"" | Out-Null
          cmd /c "mklink /J `"$($item.FullName)`" `"$short`"" | Out-Null
          $fixed++
        }
      }
    }
  }
  Write-Host "[apk-win] re-pointed $fixed long .pnpm junctions -> hoisted roots"
}
$appNm = Join-Path $projectRoot "node_modules"
$rootNm = Join-Path $repoRoot "node_modules"
if (Test-Path $appNm) {
  Repair-PnpmJunctions -AppNm $appNm -RootNm $rootNm
}

# local.properties
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "D:\Android\Sdk" }
"sdk.dir=$($sdk -replace '\\','\\')" | Set-Content (Join-Path $androidDir "local.properties") -Encoding ASCII

Write-Host "[apk-win] assembling arm64-v8a $Configuration APK (Doppler, NODE_ENV=$env:NODE_ENV)..."
Push-Location $androidDir
try {
  $code = 0
  doppler run --project veilpay --config prd -- cmd /c "gradlew.bat $gradleTask -PreactNativeArchitectures=arm64-v8a --no-daemon"
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw "gradlew failed exit=$code" }
} finally {
  Pop-Location
}

$apk = Join-Path $androidDir $apkRel
if (-not (Test-Path $apk)) { throw "APK not found at $apk" }

# Standalone dogfood requires embedded JS; fail release builds that omit it.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
try {
  $bundleEntry = $zip.Entries | Where-Object {
    $_.FullName -eq "assets/index.android.bundle" -or $_.FullName -eq "assets/index.android.bundle.hbc"
  } | Select-Object -First 1
  $hasSpp = ($zip.Entries | Where-Object { $_.FullName -match "libspp_native\.so$" }).Count -gt 0
  $missingCircuitAssets = $requiredCircuitAssets | Where-Object {
    $name = $_
    -not ($zip.Entries | Where-Object { $_.FullName -eq "assets/spp/circuits/$name" } | Select-Object -First 1)
  }
} finally {
  $zip.Dispose()
}

if ($isRelease -and -not $bundleEntry) {
  throw "Release APK missing assets/index.android.bundle - not standalone (would red-screen without Metro)"
}
if ($bundleEntry) {
  Write-Host "[apk-win] embedded JS OK: $($bundleEntry.FullName) ($($bundleEntry.Length) bytes)"
} else {
  Write-Host "[apk-win] WARNING: no embedded JS bundle (debug expects Metro)"
}
if ($hasSpp) {
  Write-Host "[apk-win] libspp_native.so present in APK"
} else {
  Write-Host "[apk-win] WARNING: libspp_native.so missing from APK"
}
if ($missingCircuitAssets.Count -gt 0) {
  throw "APK missing bundled SPP circuit assets: $($missingCircuitAssets -join ', ')"
}
Write-Host "[apk-win] bundled SPP circuit assets present in APK; app seeds them to app data on first readiness check"

$outDir = Join-Path $projectRoot "build-artifacts"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$dest = Join-Path $outDir $artifactName
Copy-Item -Force $apk $dest
Write-Host ""
Write-Host "[apk-win] BUILD OK"
Write-Host "  $apk"
Write-Host "  $dest  ($((Get-Item $dest).Length) bytes)"
Write-Host ""
Write-Host "Install: adb install -r `"$dest`""
Write-Host "Circuits: bundled in APK under assets/spp/circuits/ and auto-seeded to app data by SppNative.ensureCircuitAssets()"
if ($isRelease) {
  Write-Host "Standalone: yes (no Metro required)"
} else {
  Write-Host "Standalone: NO - start Metro or use -Configuration release"
}
