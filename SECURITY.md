# VeilPay Security

> **Status:** Active development · Last updated: 2026-07-17  
> **External audits:** Pending (see [Ceremony & audit gates](docs/security/ceremony-and-audit-gates.md))

This document is the **security policy and threat overview** for the monorepo. Deeper product checklists live under [`docs/security/`](docs/security/).

---

## 1. Reporting vulnerabilities

Do **not** open a public GitHub issue for security bugs.

1. Email: `security@veilpay.app`
2. Subject: `[SECURITY] <short title>`
3. Include: description, repro steps, impact, and a suggested fix if you have one

We aim to acknowledge within **48 hours** and coordinate disclosure.

---

## 2. What must never be committed or logged

- Mnemonics, private keys, raw signatures, session secrets
- `.env` files with real credentials (use `.env.example` only)
- Production Groth16 toxic waste / contributor randomness
- User nullifier / secret note preimages

App and agent rules: never print or persist secrets. See `apps/consumer-app` SecureStore usage for commitment notes.

---

## 3. Threat model (summary)

### 3.1 Client / wallet

| Threat | Impact | Mitigations |
|--------|--------|-------------|
| Phishing / fake app | Critical | Store listing, deep-link allowlists, URL checks |
| Device compromise | Critical | SecureStore / Keychain, biometrics, FLAG_SECURE where available |
| Clipboard / screen capture of seed | Critical | Anti-screenshot on sensitive screens, no seed in logs |
| Malicious RPC | High | Operator-pinned RPCs in production; validate chain IDs |

### 3.2 Backend / merchant API

| Threat | Impact | Mitigations |
|--------|--------|-------------|
| API key abuse | High | Hashed keys, rate limits, auth middleware |
| Webhook forgery | High | Signature + timestamp windows ([webhook security](docs/security/webhook-security.md)) |
| Relayer drain / wrong pool | High | Contract allowlist; relayer never learns nullifier/secret |
| Injection / SSRF | High | Zod validation, URL safety helpers |

### 3.3 Privacy pool (EVM ZK)

| Threat | Impact | Mitigations |
|--------|--------|-------------|
| Overstated withdraw amount / wrong token | Critical | Note binds `amount` + `token`: `Poseidon(nullifier, secret, amount, token)`; deposit circuit proves leaf opens to transferred value |
| Double-spend | Critical | `nullifierSpent` mapping; nullifierHash = Poseidon(nullifier) |
| Public-input congruence (`x + r`) | High | Pool rejects any public input ≥ BN254 scalar field `r` |
| Forged Groth16 proofs | Critical | **Requires real multi-party ceremony** — current `compile.sh` keys are **dev-only** |
| Stolen note (nullifier+secret) | High | Device security; any holder can set recipient (by design) |
| Malicious ERC-20 | Medium | Prefer allowlisted tokens; fee-on-transfer unsupported |

Full circuit detail: [`packages/circuits/docs/CIRCUIT_SECURITY.md`](packages/circuits/docs/CIRCUIT_SECURITY.md).

Canonical commitment:

```text
commitment    = Poseidon(nullifier, secret, amount, token)
nullifierHash = Poseidon(nullifier)
```

Withdraw public inputs (order is load-bearing for verifier + `VeilPool`):

```text
[merkleRoot, nullifierHash, recipient, amount, token]
```

Deposit public inputs:

```text
[commitment, amount, token]
```

### 3.4 Stellar Private Payments (SPP)

- Testnet-oriented; **fail-closed on mainnet** until product + audit gates pass.
- Native pool ops required for shield/transfer/unshield; derive-only builds must not expose Private mode as ready.

---

## 4. Production gates (must pass before “mainnet privacy”)

| ID | Gate | Blocks |
|----|------|--------|
| **SEC-008** | Trusted setup / ceremony | Mainnet deploy of Groth16 verifiers / proving keys |
| **SEC-011** | External security audit | Claims of “audited” / mainnet-ready privacy |

Details and checklists: [`docs/security/ceremony-and-audit-gates.md`](docs/security/ceremony-and-audit-gates.md).

Also:

- [Production checklist](docs/security/production-checklist.md)
- [Secrets & keys](docs/security/secrets-and-keys.md)
- [API hardening](docs/security/api-hardening.md)
- [Security model](docs/security/security-model.md)

---

## 5. Client security checklist (wallet)

Derived from product audit IDs used in the consumer app:

### Cryptography & keys

- [x] Mnemonic generation uses CSPRNG
- [x] Mnemonics / keys never logged or returned casually to UI layers
- [x] Secure storage via platform keychain / keystore
- [x] EIP-155-style chain binding for EVM signing
- [ ] Hardware wallet (Ledger/Trezor) production path complete

### UI & device

- [x] Anti-screenshot on seed / private-key surfaces where platform allows
- [x] Homoglyph / URL checks for risky links
- [ ] Play Integrity / DeviceCheck fully wired in production builds

### Network

- [x] HTTPS RPC and API endpoints in production config
- [x] Deep-link validation against allowlists
- [ ] Certificate pinning (roadmap)

---

## 6. Circuit & contract build hygiene

1. Compile circuits only via `packages/circuits/compile.sh` (or documented CI).
2. After circuit changes, regenerate verifier; confirm `Groth16Verifier.sol` imports use **plain** paths:
   `import {IGroth16Verifier} from "./IGroth16Verifier.sol";`
   (never escaped `\"` — that fails `solc` / `forge test`).
3. `nPublic` for withdraw must be **5**; deposit verifier is a **separate** keyset.
4. Re-run a ceremony (or stay on labeled testnet keys) after any R1CS change.
5. Deploy scripts must set both `verifier` and `depositVerifier`.

---

## 7. Accepted transitive advisories

Some `pnpm audit` findings are deep transitive deps with no upstream patch. Track and re-evaluate each release.

### 7.1 `bigint-buffer` (via Solana SPL token stack)

- **Risk:** buffer overflow / panic on malformed RPC data.
- **Exposure:** only when decoding SPL account data from RPC.
- **Controls:** operator-controlled RPCs; decode paths fail closed to UI errors; no signing impact.

### 7.2 `elliptic` (via circomlibjs → ethers v5 at **compile** time)

- **Risk:** pathological ECDSA edge cases.
- **Exposure:** not on mobile signing path; circuit tooling only.
- **Controls:** none required at runtime for wallet binaries.

---

## 8. Roadmap (security)

### Near term

- [ ] Professional external audit (contracts + circuits + relayer)
- [ ] Multi-party Groth16 ceremony + published VK hashes
- [ ] Native Play Integrity / DeviceCheck modules
- [ ] Certificate pinning for production APIs

### Medium term

- [ ] Hardware wallet production UX
- [ ] Bug bounty program
- [ ] Formal review of deposit + withdraw circuit pair after ceremony

---

## 9. References

- [OWASP Mobile Security](https://owasp.org/www-project-mobile-security/)
- [Play Integrity](https://developer.android.com/google/play/integrity)
- [Apple DeviceCheck / App Attest](https://developer.apple.com/documentation/devicecheck)
- Circom / snarkjs Groth16 trusted setup documentation

---

*Living document. No privacy feature is “mainnet ready” until SEC-008 and SEC-011 are signed off.*
