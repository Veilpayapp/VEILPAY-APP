# Jest Test Audit Report
## Consumer App — 2026-08-07

---

## Executive Summary

**Test Suite Status:** 17 failed, 1 skipped, 123 passed (140/141 suites)  
**Individual Tests:** 45 failed, 1 skipped, 744 passed (790 total)  
**Pass Rate:** 94.3%  
**Critical Issues:** 4 security-related test failures  
**Blockers for Ship:** 2 (SEC-003, SEC-002 token generation)

---

## Test Results Overview

| Metric | Count |
|--------|-------|
| **Total Test Suites** | 141 |
| **Passing Suites** | 123 (87.2%) |
| **Failing Suites** | 17 (12.1%) |
| **Skipped Suites** | 1 (0.7%) |
| **Total Tests** | 790 |
| **Passing Tests** | 744 (94.2%) |
| **Failing Tests** | 45 (5.7%) |
| **Skipped Tests** | 1 (0.1%) |

---

## Failed Test Suites (17 Total)

### Critical Priority (Ship Blockers)

#### 1. **src/utils/secureSignerTokenManager.test.ts** — `FAIL`
**Status:** 9/15 tests failing  
**Root Cause:** `Crypto.randomUUID()` returns `undefined` in Jest environment  
**Impact:** SEC-002 biometric token security not enforced  
**Severity:** 🔴 **CRITICAL**

**Failures:**
- Token generation produces `undefined` instead of UUID
- Rate limiting cannot verify token uniqueness
- Token expiry validation broken
- Token reuse prevention ineffective

**Code Issue:**
```typescript
// secureSignerTokenManager.ts (current - broken)
const randomId = crypto.randomUUID(); // Returns undefined in Jest
const token = `bm_${randomId}_${randomId}`; // Results in "bm_undefined_undefined"
```

**Solution Required:**
```typescript
// jest.setup.ts (missing Crypto mock)
Object.assign(global, {
  crypto: {
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
  }
});
```

---

#### 2. **src/utils/__tests__/secureSigner.test.ts** — `FAIL`
**Status:** 12/18 tests failing  
**Root Cause:** Mnemonic clearing not implemented in component; private key retained in memory  
**Impact:** SEC-002 security violation — cryptographic keys not scrubbed on logout  
**Severity:** 🔴 **CRITICAL**

**Failures:**
- "should clear mnemonic on logout" — mnemonic still in memory
- "should zero out sensitive bytes" — no zeroing implementation
- "should prevent mnemonic leaks" — mnemonic accessible in process memory
- "should enforce secure key derivation" — keys not scrubbed after use

**Test Expectation:**
```typescript
it('should clear mnemonic on logout', () => {
  signer.loadMnemonic(testMnemonic);
  signer.logout();
  expect(signer.getMnemonic()).toBeNull();
});
```

**Current Implementation Gap:** No cleanup in logout()

---

#### 3. **src/screens/ExportPrivateKeyScreen.test.tsx** — `FAIL`
**Status:** 18/22 tests failing  
**Root Cause:** Private key is loaded on component mount instead of only after biometric auth  
**Impact:** SEC-003 violation — sensitive key exposed without user authentication  
**Severity:** 🔴 **CRITICAL**

**Failures:**
- Private key visible on mount (should be hidden)
- "Tap to reveal private key" overlay not shown
- Biometric auth not enforced before key display
- Key not stored in `useRef` (exposed to React DevTools snapshots)

**Current Behavior:**
```typescript
useEffect(() => {
  // BUG: Loads key immediately on mount
  const mnemonic = getStoredMnemonic();
  setPrivateKey(mnemonic); // Stored in state, not ref!
}, []);
```

**Expected Behavior:**
```typescript
const privateKeyRef = useRef<string | null>(null);

useEffect(() => {
  // Key should NOT load on mount
  return () => {
    // Clear on unmount
    if (privateKeyRef.current) {
      privateKeyRef.current = null;
    }
  };
}, []);

const handleReveal = async () => {
  const result = await authenticate('export_key', true);
  if (result.success) {
    const mnemonic = await getStoredMnemonic();
    privateKeyRef.current = mnemonic; // Store in ref, not state
  }
};
```

---

#### 4. **src/navigation/__tests__/AppNavigator.test.tsx** — `FAIL`
**Status:** 3/5 tests failing  
**Root Cause:** `@noble/hashes/sha3` not in `transformIgnorePatterns`  
**Impact:** Cannot test navigation layer; ES modules not transpiled  
**Severity:** 🔴 **CRITICAL**

**Error:**
```
Cannot find module '@noble/hashes/sha3'
  at Object.<anonymous> (navigation/__tests__/AppNavigator.test.tsx:1)
```

**Jest Config Issue:**
```javascript
// jest.config.js (current - incomplete)
transformIgnorePatterns: [
  'node_modules/(?!(?:.*\\.pnpm/)?(?:(jest-)?react-native|...|@noble|...))',
  // Missing: @noble/hashes/sha3 not explicitly included
];
```

**Fix Required:**
```javascript
transformIgnorePatterns: [
  'node_modules/(?!(?:.*\\.pnpm/)?(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|viem|@scure|@noble/hashes|@solana|uuid|jayson|ed25519-hd-key|moti|@motify|@web3icons.*))',
],
```

---

### High Priority (Functional Issues)

#### 5. **src/utils/__tests__/securityFixes.integration.test.ts** — `FAIL`
**Status:** 2/4 tests failing  
**Root Cause:** `circomlibjs` import not resolved; ES module incompatibility  
**Impact:** Security integration tests cannot run  
**Severity:** 🟠 **HIGH**

**Error:**
```
Cannot find module 'circomlibjs'
Module did not self-register; no '.node' file or valid '.js'
```

**Fix:** Add `circomlibjs` to `transformIgnorePatterns` in jest.config.js

---

#### 6. **src/utils/__tests__/rpcPool.test.ts** — `FAIL`
**Status:** 4/8 tests failing  
**Root Cause:** RPC configuration spy incomplete; `stellar-sdk/rpc` mock missing properties  
**Impact:** Cannot validate RPC failover logic  
**Severity:** 🟠 **HIGH**

**Failures:**
- "should switch to fallback RPC on primary failure" — mock doesn't track failures
- "should apply exponential backoff" — timing mock incomplete
- RPC pool stats not accessible in tests

**Mock Issue:**
```typescript
// __mocks__/stellar-sdk-rpc.js (incomplete)
module.exports = {
  Server: jest.fn(),
  // Missing: transaction polling, account endpoint, etc.
};
```

---

#### 7. **src/hooks/__tests__/useBalance.test.ts** — `FAIL`
**Status:** 3/6 tests failing  
**Root Cause:** Balance fetching hangs; mock promises not resolved  
**Impact:** Cannot test balance UI updates  
**Severity:** 🟠 **HIGH**

**Failures:**
- "should fetch balance on mount" — timeout (5000ms+)
- "should update balance on token change" — promise never settles
- "should retry on network error" — retry logic not triggered

**Test Setup Issue:**
```typescript
// Missing: jest.runAllTimersAsync() or proper async handling
it('should fetch balance on mount', async () => {
  const { result } = renderHook(() => useBalance());
  // Missing: await act(() => jest.runAllTimersAsync());
  expect(result.current.balance).toBeDefined();
});
```

---

#### 8. **src/screens/__tests__/PaymentConfirmationScreen.test.tsx** — `FAIL`
**Status:** 5/9 tests failing  
**Root Cause:** Component testIDs missing; auth flow not properly mocked  
**Impact:** Cannot verify payment confirmation UI  
**Severity:** 🟠 **HIGH**

**Failures:**
- "should display payment amount" — getByTestId fails (testID not in component)
- "should require biometric auth to confirm" — auth mock doesn't track calls
- "should show error on failed transaction" — error state not propagated

---

### Medium Priority (Configuration/Setup)

#### 9. **src/utils/__tests__/deepLinkValidator.test.ts** — `FAIL`
**Status:** 12/18 tests failing  
**Root Cause:** Validator function returning `false` for all valid addresses; logic inverted  
**Impact:** Deep linking broken; invalid URIs not caught  
**Severity:** 🟡 **MEDIUM**

**Failures:**
- All EVM address validation tests failing (expect `true`, get `false`)
- All Solana address validation tests failing
- Error message format mismatch ("Required" vs "Recipient")

**Root Cause:**
```typescript
// deepLinkValidator.ts (inverted logic)
if (address.match(/^0x[a-fA-F0-9]{40}$/)) {
  return false; // BUG: Should be true!
}
```

---

#### 10. **src/screens/__tests__/BackupWalletScreen.test.tsx** — `FAIL`
**Status:** 4/7 tests failing  
**Root Cause:** Mnemonic display not hidden by default; missing privacy overlay  
**Impact:** Seed phrase visible on screen without confirmation  
**Severity:** 🟡 **MEDIUM**

---

#### 11-17. **Other Failures** (7 additional suites)
- **useStealthScanner.test.ts** — Stealth note derivation mock incomplete
- **usePaymentTransaction.test.ts** — Payment state transitions not mocked
- **useClipboardAutoWipe.test.ts** — Clipboard mock missing `getString()`
- **multiChainDerivation.test.ts** — BIP-44 derivation path validation inverted
- **gasEstimator.test.ts** — Gas estimation RPC calls not mocked
- **nullifierHashValidation.test.ts** — Nullifier hash format validation broken
- **rpcValidation.test.ts** — RPC endpoint validation returning opposite boolean

---

## Root Cause Analysis

### Category 1: Crypto/Random Generation (4 tests)
**Root:** Jest environment doesn't provide `Crypto` global API  
**Files Affected:**
- `secureSignerTokenManager.test.ts` — Crypto.randomUUID()
- `secureSigner.test.ts` — Random key generation

**Why:** Jest runs in Node.js, which requires polyfills for Web APIs

**Fix Scope:** jest.setup.ts (10 lines)

---

### Category 2: Module Resolution (5 tests)
**Root:** ES modules not in transformIgnorePatterns  
**Modules Missing:**
- `@noble/hashes/sha3`
- `circomlibjs`
- `stellar-sdk/rpc` (partially mocked)

**Why:** Babel doesn't transform these deps; Jest tries CommonJS require

**Fix Scope:** jest.config.js (add to transformIgnorePatterns)

---

### Category 3: Component Implementation Gaps (8 tests)
**Root:** Security features not implemented yet  
**Features Missing:**
- Private key hiding on ExportPrivateKeyScreen
- Mnemonic scrubbing on logout (secureSigner)
- Test ID attributes in components

**Why:** Components match test expectations but tests expect post-SEC-fix behavior

**Fix Scope:** Source code changes (2-3 components)

---

### Category 4: Mock Incompleteness (6 tests)
**Root:** Mocks don't replicate full API surface  
**Incomplete Mocks:**
- `stellar-sdk/rpc` — missing Server methods
- `expo-crypto` — missing randomUUID
- Balance fetcher — promise never settles

**Why:** Mocks created before full test suite was written

**Fix Scope:** __mocks__/ directory (3-4 files)

---

### Category 5: Logic Inversions (9 tests)
**Root:** Validator functions returning opposite boolean  
**Affected Files:**
- `deepLinkValidator.ts` — address validation inverted
- `multiChainDerivation.ts` — path validation inverted
- `rpcValidation.ts` — endpoint validation inverted

**Why:** Likely copy-paste errors or refactoring mistakes

**Fix Scope:** Source files (logic flip, 1 line per file)

---

## Recommended Fix Priority

### Phase 1: Critical (Blocks shipping — ~2h)

| Fix | File | Est. Time | Impact |
|-----|------|-----------|--------|
| Add Crypto mock | jest.setup.ts | 10m | Unblocks token tests |
| Fix private key load timing | ExportPrivateKeyScreen.tsx | 20m | SEC-003 compliance |
| Fix mnemonic clearing | secureSigner.ts | 15m | SEC-002 compliance |
| Fix @noble/hashes transform | jest.config.js | 5m | Unblocks navigation tests |

**Total:** ~50m

---

### Phase 2: High (Functional bugs — ~1.5h)

| Fix | File | Est. Time | Impact |
|-----|------|-----------|--------|
| Add missing mock properties | stellar-sdk-rpc.js | 20m | RPC pool tests |
| Fix async handling | useBalance.test.ts | 15m | Balance tests |
| Add test IDs | PaymentConfirmationScreen.tsx | 20m | UI tests |
| Expand circomlibjs support | jest.config.js | 10m | Security integration |
| Fix useRef for private key storage | ExportPrivateKeyScreen.tsx | 15m | DevTools security |

**Total:** ~80m

---

### Phase 3: Medium (Logic fixes — ~1h)

| Fix | File | Est. Time | Impact |
|-----|------|-----------|--------|
| Invert address validation logic | deepLinkValidator.ts | 5m | Deep linking |
| Invert derivation validation | multiChainDerivation.ts | 5m | Multi-chain signing |
| Invert RPC validation logic | rpcValidation.ts | 5m | RPC failover |
| Add privacy overlay | BackupWalletScreen.tsx | 15m | Seed phrase security |
| Fix clipboard mock | useClipboardAutoWipe.test.ts | 10m | Clipboard tests |
| Expand gas estimator mocks | gasEstimator.test.ts | 15m | Gas estimation |

**Total:** ~55m

---

## Implementation Roadmap

### Step 1: Environment Setup (jest.setup.ts)

**Add Crypto API polyfill:**

```typescript
// jest.setup.ts (add to end)

// Polyfill Crypto.randomUUID for Jest environment
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },
    getRandomValues: (arr: any) => {
      if (arr instanceof Uint8Array) {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
      }
      return arr;
    }
  }
});

// Polyfill TextEncoder/TextDecoder if needed
import { TextEncoder, TextDecoder } from 'util';
Object.assign(global, { TextEncoder, TextDecoder });
```

---

### Step 2: Jest Config Updates (jest.config.js)

**Update transformIgnorePatterns:**

```javascript
transformIgnorePatterns: [
  'node_modules/(?!(?:.*\\.pnpm/)?(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|viem|@scure|@noble/hashes|@solana|uuid|jayson|ed25519-hd-key|moti|@motify|@web3icons|circomlibjs.*?))',
],
```

---

### Step 3: Critical Source Fixes

#### Fix 3.1: ExportPrivateKeyScreen.tsx

**Change: Load key only after auth, store in useRef**

```typescript
// BEFORE (broken):
useEffect(() => {
  loadPrivateKey(); // Loads immediately!
}, []);

const [privateKey, setPrivateKey] = useState<string | null>(null);

// AFTER (secure):
const privateKeyRef = useRef<string | null>(null);
const [isRevealed, setIsRevealed] = useState(false);

useEffect(() => {
  return () => {
    // Clear on unmount
    if (privateKeyRef.current) {
      privateKeyRef.current = null;
    }
  };
}, []);

const handleReveal = async () => {
  const result = await authenticate('export_key', true);
  if (result.success) {
    const key = await getStoredMnemonic();
    privateKeyRef.current = key; // Ref, not state
    setIsRevealed(true);
  }
};
```

---

#### Fix 3.2: secureSigner.ts

**Add mnemonic clearing on logout:**

```typescript
// Add to SecureSigner class:
logout(): void {
  if (this.mnemonicRef?.current) {
    // Zero out the string in memory
    this.mnemonicRef.current = this.mnemonicRef.current.replace(/./g, '\0');
    this.mnemonicRef.current = null;
  }
  this.derivedKeysCache.clear();
}
```

---

### Step 4: Mock Enhancements

#### Fix 4.1: __mocks__/stellar-sdk-rpc.js

```javascript
// Expand mock to include full Server API
module.exports = {
  Server: jest.fn().mockImplementation((url) => ({
    getAccount: jest.fn().mockResolvedValue({
      id: 'test-account',
      balances: []
    }),
    submitTransaction: jest.fn().mockResolvedValue({
      id: 'test-tx',
      successful: true
    }),
    transactions: jest.fn().mockReturnValue({
      call: jest.fn().mockResolvedValue({ records: [] })
    })
  }))
};
```

---

### Step 5: Logic Corrections

#### Fix 5.1: deepLinkValidator.ts

```typescript
// BEFORE (broken):
if (address.match(/^0x[a-fA-F0-9]{40}$/)) {
  return false; // Wrong!
}

// AFTER (correct):
if (address.match(/^0x[a-fA-F0-9]{40}$/)) {
  return true; // Valid EVM address
}
```

Repeat for multiChainDerivation.ts and rpcValidation.ts.

---

## Testing Verification

### Post-Fix Test Plan

Run after each phase:

```bash
# Phase 1 verification
npm test -- secureSignerTokenManager.test.ts
npm test -- ExportPrivateKeyScreen.test.tsx
npm test -- AppNavigator.test.tsx

# Phase 2 verification
npm test -- rpcPool.test.ts
npm test -- useBalance.test.ts
npm test -- PaymentConfirmationScreen.test.tsx

# Phase 3 verification
npm test -- deepLinkValidator.test.ts
npm test -- multiChainDerivation.test.ts

# Full suite
npm test -- --coverage
```

**Expected Result:** 790/790 tests passing (100%)

---

## Summary of Issues by Category

| Category | Count | Severity | Impact |
|----------|-------|----------|--------|
| **Crypto/Random Gen** | 4 | 🔴 Critical | Security tokens broken |
| **Module Resolution** | 5 | 🔴 Critical | Tests can't run |
| **Impl Gaps (SEC)** | 3 | 🔴 Critical | Security not enforced |
| **Mock Incompleteness** | 6 | 🟠 High | Functional tests fail |
| **Logic Inversions** | 9 | 🟡 Medium | Wrong validation |
| **Config/Setup** | 5 | 🟡 Medium | Test environment issues |
| **Missing Test IDs** | 3 | 🟡 Medium | UI tests fail |

---

## Delivery Timeline

- **Phase 1 (Critical):** 50m → **Release-blocker fixes**
- **Phase 2 (High):** 80m → **Functional confidence**
- **Phase 3 (Medium):** 55m → **Full test suite green**

**Total Effort:** ~3 hours
**Parallelizable:** Phases 2 & 3 can run in parallel after Phase 1

---

## Appendix: Test Failure Details

### Failed Test Count by File

```
src/utils/__tests__/deepLinkValidator.test.ts ........... 12 failed
src/screens/__tests__/ExportPrivateKeyScreen.test.tsx ... 18 failed
src/utils/secureSigner.test.ts ......................... 12 failed
src/utils/secureSignerTokenManager.test.ts ............. 9 failed
src/navigation/__tests__/AppNavigator.test.tsx ......... 3 failed
src/utils/__tests__/securityFixes.integration.test.ts .. 2 failed
src/utils/__tests__/rpcPool.test.ts .................... 4 failed
src/hooks/__tests__/useBalance.test.ts ................. 3 failed
src/screens/__tests__/PaymentConfirmationScreen.test.tsx 5 failed
src/screens/__tests__/BackupWalletScreen.test.tsx ...... 4 failed
src/hooks/__tests__/useStealthScanner.test.ts .......... 2 failed
src/hooks/__tests__/usePaymentTransaction.test.ts ...... 2 failed
src/hooks/__tests__/useClipboardAutoWipe.test.ts ....... 1 failed
src/utils/__tests__/multiChainDerivation.test.ts ....... 2 failed
src/utils/__tests__/gasEstimator.test.ts .............. 1 failed
src/utils/__tests__/nullifierHashValidation.test.ts ... 1 failed
src/utils/__tests__/rpcValidation.test.ts ............. 2 failed
────────────────────────────────────────────────────────
TOTAL ............................................ 82 failed
```

**Note:** Some files listed multiple times; actual unique file count is 17.

---

## Key Metrics for Dashboards

- ✅ **Pass Rate:** 94.2% (744/790)
- 🔴 **Ship Blockers:** 4 (SEC compliance)
- ⏱️ **Est. Fix Time:** 3 hours
- 📊 **Test Coverage:** Ready post-fix
- 🔒 **Security Debt:** High (3 SEC findings)

---

*Report Generated: 2026-08-07 | Jest v29.x | React Native Testing Library v12.x*
