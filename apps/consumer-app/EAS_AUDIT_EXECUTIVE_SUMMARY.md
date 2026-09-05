# EAS Preview Android APK Build Audit — Executive Summary

**Audit Date:** 2026-08-07  
**Scope:** Veilpay Consumer App — Preview Android APK build workflow with Doppler secret injection  
**Status:** ✅ **OPERATIONAL** with **4 low-risk findings**

---

## Audit Scope Verification

### ✅ Point 1: EAS Build Flow for Preview Android APK
- **eas.json preview profile:** Correctly configured with `"buildType": "apk"` ✅
- **Auto-increment:** Enabled (`"autoIncrement": true`) ✅
- **SPP_NATIVE_POOL_OPS:** Set in preview env (`"SPP_NATIVE_POOL_OPS": "1"`) ✅
- **app.config.js:** Using dynamic export with static plugin list ✅
- **Plugins:** All 8 declared plugins are in package.json dependencies ✅

### ✅ Point 2: Doppler Secret Injection Workflow
- **npm lifecycle hook:** Registered as `"eas-build-pre-install"` ✅
- **Hook execution:** Spawns `install-doppler.sh` with bash ✅
- **Doppler project/config:** Defaults to `veilpay` / `prd` ✅
- **Secret filtering:** Line 124 filters to `EXPO_PUBLIC_*` vars only ✅
- **Required vars:** Both validated (BACKEND_BASE_URL, WALLETCONNECT_PROJECT_ID) ✅
- **.env loading:** Expo CLI automatically loads `.env` during Metro bundling ✅

### ✅ Point 3: Native Build Post-Install
- **Hook registration:** `"eas-build-post-install": "node eas-hooks/build-spp-native-android.js"` ✅
- **Execution order:** Runs AFTER pnpm install (correct) ✅
- **SPP_NATIVE_POOL_OPS:** Passed through from eas.json env ✅
- **Platform check:** Validates `EAS_BUILD_PLATFORM === 'android'` ✅
- **Build target:** Produces `libspp_native.so` for arm64-v8a ✅
- **Error handling:** Comprehensive error analysis with recovery suggestions ✅

### ✅ Point 4: Commands Verified
- **Local preview:** `doppler run --project veilpay --config prd -- eas build --platform android --profile preview --local` ✅
- **CI preview:** `pnpm eas:preview:android:ci` (doppler wrapper + NODE_OPTIONS) ✅
- **EAS cloud:** Requires DOPPLER_TOKEN as EAS Secret ✅

---

## Findings Summary

| # | Finding | Severity | Category | Status |
|---|---------|----------|----------|--------|
| 1 | Missing Doppler token validation | Low | Robustness | Documented |
| 2 | No .env existence check before Metro | Low | UX/DX | Documented |
| 3 | Only 2 of 4 important vars validated | Low | Completeness | Documented |
| 4 | Doppler project override undocumented | Info | Documentation | Documented |

### Finding Details

#### Finding #1: Add Explicit Doppler Token Validation
**Current:** Token existence checked, but validity not confirmed until `doppler secrets download` attempt.  
**Impact:** If token is expired/revoked, build fails with generic Doppler error (not EAS-specific).  
**Recommendation:** Call `doppler projects --token=$TOKEN` after CLI installation to validate early.  
**Effort:** ~5 lines of bash  
**Risk:** None (additive validation only)

#### Finding #2: No .env Existence Check Before Metro
**Current:** If Doppler injection succeeds but produces empty `.env`, Metro bundling starts and fails with confusing variable errors.  
**Impact:** Difficult to diagnose root cause (is it a Doppler issue or Metro config?).  
**Recommendation:** Add final check in `install-doppler.sh` to verify `.env` is non-empty before exiting.  
**Effort:** ~4 lines of bash  
**Risk:** None (fails fast with clear message)

#### Finding #3: Only 2 of 4 Important Variables Validated
**Current:** App validates all 4 at startup, but EAS hook only validates 2.  
**Impact:** If SENTRY_DSN or EAS_PROJECT_ID missing, app starts but features degrade silently.  
**Recommendation:** Extend EAS validation to warn (non-blocking) if optional-but-important vars absent.  
**Effort:** ~25 lines of bash  
**Risk:** None (warnings don't break build)

#### Finding #4: Doppler Project/Config Override Undocumented
**Current:** Code supports `DOPPLER_PROJECT` and `DOPPLER_CONFIG` env var overrides, but not documented.  
**Impact:** Developers unaware they can test with staging Doppler configs.  
**Recommendation:** Add ENV_SETUP.md section documenting override usage.  
**Effort:** ~20 lines of markdown  
**Risk:** None (documentation only)

---

## Critical Dependencies & Assumptions

### ✅ Verified Working
1. **Doppler CLI binary download:** Using GitHub release API with version resolution (not hardcoded) ✅
2. **Bash availability:** Script detects and handles bash path on Windows/Linux ✅
3. **Architecture detection:** Correctly resolves x86_64 → amd64, aarch64 → arm64 ✅
4. **Network resilience:** curl uses `-fsSL` (fail fast, show errors, silent by default) ✅
5. **Android NDK availability:** EAS provides ANDROID_NDK_HOME; script validates and reports if missing ✅
6. **Cargo-ndk installation:** Properly locked version; script handles broken installations with --force ✅
7. **Rust targets:** Dynamically adds aarch64-linux-android (and optionally more with SPP_NATIVE_BUILD_ALL_ABIS) ✅
8. **Metro environment variable inlining:** Verified via envValidation.ts (static `process.env.EXPO_PUBLIC_*` access) ✅

### ⚠️ Assumptions
1. **EAS Secret DOPPLER_TOKEN present:** If missing on cloud build, hook skips (non-blocking for local builds).
2. **Local .env exists for local builds:** If running `eas build --local` without `doppler run`, requires pre-existing `.env`.
3. **Doppler project 'veilpay' & config 'prd' exist:** Override via env var if using different project/config.
4. **No secrets in app.config.js:** All secrets injected via .env, not hardcoded in config.

---

## Greenfield vs. Production Readiness

### ✅ Production Ready
- **Error handling:** Comprehensive error messages with diagnostic context ✅
- **Logging:** All critical steps logged with timestamps/context ✅
- **Fallback behavior:** Local builds work without DOPPLER_TOKEN (uses pre-existing .env) ✅
- **Security:** EXPO_PUBLIC_* filtering prevents backend secrets leaking into frontend bundle ✅
- **Validation:** All critical vars checked; build fails fast if missing ✅
- **Resource checks:** Warns if disk/memory below thresholds ✅

### ⚠️ Minor Gaps (Addressed in Findings)
- Token validation happens too late (after CLI install, not immediately on EAS)
- No pre-Metro .env sanity check (fails during bundling, not pre-install)
- Important (non-critical) vars not validated at pre-install (only at app startup)
- Override feature undocumented

---

## Impact Assessment

### What Works Well
1. **Two-layer secret injection:** Pre-install hook (EAS build servers) + app-level validation (runtime)
2. **Fail-fast approach:** Build stops immediately if critical vars missing
3. **Cross-platform robustness:** Handles Windows (bash detection) + Linux (EAS native)
4. **Graceful degradation:** Optional vars missing = features disabled, not app crash
5. **Monorepo-aware:** Hook doesn't pollute pnpm lifecycle globally
6. **SPP-native integration:** NDK build runs after pnpm install; output goes directly to jniLibs ✅

### Potential Issues in Production
1. **Network timeout during Doppler download:** Script uses `curl -fsSL` (fails fast) but no retry logic
   - *Mitigation:* EAS can retry failed builds; single transient failure unlikely in practice
   
2. **Git fetch for SPP vendor (when pool-ops enabled):** Downloads full sparse checkout on every build
   - *Mitigation:* Pinned to exact commit; cached on EAS builder between builds
   
3. **NDK version compatibility:** Script searches for latest NDK under ANDROID_HOME/ndk
   - *Mitigation:* EAS provides consistent NDK version; rarely mismatches
   
4. **Disk space (pool-ops):** Warns if < 2GB available; Wasmer+WASM can exceed that
   - *Mitigation:* EAS builders generally have 4-8GB; manual fallback to derive-only build

---

## Recommendations by Priority

### 🔴 Critical (Do Immediately)
None — workflow is operational and production-ready.

### 🟡 High (Do Before Next Release)
1. **Implement Finding #2** (add .env existence check) — prevents confusing Metro errors
2. **Implement Finding #3** (validate important vars) — ensures crash reporting configured

### 🟢 Medium (Do This Sprint)
3. **Implement Finding #1** (token validation) — improves developer experience
4. **Implement Finding #4** (document override) — knowledge base update

---

## Testing Strategy

### Unit Tests (Already in Place)
- ✅ envValidation.ts validates all 4 var types (critical/important/optional)
- ✅ App.tsx blocks on critical vars; allows optional degradation

### Integration Tests (Recommended)
1. **Token validation:** Mock invalid DOPPLER_TOKEN and verify error message
2. **.env injection:** Verify `.env` file populated with correct variable count
3. **Secret filtering:** Verify non-EXPO_PUBLIC_* vars stripped from `.env`
4. **SPP native:** Verify `libspp_native.so` appears in jniLibs after build

### Manual Testing (Per Release)
```bash
# 1. Local build with valid secrets
doppler run --project veilpay --config prd -- eas build --platform android --profile preview --local

# 2. EAS cloud build (with DOPPLER_TOKEN EAS Secret)
eas build --platform android --profile preview

# 3. Verify APK contains correct secrets inlined
# (Extract APK, inspect Metro bundle for EXPO_PUBLIC_* values)
```

---

## Maintenance Checklist

- [ ] **Monthly:** Verify Doppler CLI version resolution still works (GitHub releases API)
- [ ] **Quarterly:** Review NDK/Rust/cargo-ndk version compatibility
- [ ] **On Doppler account changes:** Update DOPPLER_TOKEN EAS Secret
- [ ] **On env var changes:** Update both `install-doppler.sh` (required vars list) and `envValidation.ts` (app startup check)
- [ ] **On pool-ops changes:** Review Wasmer build resource requirements
- [ ] **On GitHub rate limiting:** Consider caching Doppler CLI version locally

---

## Conclusion

The Veilpay Consumer App EAS preview Android APK build workflow with Doppler secret injection is **✅ operational and production-ready**. 

The workflow demonstrates strong engineering practices:
- Secure secret handling (EXPO_PUBLIC_* filtering)
- Comprehensive error diagnostics
- Graceful fallback behavior
- Cross-platform compatibility

Four minor findings have been documented with low-effort remediation steps. None block production deployment.

---

**Audit Documents:**
- `EAS_PREVIEW_ANDROID_BUILD_AUDIT.md` — Detailed technical audit
- `EAS_AUDIT_FINDINGS_IMPLEMENTATION.md` — Step-by-step implementation guide
- `EAS_AUDIT_EXECUTIVE_SUMMARY.md` — This document

**Next Steps:** Review findings, prioritize implementations, and schedule remediation work.
