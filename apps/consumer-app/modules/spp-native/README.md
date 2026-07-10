# @veilpay/expo-spp-native

Local **Expo Module** that bridges React Native to Stellar Private Payments native ops.

## Status

| Phase | What |
|-------|------|
| **1b (this module)** | Kotlin/Swift stubs: `version`, `ping`, `capabilities`, op JSON stubs |
| **1c (NDK)** | `SppNativeRust` JNI + `jniLibs/`; EAS `eas-build-post-install` runs cargo-ndk |
| **1d** | `sdk/pool` path-linked via feature `pool-ops` + `pool_open` session; device APK pending EAS |
| Product | Native only — **no** WebView of SPP `sdk/web` |

## Autolinking

Expo discovers the module via `file:./modules/spp-native` in the app
`package.json` (and the usual `modules/` layout).

**expo-doctor “duplicate” warning is a false positive:** the same package is
reported at `modules/spp-native` (source) and `node_modules/@veilpay/expo-spp-native`
(symlink/junction). Autolinking resolves **one** Android project
(`veilpay-expo-spp-native`). EAS may print doctor exit code 1 but still continues
the build when this is the only failure.

Verified: `npx expo-modules-autolinking resolve --platform android` lists a single:

- `packageName: @veilpay/expo-spp-native`
- `name: veilpay-expo-spp-native`
- `classifier: expo.modules.sppnative.SppNativeModule`

After pulling changes:

```bash
cd apps/consumer-app
npm install
# needs Android SDK + device/emulator:
npx expo run:android        # dev client — Expo Go will NOT include this module
```

On the hub (`StellarSppScreen`):

| Environment | `backend` | `version` (typical) | `poolOps` |
|-------------|-----------|---------------------|-----------|
| Expo Go / Jest | `js-stub` | `0.1.0-js-stub` | false |
| Dev client, no `.so` | `native` | `0.1.0-native-android` | false |
| Dev client + NDK `.so` | `native` | crate semver (`0.1.0`) | false until CAP_POOL_OPS |

## Build Rust into jniLibs

**EAS (ships in APK):** `eas-build-post-install` → `eas-hooks/build-spp-native-android.js`
builds `libspp_native.so` into `android/src/main/jniLibs/` before Gradle.

**Local** (requires NDK + `cargo-ndk`):

```powershell
cd packages\spp-native
.\scripts\build-android-ndk.ps1
```

See `packages/spp-native/README.md` § Android NDK.

## JS API

```ts
import { getSppNativeExpoModule, isSppNativeExpoAvailable } from '@veilpay/expo-spp-native';

if (isSppNativeExpoAvailable()) {
  const m = getSppNativeExpoModule()!;
  m.version();
  m.ping('veilpay');
  m.capabilities(); // { backend: 'native', poolOps: false, ... }
}
```

`apps/consumer-app/src/utils/stellarSpp/sppNativeBridge.ts` prefers this module
and falls back to the pure JS stub in Jest / Expo Go.

## ASP leaf (app productization)

Until native `ensureAsp` is ready, the hub checklist shows the CLI `insert_leaf` hint
(permissionless on current testnet). Leaf formula: Phase 0 findings
(`poseidon2_hash2(note_pubkey, membership_blinding, domain=1)`).
