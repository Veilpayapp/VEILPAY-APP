# Veilpay Smart Contract Deployment Guide

This guide covers two flows:

1. **Privacy Stack — Sepolia Deployment Runbook** (load-bearing for the privacy
   feature; satisfies tasks.md task 11.2).
2. **Legacy contract deployment** (kept for the older `DeployAll` /
   `DeployVerifier` / `DeployRegistry` / `DeployPool` scripts).

If you are bringing the privacy stack online for the first time, follow the
runbook in section 1 end-to-end. The legacy section in §2 is reference material
for the registry / pool contracts that predate the privacy stack.

---

## 1. Veilpay Privacy Stack — Sepolia Deployment Runbook

This runbook deploys the four-layer privacy stack to Sepolia testnet:

```
Layer 2 (circuit) ──┐
                    │ compile.sh produces zkey + Groth16Verifier.sol
Layer 1 (contracts) ┴── DeployPrivacyStack.s.sol →
                        Groth16Verifier → VeilPool → StealthAnnouncer
                        →→ writes packages/contracts-evm/deployments/sepolia.json
Layer 3 (relayer)   ─── reads deployed VeilPool address from sepolia.json,
                        operator updates RELAYER_VEILPOOL_ALLOWLIST
Layer 4 (mobile)    ─── imports sepolia.json at bundle time;
                        isPrivacyStackConfigured() → true after deploy
```

The on-chain steps require an operator with funded Sepolia ETH and the
appropriate toolchain. They cannot run inside CI without secrets, so the rest
of this section is a runbook the operator follows.

> **What "configured" means.** The mobile app exposes
> `isPrivacyStackConfigured()` from
> `apps/consumer-app/src/constants/contracts.ts`. It returns `true` only when
> all three contract addresses in `deployments/sepolia.json` match
> `^0x[a-fA-F0-9]{40}$` and are non-zero. The placeholder JSON committed to
> the repo intentionally fails this check so an unconfigured build cannot send
> funds to the zero address.

### 1.1 Prerequisites

1. **Toolchains**

   ```bash
   # Foundry (forge / cast / anvil)
   curl -L https://foundry.paradigm.xyz | bash
   foundryup

   # Circom 2.x and snarkjs for circuit compilation
   pnpm install -g snarkjs
   # circom: install via cargo or download the prebuilt binary from
   # https://github.com/iden3/circom/releases — `cargo install --git
   # https://github.com/iden3/circom.git` works on most platforms.
   ```

2. **Funded deployer wallet on Sepolia.** Roughly 0.05 ETH covers the three
   privacy-stack deploys plus Etherscan verification with comfortable
   headroom. Faucets: <https://sepoliafaucet.com>.

3. **Pre-deployed Poseidon hasher.** The `VeilPool` constructor requires an
   `IPoseidonHasher` byte-compatible with circomlib's PoseidonT3. This repo
   does not ship a production-ready Solidity Poseidon, so deploy the
   `poseidon-solidity` PoseidonT3 contract separately and record its
   address. The `DeployPrivacyStack` script reads it from the
   `POSEIDON_HASHER` env var. See
   <https://github.com/chancehudson/poseidon-solidity> for the canonical
   deployer.

4. **Etherscan API key** (optional but strongly recommended for `--verify`).

### 1.2 Required environment variables

Configure these in `packages/contracts-evm/.env` before running the deploy
script. None are read until pre-flight, so a misconfigured run fails fast and
no transactions are broadcast.

| Variable           | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `SEPOLIA_RPC_URL`  | Sepolia RPC endpoint (Infura, Alchemy, or self-hosted).                |
| `DEPLOYER_PK`      | Private key of the funded Sepolia deployer wallet (uint256).           |
| `FEE_RECIPIENT`    | Address that receives `WITHDRAW_FEE_BPS` of every withdraw.            |
| `POSEIDON_HASHER`  | Address of the pre-deployed PoseidonT3-compatible hasher.              |
| `WITHDRAW_FEE_BPS` | Optional. Default `25` (0.25%). Cap: `10_000`.                         |
| `ETHERSCAN_API_KEY`| Optional. Required only when running with `--verify`.                  |

> The legacy scripts read `PRIVATE_KEY` instead of `DEPLOYER_PK`. The privacy
> stack script intentionally uses a separate name (`DEPLOYER_PK`) so deploys
> against the new manifest can't accidentally pick up an old broadcasting key.

### 1.3 Step 1 — Compile the circuit

This produces the witness wasm, the proving key, the verifier-key JSON, and
overwrites `packages/contracts-evm/src/Groth16Verifier.sol` with a contract
generated from the circuit (with the canonical `verifyProof(bytes,bytes32[])`
wrapper appended).

```bash
cd packages/circuits
bash compile.sh
```

Expected outputs after a clean run:

- `build/withdraw.wasm`
- `build/withdraw_final.zkey`
- `build/verification_key.json`
- `../contracts-evm/src/Groth16Verifier.sol` (overwritten — atomic; only
  promoted on full success)

Upload `build/withdraw.wasm` and `build/withdraw_final.zkey` to a public CDN
the mobile WebView can fetch from. Set the resulting URLs in the consumer-app
environment (Expo `EXPO_PUBLIC_*` vars are bundle-time, so a rebuild is
required after changing them):

```bash
EXPO_PUBLIC_CIRCUIT_WASM_URL=https://<your-cdn>/withdraw.wasm
EXPO_PUBLIC_CIRCUIT_ZKEY_URL=https://<your-cdn>/withdraw_final.zkey
```

> **Trusted setup caveat.** `compile.sh` runs the Powers-of-Tau and zkey
> beacon ceremony with development entropy. Do not reuse the resulting zkey
> for any deployment that handles real funds — re-run with a real ceremony
> beacon for production. Sepolia is testnet so the dev ceremony is fine for
> staging.

### 1.4 Step 2 — Deploy contracts to Sepolia

`DeployPrivacyStack.s.sol` deploys in the canonical order
`Groth16Verifier → VeilPool → StealthAnnouncer` and only writes
`deployments/sepolia.json` after all three constructors return. If any step
reverts, Foundry exits non-zero and the manifest keeps its previous (or
zero-placeholder) contents — `isPrivacyStackConfigured()` therefore stays
`false` until a clean re-run.

```bash
cd packages/contracts-evm
forge script script/DeployPrivacyStack.s.sol:DeployPrivacyStack \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast \
  --verify
```

After success, verify the manifest looks like:

```json
{
  "groth16Verifier": "0x<42-char hex>",
  "veilPool":        "0x<42-char hex>",
  "stealthAnnouncer":"0x<42-char hex>",
  "chainId": 11155111,
  "blockNumber": <integer>
}
```

> **Checksumming note.** The script emits lowercased addresses via
> `vm.toString(address)` because forge-std v1.8.1 does not expose
> `vm.toChecksumAddress`. The consumer app's
> `^0x[a-fA-F0-9]{40}$` gate is case-insensitive, so this is fine. Bumping
> forge-std past v1.7's checksum cheatcode is a TODO tracked in the script
> header.

### 1.5 Step 3 — Update the relayer allowlist

The relayer refuses any `contractAddress` not in
`RELAYER_VEILPOOL_ALLOWLIST`. After deploy, update the relayer environment
to include the new `VeilPool` address (lowercase, comma-separated for
multiple pools):

```bash
# apps/backend/.env
RELAYER_VEILPOOL_ALLOWLIST=0x<lowercased veilPool address from sepolia.json>
RELAYER_PRIVATE_KEY=0x<funded relayer key — separate from DEPLOYER_PK>
RELAYER_RPC_URL=$SEPOLIA_RPC_URL
```

The allowlist is parsed once at module load (see
`apps/backend/src/controllers/relayerController.ts`'s `loadAllowlist()`), so
**restart the relayer process** after editing the env file:

```bash
pnpm --filter backend dev    # or your production process manager equivalent
```

### 1.6 Step 4 — Confirm the consumer app sees the deployment

`isPrivacyStackConfigured()` should return `true` once the manifest has
non-zero addresses for all three contracts. From the consumer app:

```bash
cd apps/consumer-app
pnpm typecheck

# Programmatic check — skips the RN module-resolution dance by reading the
# JSON directly; mirrors the logic in
# `apps/consumer-app/src/constants/contracts.ts`.
node -e "const j=require('../../packages/contracts-evm/deployments/sepolia.json'); \
  const ZERO='0x0000000000000000000000000000000000000000'; \
  const RE=/^0x[a-fA-F0-9]{40}$/; \
  const ok=[j.veilPool,j.stealthAnnouncer,j.groth16Verifier].every(s=>RE.test(s)&&s.toLowerCase()!==ZERO); \
  console.log('isPrivacyStackConfigured ->', ok);"
```

A `true` result confirms the privacy-stack gate is satisfied and the
`PrivacyLevelScreen` will offer `'stealth'` and `'max'` levels for selection.

### 1.7 Step 5 — Smoke-test the app

```bash
cd apps/consumer-app
pnpm start
```

In a Sepolia-connected dev build, the privacy-level picker should now show
`'stealth'` and `'max'` enabled. A full deposit → prove → relay → withdraw
smoke test is covered by task 11.3 in
`.kiro/specs/veilpay-privacy-stack/tasks.md`.

### 1.8 Verifying the configuration gate without an on-chain deploy

When iterating on UI gating logic without doing a full deployment, you can
locally simulate the "configured" state by editing
`packages/contracts-evm/deployments/sepolia.json` to insert dummy non-zero
addresses (e.g. `0x000…001`, `0x000…002`, `0x000…003`):

```bash
# 1. Replace the zero placeholders with dummy non-zero addresses.
# 2. Confirm the gate flips:
node -e "const j=require('./packages/contracts-evm/deployments/sepolia.json'); \
  const ZERO='0x0000000000000000000000000000000000000000'; \
  const RE=/^0x[a-fA-F0-9]{40}$/; \
  console.log([j.veilPool,j.stealthAnnouncer,j.groth16Verifier].every(s=>RE.test(s)&&s.toLowerCase()!==ZERO));"
# Expected: true
```

**Always revert `sepolia.json` to the zero-address placeholders after this
check.** A committed build with dummy addresses would tell the app the
privacy stack is "configured" while the addresses point nowhere — exactly
the failure mode the gate is designed to prevent.

### 1.9 Troubleshooting

| Symptom                                                 | Likely cause / fix                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `compile.sh` exits at step 1 with `circom: not found`   | Install circom (see §1.1) and ensure it's on `$PATH`.                                                                |
| `compile.sh` exits at step 5 with snarkjs error         | The zkey from a prior partial run is corrupt. Delete `packages/circuits/build.tmp/` and re-run; the script is atomic.|
| `forge script` reverts at `vm.envAddress("FEE_RECIPIENT")` | Env var unset. Source `packages/contracts-evm/.env` or export inline.                                                |
| `forge script` reverts during constructors              | Most often `POSEIDON_HASHER` points at an EOA or wrong contract. Re-deploy the hasher and re-export the env var.     |
| `sepolia.json` still shows zero addresses after deploy  | The script aborted before `vm.writeFile`; check `forge` logs for the failing step. No partial overwrites by design.  |
| Relayer returns `400 contract not allowlisted`          | The new `VeilPool` address wasn't added to `RELAYER_VEILPOOL_ALLOWLIST` or the relayer was not restarted afterward.  |
| Consumer app reports "privacy stack not configured"     | One of the three addresses in `sepolia.json` is zero or malformed. Re-run §1.6.                                      |

---

## 2. Legacy Contract Deployment

The legacy `DeployAll` / `DeployVerifier` / `DeployRegistry` / `DeployPool`
scripts predate the privacy stack and target the merchant `VeilRegistry`
plus the older `VeilPool` deployment path. They are kept for backward
compatibility with existing infrastructure.

### Prerequisites

1. **Foundry Installation**

   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **Environment Setup**

   ```bash
   cd packages/contracts-evm
   cp .env.example .env
   ```

3. **Configure Environment Variables**
   - `PRIVATE_KEY`: Deployer private key (fund with testnet ETH/MATIC)
   - `SEPOLIA_RPC_URL`: Sepolia RPC endpoint (Infura/Alchemy)
   - `GOERLI_RPC_URL`: Goerli RPC endpoint
   - `POLYGON_MUMBAI_RPC_URL`: Mumbai RPC endpoint
   - `ETHERSCAN_API_KEY`: Etherscan API key for verification
   - `POLYGONSCAN_API_KEY`: Polygonscan API key for Mumbai verification

### Contracts

| Contract              | Description                                                                                 | Constructor Args            |
| --------------------- | ------------------------------------------------------------------------------------------- | --------------------------- |
| `Groth16Verifier.sol` | Fail-closed verifier placeholder; replace with generated Groth16 verifier before production | None                        |
| `VeilRegistry.sol`    | Merchant registry                                                                           | None                        |
| `VeilPool.sol`        | Privacy pool                                                                                | `verifier`, `feeRecipient`  |

### Deployment

#### Deploy All Contracts

```bash
# Sepolia
./scripts/deploy.sh sepolia

# Goerli
./scripts/deploy.sh goerli

# Mumbai
./scripts/deploy.sh mumbai
```

#### Deploy Individual Contracts

```bash
# Deploy Verifier only
forge script script/DeployVerifier.s.sol:DeployVerifier --rpc-url sepolia --broadcast

# Deploy Registry only
forge script script/DeployRegistry.s.sol:DeployRegistry --rpc-url sepolia --broadcast

# Deploy Pool (requires VERIFIER_ADDRESS in .env)
forge script script/DeployPool.s.sol:DeployPool --rpc-url sepolia --broadcast
```

### Verification

Contracts are automatically verified during deployment. To manually verify:

```bash
# Verify contract
forge verify-contract <address> <contract_name> --verifier etherscan
```

### Network Configurations

| Network | Chain ID | Currency | Explorer               |
| ------- | -------- | -------- | ---------------------- |
| Sepolia | 11155111 | ETH      | sepolia.etherscan.io   |
| Goerli  | 5        | ETH      | goerli.etherscan.io    |
| Mumbai  | 80001    | MATIC    | mumbai.polygonscan.com |

### Gas Optimization

The contracts are compiled with:

- Solidity 0.8.25
- EVM version: Paris
- Optimizer: enabled (200 runs)
- Via IR: enabled

### Post-Deployment

After deployment, update the contract addresses in:

1. `apps/backend/src/config/contracts.ts`
2. `apps/indexer/src/config/chains.ts`

For privacy-stack contracts specifically, the addresses flow through
`packages/contracts-evm/deployments/sepolia.json` — see §1.4.

### Security Considerations

- The bundled `Groth16Verifier.sol` intentionally returns `false` until it is
  replaced with a generated verifier contract from a real circuit and trusted
  setup. The privacy-stack runbook in §1.3 regenerates it via
  `compile.sh`.
- Never commit private keys to version control.
- Use hardware wallets for mainnet deployment.
- Verify all contract addresses before funding.
- Test thoroughly on testnets before mainnet deployment.

### Contract ABIs

After compilation, ABIs are available at:

```
packages/contracts-evm/out/<ContractName>.sol/<ContractName>.json
```

### Testnet Faucets

- **Sepolia**: <https://sepoliafaucet.com/>
- **Goerli**: <https://goerlifaucet.com/>
- **Mumbai**: <https://faucet.polygon.technology/>
