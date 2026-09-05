# EAS Preview Build Audit — Implementation Guide for Findings

This document provides step-by-step remediation for the 4 findings from the comprehensive audit.

---

## Finding #1: Add Explicit Doppler Token Validation

### Current State
Token is checked for existence but not validity. If DOPPLER_TOKEN is set but expired/invalid, build fails during `doppler secrets download` with a Doppler error message (not EAS-specific).

### Solution
Add token validation immediately after Doppler CLI is installed.

**File:** `apps/consumer-app/eas-hooks/install-doppler.sh`

**Insert after line 91** (after "Doppler CLI already installed" message):

```bash
# ── Validate Doppler token ──────────────────────────────────────────────
echo "[doppler-hook] Validating Doppler token..."

if ! doppler projects --token="$DOPPLER_TOKEN" >/dev/null 2>&1; then
  echo "[doppler-hook] ERROR: DOPPLER_TOKEN is invalid, expired, or lacks permissions"
  echo "[doppler-hook] Please create a new service token and update EAS Secret:"
  echo "[doppler-hook]   eas secret:update --scope project --name DOPPLER_TOKEN"
  exit 1
fi

echo "[doppler-hook] ✓ Token validated"
```

### Impact
- ✅ Clearer error message (not Doppler CLI error)
- ✅ Faster feedback (validate before attempting download)
- ⚠️ Adds ~1 second to build time (one extra API call)

### Testing
```bash
# Test with invalid token
export DOPPLER_TOKEN="dp_invalid_xyz"
bash eas-hooks/install-doppler.sh
# Expected: "ERROR: DOPPLER_TOKEN is invalid, expired, or lacks permissions"
```

---

## Finding #2: Add .env Existence Check Before Metro

### Current State
If Doppler hook runs but produces an empty `.env` (due to network error or misconfiguration), Metro still starts and fails with a confusing bundle error instead of a clear "missing secrets" message.

### Solution A: Add Check in Pre-Install Hook (Recommended)

**File:** `apps/consumer-app/eas-hooks/install-doppler.sh`

**Insert at end (after line 153, before final exit 0):**

```bash
# ── Final validation ────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ] || [ ! -s "$ENV_FILE" ]; then
  echo "[doppler-hook] ERROR: .env file is missing or empty after secret injection"
  echo "[doppler-hook] Aborting build to prevent Metro bundle failure"
  exit 1
fi

echo "[doppler-hook] ✓ .env file is present and non-empty ($(wc -l < "$ENV_FILE") vars)"
```

### Solution B: Add Explicit EAS Hook (Alternative)

Create a new file `apps/consumer-app/eas-hooks/verify-secrets.sh`:

```bash
#!/usr/bin/env bash
set -e

if [ ! -f ".env" ] || [ ! -s ".env" ]; then
  echo "[verify-secrets] ERROR: .env file missing or empty"
  echo "[verify-secrets] Pre-install hook failed to inject secrets"
  exit 1
fi

VAR_COUNT=$(grep -c . ".env" || true)
echo "[verify-secrets] ✓ .env verified ($VAR_COUNT variables)"
```

Then register in `package.json`:
```json
{
  "scripts": {
    "eas-build-pre-install": "node eas-hooks/inject-secrets.js && bash eas-hooks/verify-secrets.sh"
  }
}
```

### Recommended: Solution A (simpler, no new file)

### Impact
- ✅ Clear error before Metro bundling
- ✅ Prevents confusing "undefined variable" errors in Metro
- ✅ No performance impact

### Testing
```bash
# Manually remove .env and test
rm -f .env
bash eas-hooks/install-doppler.sh
# Expected: "ERROR: .env file is missing or empty after secret injection"
```

---

## Finding #3: Validate Optional But Important Variables

### Current State
Only 2 of 4 important variables are validated:
- ✅ EXPO_PUBLIC_BACKEND_BASE_URL (critical)
- ✅ EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID (important)
- ❌ EXPO_PUBLIC_SENTRY_DSN (important, not validated)
- ❌ EXPO_PUBLIC_EAS_PROJECT_ID (important, not validated)

### Solution
Extend the required vars check to include Sentry DSN (most important for crash reporting).

**File:** `apps/consumer-app/eas-hooks/install-doppler.sh`

**Replace lines 128–147** with:

```bash
# Verify the critical vars are present — fail the build if any are missing.
# For optional vars (MIXPANEL), warnings are logged but build continues.
REQUIRED_VARS=(
  "EXPO_PUBLIC_BACKEND_BASE_URL"
  "EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID"
)

# Important but non-blocking vars (log warnings if missing)
IMPORTANT_VARS=(
  "EXPO_PUBLIC_SENTRY_DSN"
  "EXPO_PUBLIC_EAS_PROJECT_ID"
)

MISSING_CRITICAL=()
MISSING_IMPORTANT=()

for VAR in "${REQUIRED_VARS[@]}"; do
  if ! grep -q "^${VAR}=" "$ENV_FILE" || grep -q "^${VAR}=\"\"\$" "$ENV_FILE"; then
    MISSING_CRITICAL+=("$VAR")
  fi
done

for VAR in "${IMPORTANT_VARS[@]}"; do
  if ! grep -q "^${VAR}=" "$ENV_FILE" || grep -q "^${VAR}=\"\"\$" "$ENV_FILE"; then
    MISSING_IMPORTANT+=("$VAR")
  fi
done

if [ ${#MISSING_CRITICAL[@]} -gt 0 ]; then
  echo "[doppler-hook] ERROR: Required secrets missing from Doppler:"
  for m in "${MISSING_CRITICAL[@]}"; do
    echo "  - $m"
  done
  echo "[doppler-hook] Add them to your Doppler project ($DOPPLER_PROJECT / $DOPPLER_CONFIG)."
  exit 1
fi

if [ ${#MISSING_IMPORTANT[@]} -gt 0 ]; then
  echo "[doppler-hook] WARNING: Important secrets missing (build will continue):"
  for m in "${MISSING_IMPORTANT[@]}"; do
    echo "  - $m (will impact feature)"
  done
fi
```

### Impact
- ✅ Warns about missing Sentry (crash reporting won't work)
- ✅ Warns about missing EAS Project ID (OTA updates won't work)
- ⚠️ Build continues (features degrade gracefully)
- ✅ Matches app-level behavior (App.tsx only blocks on critical vars)

### Testing
```bash
# Remove SENTRY_DSN from Doppler temporarily and test
# Expected: build succeeds with warning about missing SENTRY_DSN
```

---

## Finding #4: Document Doppler Project/Config Override

### Current State
The install-doppler.sh script supports overriding Doppler project and config via env vars, but this is undocumented.

**Current code (lines 95–96):**
```bash
DOPPLER_PROJECT="${DOPPLER_PROJECT:-veilpay}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"
```

### Solution
Add documentation to ENV_SETUP.md and inline comments.

**File:** `apps/consumer-app/ENV_SETUP.md` (create if missing)

Add section:

```markdown
## Advanced: Doppler Project/Config Override

By default, secrets are pulled from:
- **Project:** `veilpay`
- **Config:** `prd`

To override (e.g., for testing with staging secrets):

### Local Build
```bash
export DOPPLER_PROJECT=veilpay
export DOPPLER_CONFIG=stg  # Use staging config instead of prd
doppler run -- eas build --platform android --profile preview --local
```

### EAS Cloud Build
```bash
eas build --platform android --profile preview \
  --env DOPPLER_PROJECT=veilpay \
  --env DOPPLER_CONFIG=stg
```

### CI/CD
```bash
DOPPLER_PROJECT=veilpay DOPPLER_CONFIG=stg pnpm eas:preview:android:ci
```

**Note:** The Doppler token (DOPPLER_TOKEN) must have read access to both the base project and config.
```

**File:** `apps/consumer-app/eas-hooks/install-doppler.sh`

Add inline comment (line 93):

```bash
# Which Doppler project + config to pull from.
# Override via environment variables if pulling from a different Doppler project/config:
#
#   DOPPLER_PROJECT=veilpay DOPPLER_CONFIG=stg eas build --local
#
# This allows staging/testing builds to use separate secret configs while
# reusing the same token. The token must have read access to the target config.
DOPPLER_PROJECT="${DOPPLER_PROJECT:-veilpay}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"
```

### Impact
- ✅ Enables switching between prd/stg configs for testing
- ✅ No code changes required (feature already exists)
- ✅ Documentation only

---

## Summary of Changes

| Finding | File | Change | Effort | Risk |
|---------|------|--------|--------|------|
| #1 | install-doppler.sh | Add token validation | ~5 lines | Low |
| #2 | install-doppler.sh | Add .env existence check | ~4 lines | Low |
| #3 | install-doppler.sh | Extend var validation | ~25 lines | Low |
| #4 | ENV_SETUP.md + inline | Document override | ~20 lines | None |

### Implementation Priority

1. **High Priority (do first):**
   - Finding #2: Add .env existence check → prevents confusing Metro errors
   - Finding #3: Validate important vars → ensures crash reporting works

2. **Medium Priority (do next):**
   - Finding #1: Token validation → improves DX

3. **Low Priority (documentation only):**
   - Finding #4: Document override → knowledge base

### Testing Checklist

After implementing all findings:

```bash
# 1. Local build with valid secrets
doppler run --project veilpay --config prd -- eas build --platform android --profile preview --local

# 2. Simulate missing DOPPLER_TOKEN
unset DOPPLER_TOKEN
eas build --platform android --profile preview --local  # Should fail at env validation

# 3. Simulate expired token (if you have a test token)
export DOPPLER_TOKEN="dp_invalid_xyz"
eas build --platform android --profile preview --local --non-interactive  # Should fail with clear message

# 4. Verify build logs contain validation checkpoints
# Expected log lines:
#   "[doppler-hook] ✓ Token validated"
#   "[doppler-hook] ✓ .env file is present and non-empty (X vars)"
#   "[doppler-hook] Successfully injected secrets from Doppler into .env"
```

---

## FAQ

**Q: Will these changes break existing builds?**
A: No. All changes are additive (new validations only). Existing successful workflows remain unchanged.

**Q: Do I need to update EAS Secrets?**
A: No. DOPPLER_TOKEN and other EAS Secrets require no changes.

**Q: Should I implement all 4 findings?**
A: Yes. Findings #1–3 improve robustness. Finding #4 is documentation (no code risk).

**Q: What if my Doppler config doesn't have all vars?**
A: With Finding #3, the build warns but continues. App startup (App.tsx) will show a user-friendly error.

---

**End of Implementation Guide**
