# VeilPay Circuit Security

## What we prove

| Circuit | Public inputs (order) | Private | Claim |
|---------|----------------------|---------|--------|
| `deposit.circom` | `[commitment, amount, token]` | `nullifier`, `secret` | Leaf opens to this amount/token |
| `withdraw.circom` | `[merkleRoot, nullifierHash, recipient, amount, token]` | `nullifier`, `secret`, Merkle path | Note in tree; spend tag; pay this amount/token to recipient |

## Commitment formula (canonical)

```
commitment = Poseidon(nullifier, secret, amount, token)
nullifierHash = Poseidon(nullifier)
```

- `amount` — uint in `(0, 2^128)` (range-checked in-circuit)
- `token` — EVM address as uint160 field element
- `recipient` — EVM address as uint160 (withdraw only; not in the note)

## Hardening applied

1. **Economic binding** — amount and token are hashed into the commitment and are public withdraw inputs (same signals).
2. **Deposit integrity** — `deposit.circom` forces the inserted leaf to open to the transferred amount/token.
3. **Range checks** — `Num2Bits` on amount (128), token/recipient (160); amount non-zero.
4. **Path bits** — `DualMux` enforces `pathIndices ∈ {0,1}`.
5. **On-chain** — every public input must be `< BN254 scalar field r` before verify/state (see `VeilPool`).

## Trusted setup (ceremony)

Groth16 keys in `build/` from `compile.sh` use **dev-only** entropy. They are **not** production-safe.

A **ceremony** is a multi-party trusted setup that produces proving/verification keys such that toxic waste is destroyed if at least one participant is honest. Re-run phase-2 after any circuit change. Do not mainnet with dogfood zkeys.

## Showing the code (what to say)

When someone asks to see the circuit:

1. Open **`packages/circuits/withdraw.circom`** first (main withdraw proof).
2. Open **`packages/circuits/deposit.circom`** (deposit integrity).
3. Open **`packages/circuits/merkletree.circom`** (Merkle path helper).
4. Point at **this doc** for the security model.

**One-liner:**

> “Withdraw proves you know a note in the tree: commitment = Poseidon(nullifier, secret, amount, token). Amount and token are public and hashed into the note, so you can’t withdraw more than the note was created for. Deposit requires the same opening proof so the leaf matches the transfer. Nullifier prevents double-spend. Depth-20 Poseidon Merkle tree.”

**Do not claim:** production-safe keys until a real multi-party ceremony replaces the dev zkeys in `build/`.
