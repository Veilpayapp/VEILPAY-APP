# SPP — Device APK + OTA handoff (read on session start)

> Saved 2026-07-10 for demo day (~2026-07-23). Desktop dogfood path is **dead** — do not revive.

## Status
- Branch: `harden/consumer-a1-and-spp-phase0`
- Device: ASP register OK (last EAS build)
- In-tree CAP_POOL_OPS: `pool_open` seeds **SDK SQLite privacy keys** from SEP-53 sig (same as `spp onboard` key step) + disclaimer, then LocalProver deposit/transfer/withdraw
- TS: `ensurePoolSession` signs derivation message and passes `derivationSigHex`
- Default APK NDK: **`android-jni` only** — OTA-safe **1.0.1**
- **Android CAP_POOL_OPS .so proven locally** (~16.4MB arm64) with `SPP_NATIVE_POOL_OPS=1`, MSVC host, `.cargo/config.toml` host stack (do not pass `/STACK` into Android clang via env RUSTFLAGS).
- **Version stays 1.0.1** (locked): same `runtimeVersion` / OTA stream as current preview installs. JS feature-detects `poolOps` so old ASP-only APKs stay fail-closed; new native APK with CAP_POOL_OPS also receives `ota:preview`. **Do not bump** unless we intentionally split OTA.

## Do not
- Re-add `spp_pool_demo` / `desktop-pool-demo.ps1` / `X:\veilpay` cargo dogfood
- **Bump `version.json` off 1.0.1** (breaks unified preview OTA with existing installs)
- Use production channel for this workstream
- Put cargo/rustup caches back on C:

## Build APK (local until EAS free Android ~Aug 1)
Needs local JDK 17 + Android SDK + NDK on **D:** (C: full).

```powershell
cd apps/consumer-app
# One-time toolchain on D: (~several GB)
npm run android:toolchain:setup
# Each shell before build:
. .\scripts\env-android-d.ps1

# Same Doppler + preview profile as cloud; --local = no EAS cloud quota
npm run eas:preview:android:local
```

Cloud when quota returns:
```bash
npm run eas:preview:android
```

## Push OTA (after APK installed)
Same runtime (`1.0.1` / appVersion) + **preview** channel/branch:

```bash
cd apps/consumer-app
npm run ota:preview
# doppler run --project veilpay --config prd -- npx eas update --branch preview --environment preview
```

Local APK and cloud APK both receive OTAs if projectId + runtimeVersion + channel match.

## Key paths
| Area | Path |
|------|------|
| Native crate | `packages/spp-native` |
| Expo module | `apps/consumer-app/modules/spp-native` |
| TS orchestration | `apps/consumer-app/src/utils/stellarSpp/` |
| EAS NDK hook | `apps/consumer-app/eas-hooks/build-spp-native-android.*` |
| Version / runtime | `apps/consumer-app/version.json` + `app.config.js` (`runtimeVersion: appVersion`) |
| Circuits stage | `packages/spp-native/scripts/stage-circuit-assets.*` |

## Recent commits
- `078131f` — CAP_POOL_OPS link + session prove/submit
- `c8efa2e` — drop desktop demo; device preview + OTA only

## Next when continuing
1. `. .\scripts\env-android-d.ps1` (all toolchains on D:)
2. Rebuild ABIs with `SPP_NATIVE_POOL_OPS=1` if needed (keep **version 1.0.1**)
3. Stage circuits on device + `npm run eas:preview:android:local`
4. Install → hub `poolOps: ready` → shield → transfer → unshield
5. JS iteration: `npm run ota:preview` (same 1.0.1 runtime — works for both ASP-only and pool-ops APKs)
