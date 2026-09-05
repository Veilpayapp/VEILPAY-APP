# EAS Preview Android APK Build — Troubleshooting Guide

Quick reference for common build failures and how to debug them.

---

## Build Lifecycle Reference

```
┌─────────────────────────────────────────────────────────┐
│ 1. EAS receives build request (cloud or local)          │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│ 2. PRE-INSTALL: eas-build-pre-install hook              │
│    → inject-secrets.js (Node wrapper)                   │
│    → install-doppler.sh (Doppler CLI download + auth)   │
│    → Downloads secrets from Doppler (project: veilpay,  │
│      config: prd) into .env                             │
│    → Validates EXPO_PUBLIC_BACKEND_BASE_URL +           │
│      EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID               │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│ 3. INSTALL: pnpm install                                │
│    → Installs all dependencies listed in package.json   │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│ 4. POST-INSTALL: eas-build-post-install hook            │
│    → build-spp-native-android.js (Node wrapper)         │
│    → build-spp-native-android.sh (Rust NDK build)       │
│    → Builds libspp_native.so (Poseidon2 + CAP_POOL_OPS) │
│    → Output: modules/spp-native/android/src/main/      │
│              jniLibs/arm64-v8a/libspp_native.so         │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│ 5. PREBUILD: Expo prebuild (native config generation)   │
│    → Reads app.config.js                                │
│    → Generates android/app/build.gradle                 │
│    → Validates plugins against package.json             │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│ 6. GRADLE BUILD: gradlew assembleRelease                │
│    → Compiles Java + Kotlin + native libs               │
│    → Includes libspp_native.so from jniLibs             │
│    → Package as APK                                     │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│ 7. SUCCESS: APK ready for download                      │
│    → build-artifacts/consumer-app.apk                   │
└─────────────────────────────────────────────────────────┘
```

---

## Common Failures & Diagnosis

### ❌ "DOPPLER_TOKEN is not set" (Warning, not error)

**Symptoms:**
```
[doppler-hook] WARNING: DOPPLER_TOKEN is not set.
[doppler-hook] Skipping Doppler download. Ensure .env exists locally.
```

**Cause:** Running `eas build --local` without `doppler run` wrapper.

**Fix:**
```bash
# Option 1: Wrap command with doppler
doppler run --project veilpay --config prd -- eas build --platform android --profile preview --local

# Option 2: Ensure .env file exists locally
cat .env  # should have EXPO_PUBLIC_BACKEND_BASE_URL and others
```

**Prevention:** Always use `doppler run` for local builds, or pre-populate `.env`.

---

### ❌ "ERROR: Doppler download produced an empty .env"

**Symptoms:**
```
[doppler-hook] ERROR: Doppler download produced an empty .env.
[doppler-hook] Check that DOPPLER_TOKEN is valid and the project/config exist.
```

**Causes:**
1. DOPPLER_TOKEN is expired or revoked
2. Token is scoped to wrong Doppler project
3. Doppler project `veilpay` doesn't exist
4. Doppler config `prd` doesn't exist
5. Network issue reaching api.doppler.com

**Fix:**
```bash
# 1. Verify token is valid
doppler --token=$DOPPLER_TOKEN projects list

# 2. Verify project exists
doppler projects --token=$DOPPLER_TOKEN

# 3. Verify config exists
doppler configs --project veilpay --token=$DOPPLER_TOKEN

# 4. Test manual download
doppler secrets download --project veilpay --config prd --token=$DOPPLER_TOKEN --format env

# 5. Check network (curl to Doppler API)
curl -I https://api.doppler.com/v3/configs/config/secrets
```

**Prevention:**
- Rotate DOPPLER_TOKEN annually
- Keep token scope minimal (only consumer-app project)
- Test token before deploying to CI

---

### ❌ "ERROR: Required secrets missing from Doppler: EXPO_PUBLIC_BACKEND_BASE_URL"

**Symptoms:**
```
[doppler-hook] ERROR: Required secrets missing from Doppler:
  - EXPO_PUBLIC_BACKEND_BASE_URL
  - EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID
```

**Cause:** Secrets not configured in Doppler `veilpay` project, `prd` config.

**Fix:**
1. Log into Doppler dashboard: https://dashboard.doppler.com
2. Navigate to: Projects → veilpay → prd (config)
3. Add/verify these secrets:
   - `EXPO_PUBLIC_BACKEND_BASE_URL` = `https://api.veilpay.com` (or your staging URL)
   - `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` = `<your-wc-project-id>`
4. Re-run build

**Prevention:** Document all required secrets in ENV_SETUP.md; sync checklist before releases.

---

### ❌ "ERROR: bash is required on EAS"

**Symptoms:**
```
[doppler-hook] bash required on EAS - exit code 1
```

**Cause:** EAS build server doesn't have bash (very rare; should be Linux).

**Fix:** Contact Expo support; EAS Linux builders always include bash.

**Prevention:** Not applicable (Expo maintains EAS infrastructure).

---

### ❌ "ERROR: Could not resolve latest Doppler CLI version"

**Symptoms:**
```
[doppler-hook] ERROR: Could not resolve latest Doppler CLI version.
```

**Cause:**
1. GitHub API rate limit reached (shared IP on EAS)
2. Network issue reaching github.com
3. GitHub changed release structure

**Fix:**
```bash
# Option 1: Hardcode version (temporary)
# Edit install-doppler.sh, line 67-68:
# DOPPLER_VERSION="v3.76.0"  # instead of resolving

# Option 2: Set DOPPLER_VERSION env var
export DOPPLER_VERSION="v3.76.0"
eas build --platform android --profile preview

# Option 3: Use GitHub raw archive URL (if release structure changed)
# Contact Doppler for recommended download URL
```

**Prevention:**
- Hardcode version before GA release
- Cache Doppler CLI binary on EAS (contact Expo)

---

### ❌ "ERROR: Android NDK not found"

**Symptoms:**
```
[spp-native-ndk] ERROR: Android NDK not found. Set ANDROID_NDK_HOME or install NDK under ANDROID_HOME/ndk.
```

**Cause:** EAS builder missing NDK or environment variables not set.

**Fix:**
```bash
# 1. Verify NDK is installed on EAS (should be automatic)
# 2. If local build, install NDK:
export ANDROID_NDK_HOME=/path/to/ndk/26.0.10792818
eas build --platform android --profile preview --local

# 3. Or use ANDROID_HOME:
export ANDROID_HOME=/path/to/sdk
# EAS will search ANDROID_HOME/ndk for highest version
```

**Prevention:** EAS provides NDK by default; only needed for local builds.

---

### ❌ "ERROR: no libspp_native.so produced after successful build"

**Symptoms:**
```
[spp-native-ndk] Build succeeded, but no .so files found in jniLibs
```

**Cause:**
1. cargo ndk output directory misconfigured
2. Rust build succeeded but linker didn't produce .so
3. Permissions issue writing to jniLibs

**Fix:**
```bash
# 1. Check jniLibs directory exists and is writable
ls -la apps/consumer-app/modules/spp-native/android/src/main/jniLibs/

# 2. Re-run build with debugging
export SPP_NATIVE_DEBUG=1
eas build --platform android --profile preview --local

# 3. Check Rust compilation output
find /tmp/spp-cargo-build.log -exec tail -100 {} \;

# 4. Verify Cargo.toml has correct features
cat packages/spp-native/Cargo.toml | grep -A5 "\[lib\]"
```

**Prevention:** Run local build once to verify setup before deploying.

---

### ❌ "ERROR: Out of memory" (cargo build failed)

**Symptoms:**
```
[spp-native-ndk] error: out of memory
[spp-native-ndk] Killed (exit code 137 / signal 9)
```

**Cause:** EAS builder ran out of RAM during Rust compilation (especially with pool-ops).

**Fix:**
```bash
# Option 1: Disable pool-ops feature (derive-only, faster)
# Edit eas.json, preview config:
"env": { "SPP_NATIVE_POOL_OPS": "0" }

# Option 2: Request larger EAS builder (contact Expo)
# Current: standard builder (2GB RAM)
# Upgrade: 4GB or 8GB instance

# Option 3: Split build into two profiles (compile on separate builders)
# Not recommended; adds complexity
```

**Prevention:**
- Test with pool-ops locally before GA release
- Monitor EAS build logs for memory warnings
- Use derive-only for development, pool-ops only for production

---

### ❌ Metro bundler error: "Cannot find module EXPO_PUBLIC_..."

**Symptoms:**
```
error: Cannot find module '$ENV_VARIABLE'
```

**Cause:**
1. .env not created by Doppler hook
2. Variable not prefixed with EXPO_PUBLIC_
3. Metro bundling started before .env was written

**Fix:**
```bash
# 1. Verify .env exists and is readable
cat .env | grep EXPO_PUBLIC_BACKEND_BASE_URL

# 2. Verify variable has correct prefix
# (non-EXPO_PUBLIC_* vars are stripped by security filter)

# 3. Check envValidation.ts for static process.env access
# (dynamic access process.env[key] won't be inlined by Metro)

# 4. Re-run build; hook order is:
#    pre-install (doppler) → install (pnpm) → post-install (spp-native) → prebuild → metro
```

**Prevention:**
- Use static `process.env.EXPO_PUBLIC_*` in code (not loops/dynamic access)
- Test with `eas build --local` first before cloud build

---

### ❌ Gradle error: "aapt: error: file not found: libspp_native.so"

**Symptoms:**
```
aapt: error: file not found: libspp_native.so
```

**Cause:** NDK build failed silently or .so output path misconfigured.

**Fix:**
```bash
# 1. Check build log for NDK build errors
grep -i "error" eas_build_*.log | head -20

# 2. Verify .so output directory
find apps/consumer-app/modules/spp-native/android/src/main/jniLibs -name "*.so"

# 3. If missing, re-run post-install hook manually
cd apps/consumer-app
node eas-hooks/build-spp-native-android.js

# 4. Check Gradle is scanning correct jniLibs path
cat android/app/build.gradle | grep -i "jniLibs"
```

**Prevention:** Run `eas build --platform android --profile preview --local` once to validate full flow.

---

## Quick Reference: Environment Variables

### EAS Configuration
```bash
# Set these as EAS Secrets (web dashboard or CLI):
eas secret:create --scope project --name DOPPLER_TOKEN --value "dp.sv_prod_..."

# Override Doppler project/config (if using staging):
export DOPPLER_PROJECT="veilpay-staging"
export DOPPLER_CONFIG="stg"
eas build --platform android --profile preview
```

### Build Environment Variables
```bash
# In eas.json preview profile:
"env": {
  "SPP_NATIVE_POOL_OPS": "1",           # Enable pool-ops feature
  "SPP_NATIVE_SKIP": "0",               # 1 = skip NDK build (emergency bypass)
  "SPP_NATIVE_DEBUG": "0",              # 1 = verbose logging
  "SPP_NATIVE_BUILD_ALL_ABIS": "0"     # 1 = build arm64-v8a + armeabi-v7a + x86_64
}

# CLI override:
export SPP_NATIVE_POOL_OPS=1
eas build --platform android --profile preview --local
```

### Local Development
```bash
# Required for local builds:
export DOPPLER_TOKEN="dp.sv_prod_..." # or use: doppler run --
export ANDROID_NDK_HOME="/path/to/ndk/26.0.10792818"
export ANDROID_HOME="/path/to/sdk"

# Optional (debugging):
export SPP_NATIVE_DEBUG=1
export NODE_OPTIONS="--max-old-space-size=8192"
```

---

## Logging & Diagnostics

### View EAS Build Logs
```bash
# Real-time (cloud build):
eas build --platform android --profile preview --wait

# Or download after build:
eas build:list  # Find build ID
eas build:view <build-id>

# Local build logs:
tail -f eas_build_android.log
```

### Inspect APK Contents
```bash
# Extract and inspect secrets (verify inlining):
unzip consumer-app.apk "assets/index.android.bundle" -d /tmp/apk
strings /tmp/apk/assets/index.android.bundle | grep EXPO_PUBLIC_BACKEND

# Check native libs:
unzip consumer-app.apk "lib/arm64-v8a/libspp_native.so" -d /tmp/apk
file /tmp/apk/lib/arm64-v8a/libspp_native.so
```

### Debug Pre-Install Hook
```bash
# Run hook manually:
cd apps/consumer-app
node eas-hooks/inject-secrets.js  # if DOPPLER_TOKEN set

# Or with bash directly:
export DOPPLER_TOKEN="dp.sv_prod_..."
bash eas-hooks/install-doppler.sh

# Check generated .env:
cat .env
```

---

## Contacting Support

### Escalation Path
1. **Build error in logs** → Check this guide first
2. **Doppler token issue** → Verify in Doppler dashboard
3. **NDK/Rust issue** → Local reproduction (`eas build --local`)
4. **Expo/EAS platform issue** → Contact Expo support with build ID

### Information to Gather
```bash
# For bug reports:
eas build:view <build-id> > build-log.txt          # Full log
cat apps/consumer-app/eas.json                      # Config
cat apps/consumer-app/package.json | head -40       # Scripts/dependencies
node -v && npm -v && pnpm -v                        # Versions
rustup show && cargo --version                      # Rust versions (if local build)
```

---

## See Also
- `EAS_PREVIEW_ANDROID_BUILD_AUDIT.md` — Technical audit
- `EAS_AUDIT_FINDINGS_IMPLEMENTATION.md` — Implementation guide
- `EAS_AUDIT_EXECUTIVE_SUMMARY.md` — Executive summary
- `ENV_SETUP.md` — Environment configuration
