# Veilpay Security Specification

> **Status:** Active Development | **Last Updated:** 2026-05-12  
> **Audits:** Pending (see [Security Roadmap](#security-roadmap))

---

## 1. Threat Model

### 1.1 Assumed Threats

| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|-----------|
| Phishing (fake dApp URLs) | High | Critical | URL verification + homoglyph detection |
| Malware (keylogger, clipboard hijack) | Medium | Critical | FLAG_SECURE, hardware wallet support |
| Root/Jailbreak (device compromise) | Medium | High | SafetyNet / DeviceCheck, hard refusal |
| Screen recording (shoulder-surfing) | Medium | High | Anti-screenshot flags, auto-hide |
| Social Engineering (seed phrase theft) | High | Critical | SSKR, anti-screenshot, biometric gates |
| MITM (network-level) | Low | Critical | SSL pinning, cert pinning (TBD) |

### 1.2 Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                    USER DEVICE                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐│
│  │   Biometric │  │  Secure     │  │  Hardware       ││
│  │   Auth      │──│  Storage    │──│  Wallet         ││
│  └─────────────┘  └─────┬───────┘  └─────────────────┘│
│                         │                               │
│  ┌─────────────┐  ┌──────┴──────┐                     │
│  │   Mnemo-    │  │  Derived    │                     │
│  │   nic       │──│  Private    │                     │
│  │   (memory)   │  │  Key        │                     │
│  └─────────────┘  └─────────────┘                     │
│                        │                                │
│                        ▼                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │         BLOCKCHAIN / RPC NETWORK                 │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Security Checklist (Production Readiness)

This checklist is derived from `getSecurityAuditChecklist()` in `src/utils/security.ts`.

### 2.1 Cryptography

```text
AUD-001   CRITICAL  Mnemonic generation uses cryptographically secure RNG
AUD-005   HIGH      Shamir Secret Sharing (SSKR) implementation verified
AUD-012   CRITICAL  Transaction signing includes chain ID replay protection (EIP-155)
```

### 2.2 Key Management

```text
AUD-002   CRITICAL  Mnemonic is never logged, serialized, or returned to the UI
AUD-003   CRITICAL  Private keys are derived and used within a closure
AUD-004   CRITICAL  Secure storage uses platform-specific keychain/keystore
AUD-014   HIGH      Biometric authentication gates critical operations
AUD-011   HIGH      Hardware wallet support (Ledger/Trezor)
```

### 2.3 UI Security

```text
AUD-006   HIGH      Anti-screenshot flags (FLAG_SECURE) on seed/private key screens
AUD-010   MEDIUM    Homoglyph attack detection in URL verification
```

### 2.4 Network & Infrastructure

```text
AUD-008   HIGH      All RPC endpoints use HTTPS
AUD-009   HIGH      Deep link URLs are validated against allowlists
AUD-013   HIGH      Certificate pinning for all API calls
```

### 2.5 Device Integrity

```text
AUD-007   HIGH      SafetyNet / Play Integrity (Android) + DeviceCheck (iOS)
```

---

## 3. Platform-Specific Security

### 3.1 Android

```
┌─────────────────────────────────────────┐
│           ANDROID SECURITY               │
├─────────────────────────────────────────┤
│  FLAG_SECURE (WindowManager)            │
│    ├── Prevents screenshots in recents  │
│    ├── Prevents screen recording        │
│    └── Applied via: VeilpaySecureWindow │
│                                         │
│  SafetyNet / Play Integrity              │
│    ├── Verifies device integrity         │
│    ├── Checks for root / tampering       │
│    └── STUB: Requires native module    │
│                                         │
│  Certificate Pinning                      │
│    ├── Pins to known RPC certificates   │
│    └── STUB: Pending implementation     │
└─────────────────────────────────────────┘
```

### 3.2 iOS

```
┌─────────────────────────────────────────┐
│              iOS SECURITY                │
├─────────────────────────────────────────┤
│  Anti-Screenshot                        │
│    ├── iOS has no public FLAG_SECURE    │
│    ├── Alternative: UITextField.secure  │
│    └── Best: RASP (Runtime Self-Prot)  │
│                                         │
│  DeviceCheck / App Attest                │
│    ├── Verifies device integrity         │
│    ├── Checks for jailbreak              │
│    └── STUB: Requires native module    │
│                                         │
│  Keychain Access                          │
│    ├── WHEN_UNLOCKED_THIS_DEVICE_ONLY   │
│    └── Prevents iCloud backup of keys   │
└─────────────────────────────────────────┘
```

---

## 4. Security Roadmap

### Immediate (This Sprint)

- [x] Anti-screenshot flags (`FLAG_SECURE`) on seed phrase screens
- [x] Phishing-resistant URL verification with homoglyph detection
- [x] SSKR (Shamir Secret Sharing) for seed backup
- [x] Device security check framework (SafetyNet/DeviceCheck)
- [x] Hardware wallet transport foundation (Ledger/Trezor)

### Short-Term (Next 2 Sprints)

- [ ] **Professional Audit** — Trail of Bits, OpenZeppelin, or equivalent
- [ ] **Native SafetyNet/Play Integrity** — Android native module
- [ ] **Native DeviceCheck/App Attest** — iOS native module
- [ ] **Certificate Pinning** — AWS/Gateway SSL pinning
- [ ] **Hardware Wallet BLE Integration** — Ledger Nano X / Stax

### Medium-Term (Q3 2026)

- [ ] **Hardware Wallet USB Integration** — Ledger Nano S/S+, Trezor
- [ ] **RASP (Runtime Application Self-Protection)** — iOS screenshot prevention
- [ ] **Deep Link URL Verification** — Full dApp registry with visual indicators
- [ ] **Social Recovery** — Multi-party computation (MPC) for key recovery

### Long-Term (Q4 2026+)

- [ ] **Formal Verification** — Prove correctness of signing closure
- [ ] **Bug Bounty Program** — Public disclosure program
- [ ] **SOC 2 Compliance** — For backend infrastructure

---

## 5. Reporting Security Issues

If you discover a security vulnerability, please do NOT open a public issue. Instead:

1. Email: `security@veilpay.app`
2. Subject: `[SECURITY] Brief description`
3. Include:
   - A clear description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We aim to respond within 48 hours and will coordinate disclosure.

---

## 6. Accepted Transitive Advisories

Some `pnpm audit` advisories surface against deep transitive dependencies that
have no patched upstream version. Each entry below documents the advisory,
the exposure path, the realistic exploit surface, and the compensating
control we apply. These advisories are tracked in
`plans/PRODUCTION_READINESS_AUDIT.md` and reviewed every release.

### 6.1 `bigint-buffer@<=1.1.5` (CVE-2025-3194, GHSA-3gc7-fjrx-p6mg)

- **Severity:** High (CVSS 7.5)
- **Path:** `apps/consumer-app > @solana/spl-token > @solana/buffer-layout-utils > bigint-buffer`
- **Vulnerability:** Buffer overflow in `toBigIntLE()` when input exceeds
  the expected length. Triggers a process panic.
- **Patched version:** None available upstream.
- **Exposure:** Reached only when the consumer app reads SPL token mint /
  account metadata returned by an RPC. An attacker would need to control
  the RPC response payload (or insert a man-in-the-middle proxy that
  rewrites valid responses).
- **Compensating controls:**
  - Consumer-app RPC endpoints are pinned to operator-controlled
    providers in production (see `apps/consumer-app/src/config/chains.ts`).
  - Token-account reads are wrapped in a try/catch that surfaces a
    user-visible error rather than crashing the worklet.
  - SPL token decoding is read-only; a panic does not affect signing or
    settlement state.
- **Re-evaluation trigger:** when `@solana/buffer-layout-utils` ships a
  release with a patched `bigint-buffer` (or a maintained fork), bump
  the override and remove this exception.

### 6.2 `elliptic@<=6.6.1` (CVE-2025-14505, GHSA-848j-6mx2-7j84)

- **Severity:** Low (CVSS 5.6)
- **Path:** `packages/circuits > circomlibjs > ethers@5 > @ethersproject/signing-key > elliptic`
- **Vulnerability:** ECDSA implementation produces incorrect signatures when
  an interim `k` value has leading zeros, in pathological inputs.
- **Patched version:** None available upstream.
- **Exposure:** None at runtime. `circomlibjs` is consumed only at
  circuit-compilation time (`packages/circuits/compile.sh`), not by any
  signing path in the apps. The `@ethersproject/signing-key` is not
  invoked from VeilPay code.
- **Compensating controls:** none required — the vulnerable code path
  is not reachable from any deployed binary.
- **Re-evaluation trigger:** when `circomlibjs` upgrades its `ethers`
  dependency to v6, the chain falls away and this exception can be
  removed.

---

## 7. References

- [OWASP Mobile Security](https://owasp.org/www-project-mobile-security/)
- [Google SafetyNet / Play Integrity](https://developer.android.com/google/playintegrity/overview)
- [Apple DeviceCheck / App Attest](https://developer.apple.com/documentation/devicecheck)
- [Ledger Hardware Wallets](https://www.ledger.com/)
- [Trezor Hardware Wallets](https://trezor.io/)

---

*This document is a living specification. All security features are subject to professional audit before production deployment.*
