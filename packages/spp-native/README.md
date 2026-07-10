# spp-native

Phase 0/1 native FFI shell for VeilPay Stellar Private Payments (SPP).

## Purpose

- Ship a **Rust `cdylib`** next to the consumer app.
- Expose `version` / `ping` / `capabilities` + op stubs until `sdk/pool` is linked.
- Product path is **native** (JNI today → pool ops next) — **not** a product WebView of `sdk/web`.

## C ABI

| Symbol | Behavior |
|--------|----------|
| `spp_native_version()` | Heap C string; free with `spp_native_string_free` |
| `spp_native_ping(input)` | `pong` or `pong:<input>` |
| `spp_native_capabilities()` | `u32` bitmask: bit0=ping, bit1=poolOps, bit2=aspLeaf |
| `spp_native_pool_open(config_json)` | Bind session (pool-ops); needs circuits + S… secret |
| `spp_native_pool_close()` | Drop session |
| `spp_native_deposit(amount)` | Prove+submit when session bound; else not-ready |
| `spp_native_transfer(amount, recipient)` | Same |
| `spp_native_withdraw(amount, to)` | Same |
| `spp_native_ensure_asp()` | Derive-first hint; insert_leaf is TS/Soroban |
| `spp_native_string_free(ptr)` | Frees strings from this library |

Phase 1a/1b returns **only bit0** (`CAP_PING`). Op symbols exist as stubs so the RN
bridge has a stable ABI; real prove/submit lands when `sdk/pool` is linked.

## Build (desktop)

```bat
cd packages\spp-native
cargo test
cargo build --release
```

Windows note: if you later link `stellar-private-payments-sdk` / circuits, use the SPP
recipe (`vcvars64` + `RUSTFLAGS=-C link-arg=/STACK:0x20000000`).

## Android NDK (Phase 1c)

Expo module path: `apps/consumer-app/modules/spp-native` (`@veilpay/expo-spp-native`).

### EAS (preferred — ships `.so` in preview/prod APK)

`apps/consumer-app` defines:

```json
"eas-build-post-install": "node eas-hooks/build-spp-native-android.js"
```

On **EAS Android** builders this:

1. Installs rustup + `cargo-ndk` if needed
2. Builds `libspp_native.so` for arm64-v8a / armeabi-v7a / x86_64
3. Writes into `modules/spp-native/android/src/main/jniLibs/` before Gradle

Archive requirements (root `.easignore`):

- `packages/spp-native/` **committed** (EAS skips untracked files)
- `vendor/poseidon2` inside that crate (Poseidon2; not full SPP submodule)
- `apps/consumer-app/modules/spp-native` committed (Expo module + empty jniLibs)
- `target/` excluded; `.so` is built on the EAS builder

Emergency bypass: `SPP_NATIVE_SKIP=1` (APK falls back to Kotlin stubs, no ASP leaf).

### Local build (machine with Android SDK)

Prerequisites: `ANDROID_HOME` / `ANDROID_NDK_HOME`, `cargo install cargo-ndk`, Rust.

```powershell
cd packages\spp-native
.\scripts\build-android-ndk.ps1
```

Or:

```bash
./scripts/build-android-ndk.sh
```

This builds with `--features android-jni` and writes:

```text
apps/consumer-app/modules/spp-native/android/src/main/jniLibs/
  arm64-v8a/libspp_native.so
  armeabi-v7a/libspp_native.so
  x86_64/libspp_native.so
```

Kotlin `SppNativeRust.tryLoad()` → `System.loadLibrary("spp_native")`.
If the `.so` is missing (Expo Go / no NDK build), the Expo module keeps pure Kotlin stubs
with `backend: "native"`, `aspLeaf: false`, `poolOps: false`.

### Verify on device

```bash
cd apps/consumer-app
# EAS preview APK, or local:
npm install
npx expo run:android
```

Open Settings → Private XLM (or hub). Expect:

- `backend: native` (always in dev-client with the Expo module)
- `version: 0.1.0` (crate) once `.so` is loaded; `0.1.0-native-android` for Kotlin-only
- `aspLeaf: true` when Rust `.so` loaded (`CAP_ASP_LEAF`)
- `poolOps: not ready` until `CAP_POOL_OPS` is set (sdk/pool link)

## Cargo features

| Feature | Default | Purpose |
|---------|---------|---------|
| `derive-keys` | on | Poseidon2 ASP leaf + note/enc keys |
| `android-jni` | off | JNI exports for Kotlin `SppNativeRust` |
| `pool-ops` | off | Link `stellar-private-payments-sdk` + real prove/submit (`CAP_POOL_OPS`) |

### Device APK (preview only — Doppler + EAS)

Product path is **Android preview APK**, not desktop demo binaries.

From `apps/consumer-app` (same pattern as existing user scripts):

```bash
# Native APK (channel: preview). Secrets via Doppler.
npm run eas:preview:android

# JS OTA after the APK is installed (same runtimeVersion = appVersion).
npm run ota:preview
```

`runtimeVersion` uses `appVersion` policy (`version.json` → currently **1.0.1**).
Keep that pin for OTA: do **not** bump `version` for JS-only OTAs; bump only when
shipping a new native binary that changes the native surface.

Default EAS NDK post-install builds **derive-only** (`android-jni`, `CAP_ASP_LEAF`).
Ops stay fail-closed (`SPP_OPS_NOT_READY`) so OTAs remain safe on this runtime.

Opt-in CAP_POOL_OPS on a **future** native APK (requires version bump + full SPP in
EAS archive + wasmer NDK): set `SPP_NATIVE_POOL_OPS=1` on the EAS job, then ship
as a new `appVersion` (e.g. 1.1.0) so OTA streams stay split correctly.

### Session API (when `pool-ops` linked in the APK)

1. Stage circuits into app assets / documents (`scripts/stage-circuit-assets.*`)
2. `spp_native_pool_open(json)` — binds `PrivatePool`
3. `deposit` / `transfer` / `withdraw` — prove + submit
4. `spp_native_pool_close()`

App TS: `ensurePoolSession` in `apps/consumer-app/src/utils/stellarSpp/sppPoolSession.ts`.

zkhash path is always `../vendor/spp/poseidon2` (shared with sdk/pool). EAS materializes
that path from `vendor/poseidon2` when the submodule is missing.

## ASP leaf

CLI recipe (permissionless on current testnet ASP membership contract):

```text
leaf = poseidon2_hash2(note_pubkey, membership_blinding, domain=1)
stellar contract invoke --id CDSJXWV5… --network testnet --source <id> -- insert_leaf --leaf <dec>
```

App path: derive_keys → insert_leaf from TS onboard when leaf returned; CAP_ASP_LEAF is set when `.so` loads.

## Phase 1 remaining

1. ~~Expo module + autolink~~
2. ~~EAS NDK package~~ (post-install) — derive/ASP on device when preview APK ships
3. ~~sdk/pool linked in-tree~~ (`pool-ops` feature; off by default for OTA-safe APK)
4. CAP_POOL_OPS in preview APK (`SPP_NATIVE_POOL_OPS=1` + appVersion bump) when EAS allows
5. On-device shield → transfer → unshield (Jest lifecycle green with mock pool)

5. ~~Privacy mode switch animation~~ (Home Moti/Reanimated keys)
6. Android prove bench; mainnet fail-closed until audit/ceremony
