# 🛡️ Veilpay Security

> [!NOTE]
> **Status:** Active development · Last updated: 2026-07-17  
> **External audits:** Pending (see [Ceremony & audit gates](docs/security/ceremony-and-audit-gates.md))

This document is the **security policy and threat overview** for the monorepo. Deeper product checklists live under [`docs/security/`](docs/security/).

---

## 🚨 1. Reporting Vulnerabilities

> [!IMPORTANT]
> Do **not** open a public GitHub issue for security bugs.

1. **Email:** `security@veilpay.app`
2. **Subject:** `[SECURITY] <short title>`
3. **Include:** description, repro steps, impact, and a suggested fix if you have one.

We aim to acknowledge within **48 hours** and coordinate disclosure.

---

## 🛑 2. What Must Never Be Committed or Logged

> [!CAUTION]
> The following must never be pushed to version control or printed in application logs:

- ❌ Mnemonics, private keys, raw signatures, session secrets
- ❌ `.env` files with real credentials (use `.env.example` only)
- ❌ Production Groth16 toxic waste / contributor randomness
- ❌ User nullifier / secret note preimages

*App and agent rules: never print or persist secrets. See `apps/consumer-app` SecureStore usage for commitment notes.*

---

## 🎯 3. Threat Model (Summary)

The Veilpay ecosystem spans across client devices, backend APIs, and on-chain privacy pools. Below is a high-level overview of our threat model and mitigations.

<details>
<summary>View Trust Boundaries Diagram</summary>

```mermaid
flowchart TD
  subgraph Client ["Client Device (Wallet)"]
    App["Consumer App"]
    SecureStore["Secure Enclave / Keystore"]
    App -->|Reads/Writes| SecureStore
  end

  subgraph Network ["Network Transport"]
    RPC["Chain RPCs"]
    API["Merchant API"]
  end

  subgraph Chains ["On-Chain"]
    ZkPool["ZK Privacy Pool (EVM)"]
    SPP["Stellar Private Payments"]
  end

  Client -- "Signs Tx (Never leaks keys)" --> Network
  Network -- "Submits Tx" --> Chains
  
  style SecureStore fill:#f9f,stroke:#333,stroke-width:2px
```
</details>

### 📱 3.1 Client / Wallet

| Threat | Impact | Mitigations |
| :--- | :--- | :--- |
| **Phishing / Fake App** | Critical | Store listing, deep-link allowlists, URL checks |
| **Device Compromise** | Critical | SecureStore / Keychain, biometrics, `FLAG_SECURE` where available |
| **Clipboard / Screen Capture** | Critical | Anti-screenshot on sensitive screens, no seed in logs |
| **Malicious RPC** | High | Operator-pinned RPCs in production; validate chain IDs |

### 🔌 3.2 Backend / Merchant API

| Threat | Impact | Mitigations |
| :--- | :--- | :--- |
| **API Key Abuse** | High | Hashed keys, rate limits, auth middleware |
| **Webhook Forgery** | High | Signature + timestamp windows ([webhook security](docs/security/webhook-security.md)) |
| **Relayer Drain / Wrong Pool**| High | Contract allowlist; relayer never learns nullifier/secret |
| **Injection / SSRF** | High | Zod validation, URL safety helpers |

### 🔐 3.3 Privacy Pool (EVM ZK)

Our zero-knowledge architecture ensures that deposits and withdrawals cannot be linked, while maintaining mathematical certainty that funds are not double-spent or forged.

<details>
<summary>View ZK Flow Diagram</summary>

```mermaid
sequenceDiagram
    participant User as User
    participant Pool as ZK Pool Contract
    participant Relayer as Relayer (Withdrawal)

    Note over User,Pool: DEPOSIT
    User->>User: Generate (nullifier, secret)
    User->>User: commitment = Poseidon(nullifier, secret, amount, token)
    User->>Pool: Deposit Tokens + commitment
    Pool-->>Pool: Insert commitment into Merkle Tree
    
    Note over User,Relayer: WITHDRAWAL
    User->>User: Generate ZK Proof (Groth16)
    User->>User: nullifierHash = Poseidon(nullifier)
    User->>Relayer: Send Proof, nullifierHash, recipient, amount, token
    Relayer->>Pool: Submit transaction (pays gas)
    Pool->>Pool: Verify Proof & check nullifierHash (prevent double-spend)
    Pool->>User: Transfer tokens to recipient
```
</details>

| Threat | Impact | Mitigations |
| :--- | :--- | :--- |
| **Overstated Withdraw** | Critical | Note binds `amount` + `token`. Deposit circuit proves leaf opens to transferred value |
| **Double-Spend** | Critical | `nullifierSpent` mapping; `nullifierHash = Poseidon(nullifier)` |
| **Public-Input Congruence** | High | Pool rejects any public input ≥ BN254 scalar field `r` |
| **Forged Groth16 Proofs** | Critical | **Requires real multi-party ceremony** — current keys are **dev-only** |
| **Stolen Note** | High | Device security; any holder can set recipient (by design) |
| **Malicious ERC-20** | Medium | Prefer allowlisted tokens; fee-on-transfer unsupported |

**Canonical commitment details:**
```text
commitment    = Poseidon(nullifier, secret, amount, token)
nullifierHash = Poseidon(nullifier)
```

**Withdraw public inputs** *(order is load-bearing for verifier)*:
```text
[merkleRoot, nullifierHash, recipient, amount, token]
```

**Deposit public inputs**:
```text
[commitment, amount, token]
```
*(Full circuit detail: [`packages/circuits/docs/CIRCUIT_SECURITY.md`](packages/circuits/docs/CIRCUIT_SECURITY.md))*

### 🌌 3.4 Stellar Private Payments (SPP)

- **Status:** Testnet-oriented; **fail-closed on mainnet** until product + audit gates pass.
- **Requirement:** Native pool ops required for shield/transfer/unshield; derive-only builds must not expose Private mode as ready.

---

## 🚦 4. Production Gates

> [!WARNING]
> These gates **must pass** before declaring any feature “mainnet privacy ready”.

| ID | Gate | Blocks |
| :--- | :--- | :--- |
| **SEC-008** | Trusted setup / ceremony | Mainnet deploy of Groth16 verifiers / proving keys |
| **SEC-011** | External security audit | Claims of “audited” / mainnet-ready privacy |

**Detailed Checklists:**
- [Ceremony & audit gates](docs/security/ceremony-and-audit-gates.md)
- [Production checklist](docs/security/production-checklist.md)
- [Secrets & keys](docs/security/secrets-and-keys.md)
- [API hardening](docs/security/api-hardening.md)
- [Security model](docs/security/security-model.md)

---

## ✅ 5. Client Security Checklist (Wallet)

Derived from product audit IDs used in the consumer app:

### 🔑 Cryptography & Keys
- [x] Mnemonic generation uses CSPRNG
- [x] Mnemonics / keys never logged or returned casually to UI layers
- [x] Secure storage via platform keychain / keystore
- [x] EIP-155-style chain binding for EVM signing
- [ ] Hardware wallet (Ledger/Trezor) production path complete

### 📱 UI & Device
- [x] Anti-screenshot on seed / private-key surfaces where platform allows
- [x] Homoglyph / URL checks for risky links
- [ ] Play Integrity / DeviceCheck fully wired in production builds

### 🌐 Network
- [x] HTTPS RPC and API endpoints in production config
- [x] Deep-link validation against allowlists
- [ ] Certificate pinning (roadmap)

---

## 🛠️ 6. Circuit & Contract Build Hygiene

1. **Compilation:** Compile circuits only via `packages/circuits/compile.sh` (or documented CI).
2. **Verification:** After circuit changes, regenerate verifier; confirm `Groth16Verifier.sol` imports use **plain** paths:
   ```solidity
   import {IGroth16Verifier} from "./IGroth16Verifier.sol";
   ```
   *(never escaped `\"` — that fails `solc` / `forge test`).*
3. **Public Inputs:** `nPublic` for withdraw must be **5**; deposit verifier is a **separate** keyset.
4. **Ceremony:** Re-run a ceremony (or stay on labeled testnet keys) after any R1CS change.
5. **Deployment:** Deploy scripts must set both `verifier` and `depositVerifier`.

---

## 📦 7. Accepted Transitive Advisories

Some `pnpm audit` findings are deep transitive deps with no upstream patch. Track and re-evaluate each release.

### 7.1 `bigint-buffer` (via Solana SPL token stack)
- **Risk:** Buffer overflow / panic on malformed RPC data.
- **Exposure:** Only when decoding SPL account data from RPC.
- **Controls:** Operator-controlled RPCs; decode paths fail closed to UI errors; no signing impact.

### 7.2 `elliptic` (via circomlibjs → ethers v5 at **compile** time)
- **Risk:** Pathological ECDSA edge cases.
- **Exposure:** Not on mobile signing path; circuit tooling only.
- **Controls:** None required at runtime for wallet binaries.

---

## 🛣️ 8. Roadmap (Security)

### 🚀 Near Term
- [ ] Professional external audit (contracts + circuits + relayer)
- [ ] Multi-party Groth16 ceremony + published VK hashes
- [ ] Native Play Integrity / DeviceCheck modules
- [ ] Certificate pinning for production APIs

### 🛤️ Medium Term
- [ ] Hardware wallet production UX
- [ ] Bug bounty program
- [ ] Formal review of deposit + withdraw circuit pair after ceremony

---

## 📚 9. References

- 🔗 [OWASP Mobile Security](https://owasp.org/www-project-mobile-security/)
- 🔗 [Play Integrity](https://developer.android.com/google/play/integrity)
- 🔗 [Apple DeviceCheck / App Attest](https://developer.apple.com/documentation/devicecheck)
- 🔗 Circom / snarkjs Groth16 trusted setup documentation

---
> *Living document. No privacy feature is “mainnet ready” until SEC-008 and SEC-011 are signed off.*
