# Veilpay End-to-End Smoke Test

> Feature: `veilpay-privacy-stack`, Task 11.3

A scripted, operator-driven smoke test that exercises the full privacy
pipeline — **deposit → prove → relay → withdraw → mark spent** — against a
real chain (Sepolia or a local Anvil fork) and a running relayer.

The script lives at `apps/backend/scripts/e2e-smoke-test.ts` and is the
mechanical equivalent of the consumer-app's `usePaymentTransaction` `'max'`
privacy branch, driven from Node so a CI runner or operator can validate
Requirement 9.6's end-to-end round-trip without firing up a phone or
Detox harness.

## What it validates

| Property | Where it surfaces in the script |
|----------|---------------------------------|
| 1 — Merkle membership proof round-trip | `stepProve` runs `snarkjs.groth16.fullProve` against real `withdraw.wasm` / `withdraw_final.zkey`, then verifies the proof locally via `snarkjs.groth16.verify` against the deployed verification key |
| 2, 3 — Incremental tree + root history | `stepDeposit` mirrors the on-chain insert in the off-chain reference tree and asserts the post-insert roots match byte-for-byte |
| 5 — Nullifier double-spend prevention | `stepMarkSpent` reads `pool.nullifierSpent(nullifierHash)` and asserts it is `true` |
| 6 — Fee math conservation | `stepWithdrawConfirmation` asserts `recipientDelta == amount - fee` and `feeRecipientDelta == fee` |
| 13 — Relayer forwards to allowlisted pools | `stepRelay` POSTs the canonical body to `/api/v1/relayer/withdraw` and asserts a 200 with a real `txHash` |
| 17 — Mobile-relayer request shape | The `body` object in `stepRelay` is the exact `WithdrawRequestSchema` shape the mobile app posts |

## Why Node + ethers + snarkjs (not Detox / WebView)

The intent of task 11.3 is to validate the integration of Properties 1, 2,
3, 5, 6, 13, and 17 — i.e. the cryptographic and HTTP boundaries between
circuit, contract, and relayer. None of those properties depend on the
React Native runtime. Driving the WebView from Detox just to run the same
`snarkjs.groth16.fullProve` call adds enormous flakiness for zero
additional coverage. Node + snarkjs reproduces the exact byte-for-byte
proof the WebView would generate (snarkjs is the same library on both
sides), so the smoke test stays deterministic and fast.

## Prerequisites

The script does **not** redeploy contracts, start the relayer, or mint a
test ERC-20. The operator must have completed the following before running
it:

1. **Compiled circuit artifacts** — `pnpm --filter @veilpay/circuits compile`
   has run successfully and produced
   `packages/circuits/build/{withdraw.wasm,withdraw_final.zkey,verification_key.json}`.
2. **Deployed contracts** — task 11.2's `DeployPrivacyStack.s.sol` has been
   run against the target chain and `packages/contracts-evm/deployments/sepolia.json`
   contains real, non-zero, 42-character addresses for `groth16Verifier`,
   `veilPool`, and `stealthAnnouncer`.
3. **Running relayer** — `apps/backend` is up (`pnpm --filter @veilpay/backend dev`)
   with:
   - `RELAYER_PRIVATE_KEY` set to a wallet funded for gas on the target chain.
   - `RELAYER_RPC_URL` pointing at the same RPC as `E2E_RPC_URL`.
   - `RELAYER_VEILPOOL_ALLOWLIST` containing the deployed `VeilPool`
     address (lowercase, comma-separated if multiple).
4. **Funded depositor wallet** — `E2E_DEPOSITOR_PK`'s address holds at
   least `E2E_AMOUNT` of `E2E_TOKEN_ADDRESS` and a small amount of gas
   token (ETH on Sepolia).
5. **A pre-deployed test ERC-20** — any token whose address you supply via
   `E2E_TOKEN_ADDRESS`. The relayer wallet does not need to hold the
   token; only the depositor does.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `E2E_RPC_URL` | yes | JSON-RPC endpoint for the target chain. Use the same one the relayer is configured against. |
| `E2E_DEPOSITOR_PK` | yes | Hex-prefixed private key of the depositor wallet. **Use a throwaway test wallet only.** |
| `E2E_TOKEN_ADDRESS` | yes | ERC-20 contract address the script will deposit and withdraw. |
| `E2E_RECIPIENT_ADDRESS` | yes | Address that will receive the withdrawn funds. Distinct from the depositor on purpose. |
| `E2E_AMOUNT` | yes | Deposit amount in the token's smallest unit (positive decimal string, e.g. `1000000` for 1 USDC at 6 decimals). |
| `RELAYER_BASE_URL` | no | Base URL of the running relayer. Defaults to `http://localhost:3000`. |

## Sample run command

From the workspace root:

```bash
RELAYER_BASE_URL=http://localhost:3000 \
E2E_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY \
E2E_DEPOSITOR_PK=0xabc... \
E2E_TOKEN_ADDRESS=0x... \
E2E_RECIPIENT_ADDRESS=0x... \
E2E_AMOUNT=1000000 \
tsx apps/backend/scripts/e2e-smoke-test.ts
```

On Windows PowerShell:

```powershell
$env:RELAYER_BASE_URL = "http://localhost:3000"
$env:E2E_RPC_URL = "https://sepolia.infura.io/v3/YOUR_KEY"
$env:E2E_DEPOSITOR_PK = "0xabc..."
$env:E2E_TOKEN_ADDRESS = "0x..."
$env:E2E_RECIPIENT_ADDRESS = "0x..."
$env:E2E_AMOUNT = "1000000"
pnpm exec tsx apps/backend/scripts/e2e-smoke-test.ts
```

## Expected output

A successful run logs each phase to stdout and exits 0:

```
[setup] relayer base url: http://localhost:3000
[setup] pool=0x...
[setup] depositor=0x...
[setup] wasm=.../packages/circuits/build/withdraw.wasm
[setup] zkey=.../packages/circuits/build/withdraw_final.zkey
[deposit] commitment = 0x...
[deposit] approve tx 0x... confirmed
[deposit] leafIndex=0, merkleRoot=0x...
[deposit] record persisted to .smoke-0x...-abcd1234.json
[prove] generating Groth16 proof (this is the slow step)…
[prove] proof generated; publicSignals=["...","...","...","..."]
[prove] local snarkjs verify ✓
[relay] POST http://localhost:3000/api/v1/relayer/withdraw
[relay] accepted; txHash=0x...
[withdraw] tx 0x... confirmed in block N
[withdraw] recipient +X, feeRecipient +Y (Property 6 ✓)
[mark-spent] pool.nullifierSpent[nullifierHash] = true ✓
[mark-spent] local record at .smoke-0x...-abcd1234.json updated with spent=true
[done] end-to-end smoke test passed ✓
```

A failure exits 1 with a descriptive message identifying the step that
broke.

## Debugging failures

| Symptom | Likely cause |
|---------|--------------|
| `Deployment field … is missing or zero` | Task 11.2 has not run; `sepolia.json` still holds the placeholder zero addresses. |
| `Circuit artifact missing: …withdraw.wasm` | `compile.sh` has not run; the `build/` directory is empty or stale. |
| `Off-chain tree root … does not match on-chain root …` | The on-chain Poseidon hasher and the circomlib Poseidon used by the script are not byte-compatible. Inspect the `IPoseidonHasher` implementation passed into `VeilPool`. |
| `Local snarkjs.groth16.verify rejected …` | The `verification_key.json` does not match the `withdraw_final.zkey` used to generate the proof. Re-run `compile.sh`. |
| `Relayer responded 400: …contract not allowlisted…` | `RELAYER_VEILPOOL_ALLOWLIST` does not include the deployed pool's address. |
| `Relayer responded 503: Relayer not configured` | `RELAYER_PRIVATE_KEY` (or `RELAYER_RPC_URL`) is unset on the relayer process. |
| `Relayer responded 422: InvalidProof` | Proof bytes survived the relayer but failed on-chain verification. Most often caused by a stale `pathElements` (depositor's local tree desynced from chain) or wrong `recipient` / `amount` between prove and relay. |
| `Relayer responded 422: NullifierAlreadySpent` | The script was run twice with the same commitment record file present. Delete the `.smoke-…-….json` artifact and start a fresh deposit. |
| `Withdraw tx … did not confirm within …ms` | RPC is lagging or mempool is congested; bump `CONFIRMATION_POLL_TIMEOUT_MS` or wait and re-check `tx.hash` manually. |
| `Recipient balance delta … does not equal expected payout …` | A different transfer landed in the same window, or the token has transfer-fees on. Use a fee-free test token. |

## Safety notes

- The `E2E_DEPOSITOR_PK` is read from the environment and used to sign
  real on-chain transactions. **Never use a production wallet.**
- The script writes a `CommitmentRecord` JSON file to the working
  directory containing `nullifier` and `secret` in plaintext. This is
  intentional for the test — a real device uses SecureStore — but you
  should delete the file after the run if the depositor wallet might be
  reused.
- The script does not gas-sponsor the **deposit**; the depositor wallet
  pays for `approve` + `deposit`. Only the **withdraw** is relayed.
