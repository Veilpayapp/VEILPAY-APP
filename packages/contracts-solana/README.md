# `@veilpay/contracts-solana`

Anchor program for the Solana privacy pool (`veil_pool`).

## Deploy gate (read this first)

**Do not deploy this program for multi-user / multi-deposit production.**

| Gate | Behavior |
|------|----------|
| **Single-leaf scaffold** | `MAX_SCAFFOLD_LEAVES = 1`. A second distinct deposit reverts with `ScaffoldSingleLeafOnly`. |
| **Why** | There is no incremental Poseidon Merkle tree yet. The pool stamps `merkle_root = commitment` for the sole leaf. A second deposit would overwrite the root and **permanently lock** the first note’s tokens. |
| **Lift when** | Incremental tree + root history (EVM `VeilPool` parity) + deposit→prove→withdraw e2e land, then raise/remove the cap. |

SEC-007 (real Groth16) is **done**. The remaining product residual is the Merkle tree, not the verifier stub.

## SEC-007 — Groth16 withdraw verification

`withdraw` verifies a BN254 Groth16 proof on-chain via
[`groth16-solana`](https://crates.io/crates/groth16-solana) (Solana
`alt_bn128` syscalls). The verifying key is generated from the shared
withdraw circuit:

```bash
pnpm gen:vk   # or: npm run gen:vk
```

Public inputs (load-bearing order, matches EVM / `withdraw.circom`):

| Index | Signal         | Encoding                                      |
|------:|----------------|-----------------------------------------------|
| 0     | `merkleRoot`   | 32-byte BE field element                      |
| 1     | `nullifierHash`| 32-byte BE field element                      |
| 2     | `recipient`    | Solana pubkey bytes as BE field (`< Fr`)      |
| 3     | `amount`       | `u64` left-padded to 32 BE bytes              |

**Proof bytes:** same layout as EVM
`abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)` — 256 bytes
big-endian `A || B || C`. The program negates `A` on-chain for the
Solana pairing orientation.

Fail-closed: malformed length, out-of-range public inputs, or failed
pairing → `InvalidProof` (no funds, no nullifier write).

## Scaffold limits

- One commitment / one root (`MAX_SCAFFOLD_LEAVES`).
- Nullifier + commitment sets use `max_len(100)` (raise/PDA-shard before scale).
- Full deposit→prove→withdraw e2e needs Merkle + prover path.

## Develop

```bash
# Host unit tests (no solana/anchor CLI required)
npm run test:unit

# Full local validator suite (requires `anchor` + `solana` toolchains)
npm run test
```

Program id in `Anchor.toml` / `declare_id!` is a deterministic localnet
placeholder (`seed = "veil_pool"`). Replace on real deploy.
