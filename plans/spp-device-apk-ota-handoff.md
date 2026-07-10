# SPP — Device APK + OTA handoff (read on session start)

> Saved 2026-07-10 for demo day (~2026-07-23). Desktop dogfood path is **dead** — do not revive.

## Status
- Branch: `harden/consumer-a1-and-spp-phase0`
- Device: ASP register OK; hub can show Rust `0.1.0` + `aspLeaf` when `.so` ships
- In-tree: `sdk/pool` linked behind feature **`pool-ops`** + `pool_open` session FFI + TS `ensurePoolSession`
- Default APK NDK build: **`android-jni` only** (derive/ASP) — **OTA-safe** on `appVersion` **1.0.1**
- CAP_POOL_OPS on device: opt-in `SPP_NATIVE_POOL_OPS=1` + **version bump** (e.g. 1.1.0) when shipping that native

## Do not
- Re-add `spp_pool_demo` / `desktop-pool-demo.ps1` / `X:\veilpay` cargo dogfood
- Bump `version.json` for JS-only OTA
- Use production channel for this workstream

## Build APK (local until EAS free Android ~Aug 1)
Needs local JDK 17 + Android SDK + NDK. Prefer non-C: disk for SDK/Gradle.

```bash
cd apps/consumer-app
# Same Doppler + preview profile as cloud; --local = no EAS cloud quota
doppler run --project veilpay --config prd -- npx eas build --platform android --profile preview --local
# equivalent idea: npm run eas:preview:android -- --local  (if npm forwards args)
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
1. Install Android SDK/NDK/JDK if missing; point env at D: or X: if C: full
2. Local preview APK (`eas build --local --profile preview` + Doppler)
3. Install on device → verify hub `backend: native`, `aspLeaf`
4. `npm run ota:preview` for JS-only iteration
5. Later: `SPP_NATIVE_POOL_OPS=1` + bump to 1.1.0 + circuits on device + E2E shield/transfer/unshield
