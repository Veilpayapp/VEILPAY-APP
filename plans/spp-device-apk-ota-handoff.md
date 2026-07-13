# SPP — Device APK + OTA handoff (read on session start)

> Updated 2026-07-10 (session: CAP_POOL_OPS multi-ABI + Windows APK path fight).  
> Desktop dogfood path is **dead** — do not revive.

## Status
- Branch: `harden/consumer-a1-and-spp-phase0`
- Device: ASP register OK (last EAS build). **No device attached** in this session (`adb devices` empty).
- **CAP_POOL_OPS `.so` rebuilt all ABIs** with `SPP_NATIVE_POOL_OPS=1` (pool_open + sdk/pool):
  | ABI | size (approx) |
  |-----|----------------|
  | arm64-v8a | 16.4 MB |
  | armeabi-v7a | 11.7 MB |
  | x86_64 | 18.9 MB |
  Path: `apps/consumer-app/modules/spp-native/android/src/main/jniLibs/` (**gitignored**).
- Circuits staged to `apps/consumer-app/assets/spp/circuits/` (policy_tx_2_2 wasm/r1cs/proving key).  
  Device still needs **adb push** into app documents `spp/circuits/` after install.
- **Version stays 1.0.1** (locked). Do not bump `version.json`.
- In-tree JS/native: poolOps feature-detect; `ensurePoolSession` + derivation sig wired.

## Blockers (this machine, 2026-07-10)

### 1. EAS free Android quota exhausted until ~Aug 1
```
This account has used its Android builds from the Free plan this month,
which will reset in 21 days (on Sat Aug 01 2026).
```
Cloud `eas:preview:android` uploads then fails. **Do not burn another attempt** until quota returns unless upgraded.

### 2. `eas:preview:android:local` does **not** work on Windows
```
Unsupported platform, macOS or Linux is required to build apps for Android
```
Handoff recipe that only says `npm run eas:preview:android:local` is **macOS/Linux only**.

### 3. Windows Gradle APK blocked by MAX_PATH (pnpm)
Local `assembleDebug` / `assembleRelease` hits ninja:
```
Filename longer than 260 characters
```
on paths under `node_modules/.pnpm/react-native-reanimated@.../Common/cpp/...` (and similar).

Mitigations **in tree** (Windows-only, safe on EAS Linux):
- `android/build.gradle` — short `buildDir` → `D:\gbd\...` + cmake staging → `D:\cxx\...`
- `packages/spp-native/scripts/build-android-ndk.ps1` — host MSVC stack repair for circuits build-script (`editbin` / PE patch); fail on cargo exit code
- Optional session prep: short copies under `D:\nm\rnr` + `react-native.config.js` roots (only if those dirs exist)

**Still not fully unblocked** this session: after reanimated short-root, app-level RN cmake / other long sources still fail. Next options:
1. **Best:** finish local APK on **macOS / Linux / WSL2** with the prebuilt `jniLibs` + Doppler, or wait for **EAS free Android Aug 1**.
2. Flatten deps: monorepo `node-linker=hoisted` (large install; try only if needed).
3. Shorter clone path + hoisted install (e.g. `D:\vp`).

## Do not
- Re-add desktop dogfood / `X:\veilpay` cargo demos
- **Bump `version.json` off 1.0.1**
- Production channel
- Put cargo/rustup caches back on C:
- Set env `RUSTFLAGS=/STACK:...` for cargo-ndk (breaks Android clang) — host stack only via  
  `packages/spp-native/.cargo/config.toml` + `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS`

## Env (each shell)
```powershell
cd D:\Veilpay\apps\consumer-app
. .\scripts\env-android-d.ps1
# RUSTUP_HOME=D:\rustup CARGO_HOME=D:\cargo-home ANDROID_* on D:\Android\Sdk
# CARGO_TARGET_DIR=D:\cargo-target\spp-native
```

## Rebuild CAP_POOL_OPS `.so` (all ABIs)
```powershell
cd D:\Veilpay\apps\consumer-app
. .\scripts\env-android-d.ps1
$env:SPP_NATIVE_POOL_OPS = "1"
# Do NOT set RUSTFLAGS=/STACK for cargo-ndk
cd D:\Veilpay\packages\spp-native
.\scripts\build-android-ndk.ps1
```
If circuits build-script stack-overflows: script auto-patches PE stack / retries.  
Manual: `editbin /STACK:536870912` on  
`D:\cargo-target\spp-native\release\build\circuits-*\build-script-build.exe`.

## Stage circuits
```powershell
cd D:\Veilpay\packages\spp-native
.\scripts\stage-circuit-assets.ps1
# Device (after APK install, package com.veilpay.consumer):
adb shell mkdir -p /sdcard/Android/data/com.veilpay.consumer/files/spp/circuits
adb push D:\Veilpay\apps\consumer-app\assets\spp\circuits\. /sdcard/Android/data/com.veilpay.consumer/files/spp/circuits/
# If app uses documentDirectory under app-private storage, push there after first launch:
#   adb shell run-as com.veilpay.consumer ...
```

## Ship APK

### When EAS free Android returns (~Aug 1) or paid
```powershell
cd D:\Veilpay\apps\consumer-app
. .\scripts\env-android-d.ps1
$env:SPP_NATIVE_POOL_OPS = "1"   # only if EAS post-install rebuilds .so; local jniLibs also ship if present
npm run eas:preview:android
# stay on 1.0.1 appVersion
```

### macOS / Linux local EAS
```bash
npm run eas:preview:android:local
```

### Windows local Gradle (experimental — MAX_PATH)
```powershell
. .\scripts\env-android-d.ps1
# Ensure jniLibs pool-ops .so present; short-path mitigations in android/build.gradle
doppler run --project veilpay --config prd -- `
  powershell -NoProfile -Command "cd android; .\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon"
# APK may land under D:\gbd\_app\outputs\apk\debug\ if buildDir was relocated
```

## OTA (JS only, same 1.0.1 runtime)
```powershell
cd D:\Veilpay\apps\consumer-app
npm run ota:preview
```
Works for ASP-only and pool-ops native APKs that share `runtimeVersion` = `1.0.1` + preview channel.

## Device E2E (after pool-ops APK + circuits)
1. Install APK; open app; Settings / SPP hub
2. Expect: Rust version `0.1.0`, `aspLeaf: ok`, **`poolOps: ready`** (or open session after disclaimer)
3. Shield (deposit) → transfer → unshield
4. Time/RSS note for Phase 1 prove bench

## Key paths
| Area | Path |
|------|------|
| Native crate | `packages/spp-native` |
| Expo module | `apps/consumer-app/modules/spp-native` |
| TS orchestration | `apps/consumer-app/src/utils/stellarSpp/` |
| EAS NDK hook | `apps/consumer-app/eas-hooks/build-spp-native-android.*` |
| Version / runtime | `apps/consumer-app/version.json` + `app.config.js` (`runtimeVersion: appVersion`) |
| Circuits stage | `packages/spp-native/scripts/stage-circuit-assets.*` |
| NDK build | `packages/spp-native/scripts/build-android-ndk.ps1` |
| Host stack config | `packages/spp-native/.cargo/config.toml` |
| Windows short build dirs | `D:\gbd`, `D:\cxx` (local only) |

## Next when continuing
1. **Unblock APK:** WSL2/Linux/macOS local EAS, **or** EAS free Android after Aug 1, **or** finish Windows MAX_PATH (hoisted linker / short monorepo path).
2. Plug device → install APK → adb push circuits → hub `poolOps: ready`.
3. E2E shield → transfer → unshield.
4. JS polish: `npm run ota:preview` (1.0.1).
5. Optional: commit durable fixes already in working tree (NDK stack repair script, `android/build.gradle` win-shortpath, `react-native.config.js` gated roots, handoff).
