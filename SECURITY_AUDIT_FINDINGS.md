# Veilpay Consumer App: Security Audit Findings & Remediation Plan

**Date:** August 5, 2026  
**Audit Scope:** apps/consumer-app/ (React Native Android)  
**Model:** Fable 5 + Opus 5 Subagents  
**Status:** In Progress (Fixes being applied in parallel)

---

## Executive Summary

The Veilpay consumer app demonstrates **strong foundational security architecture** but requires immediate fixes before production:

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 3 | **In Progress** |
| 🟠 High | 6 | **In Progress** |
| 🟡 Medium | 8 | **In Progress** |
| 🟢 Low | 5 | **Backlog** |

**Critical Path:** All critical + high findings must be fixed before production deployment.

---

## Critical Findings (Ship Before Production)

### SEC-001: Mnemonic Phrase Held as Plaintext in Memory
- **File:** `secureSigner.ts:109`
- **Risk:** Private key material exposed during long-running signing operations
- **Remediation:** [Team 1 working]
  - Replace string concatenation with secure buffer
  - Implement memory wiping utility
  - Add tests for memory cleanup on scope exit

### SEC-002: Biometric Token Predictability & No Rate Limiting
- **File:** `secureSigner.ts:36-56`
- **Risk:** Weak token generation, no rate limiting on auth attempts
- **Remediation:** [Team 1 working]
  - Add cryptographically strong token generation
  - Implement per-user rate limiting (max 1 token/30s)
  - Add audit logging of failed validation attempts

### SEC-003: Private Key Loaded Before Biometric Auth
- **File:** `ExportPrivateKeyScreen.tsx:42-56`
- **Risk:** Private key in React state even if user cancels auth
- **Remediation:** [Team 1 working]
  - Defer key derivation to post-auth flow
  - Clear state on component unmount
  - Use Ref instead of state to avoid React snapshots

---

## High Priority Findings (Ship Before Mainnet)

### SEC-004: No Validation That Nullifier Hash Matches Poseidon(nullifier)
- **File:** `commitmentStore.ts` (withdrawal flow)
- **Risk:** Semantic validation bypass; proof-valid but contract-rejected
- **Remediation:** [Team 2 working]
  - Always recompute nullifierHash client-side
  - Assert match before proof generation
  - Add test with corrupted hash

### SEC-005: RPC Endpoint Fallback to Public Nodes Without Pinning
- **File:** `rpc.ts:15-30`
- **Risk:** MitM attacks if backend misconfigured
- **Remediation:** [Team 2 working]
  - Fail hard in production if no backend RPC configured
  - Pin public RPC endpoints if fallback must be supported
  - Validate all RPC responses include correct chain ID

### SEC-008: No Chain ID Validation on RPC Responses
- **File:** `rpcPool.ts`, `transactions.ts`
- **Risk:** Cross-chain transaction forgery
- **Remediation:** [Team 2 working]
  - Add Zod schema validation for chainId in responses
  - Maintain request/response correlation with IDs
  - Test cross-chain injection scenarios

### SEC-009: Sentry Error Reporting May Leak Sensitive Context
- **File:** `sentry.ts`, `secureSigner.ts:190`, `secureStateStorage.ts:79`
- **Risk:** Mnemonics, private keys, addresses leaked to error service
- **Remediation:** [Team 3 working]
  - Whitelist safe context keys
  - Deny-list sensitive fields
  - Redact hex strings and field-like values

### SEC-011: Clipboard Data Not Explicitly Cleared
- **File:** `ExportPrivateKeyScreen.tsx`, `BackupWalletScreen.tsx`
- **Risk:** Clipboard persists; accessible to malicious apps
- **Remediation:** [Team 3 working]
  - Auto-clear clipboard after 30s
  - Show countdown timer
  - Add manual "Clear Clipboard" button

### SEC-012: Missing Input Validation on Deep-Link Recipients
- **File:** `deepLinking.ts`
- **Risk:** Invalid addresses cause crashes; no rate limiting
- **Remediation:** [Team 3 working]
  - Validate recipient: EVM checksum, Stellar public key format
  - Validate amount: positive, within balance
  - Rate limit: 1 payment per 5 seconds

---

## Medium Priority Findings

| ID | Title | File | Remediation |
|---|---|---|---|
| SEC-006 | SPP Pool Operations Gate Missing Enforcement | sppClient.ts | Add hard check before SPP operations |
| SEC-007 | Incomplete Merkle Path Capture (DATA-002) | commitmentStore.ts | Implement deposit-time capture or disable feature |
| SEC-010 | No Rate Limiting on Proof Generation | ZkpProver.tsx | Add 10s cooldown between proofs |
| SEC-013 | No Timeout on Proof Generation | ZkpProver.tsx | 60s timeout for proof, 30s for artifacts |
| SEC-014 | Unnecessary Android Permissions | AndroidManifest.xml | Remove RECORD_AUDIO, SYSTEM_ALERT_WINDOW |
| SEC-015 | Proving Key Not Integrity-Checked | ZkpProver.tsx | Add SRI validation for CDN artifacts |
| SEC-016 | No Validation of SPP Account State | sppAccountStore.ts | Add Zod schema validation |
| SEC-017 | Dependency Audit Findings Not Addressed | pnpm-lock.yaml | Document accepted risks, patch where possible |

---

## Remediation Teams

### Team 1 (ac6c9fcbced21ac00) — Key Management & Auth
**Findings:** SEC-001, SEC-002, SEC-003  
**Status:** Working  
**Deliverables:**
- Secure mnemonic buffer handling
- Biometric token hardening with rate limiting
- Private key loading deferred to post-auth

### Team 2 (accfa76c65b8036b6) — RPC & Cryptography
**Findings:** SEC-005, SEC-008, SEC-004  
**Status:** Working  
**Deliverables:**
- RPC endpoint validation & pinning
- Chain ID verification
- Nullifier hash assertion

### Team 3 (a0000329249fe0b40) — Data Handling & Input Validation
**Findings:** SEC-009, SEC-011, SEC-012  
**Status:** Working  
**Deliverables:**
- Sentry context sanitization
- Clipboard auto-clear with timer
- Deep-link validation & rate limiting

---

## Verification Plan

After each team completes:
1. ✅ Code review for correctness
2. ✅ Test coverage validation (unit + integration)
3. ✅ Merge to feature branch
4. ✅ Integration testing across all three teams' changes
5. ✅ Security re-verification

---

## Production Checklist

Before shipping:
- [ ] All critical findings fixed
- [ ] All high findings fixed
- [ ] Test coverage > 90% for security-critical paths
- [ ] Dependency audit findings documented & accepted
- [ ] External security audit completed (if applicable)
- [ ] Mainnet feature flags all set to false (MAINNET_SPP_ENABLED, etc.)
- [ ] RPC endpoints pinned for production
- [ ] Sentry environment configured for production filtering
- [ ] Certificate pinning validated in release build

---

**Next Steps:** Await team notifications. Review code. Merge fixes.
