// Public inputs (load-bearing order):
//   [merkleRoot, nullifierHash, recipient, amount, token]
// See design.md §Public input ordering contract and docs/CIRCUIT_SECURITY.md
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "merkletree.circom"; // MerkleTreeChecker(levels)

/*
 * Withdraw Circuit (hardened)
 *
 * Proves knowledge of (nullifier, secret) such that:
 *   1. commitment = Poseidon(nullifier, secret, amount, token) is a leaf of
 *      the depth-`levels` Merkle tree whose root is public `merkleRoot`.
 *   2. Poseidon(nullifier) === public `nullifierHash` (double-spend tag).
 *   3. Public `amount` and `token` are the SAME signals hashed into the
 *      commitment — so a withdraw cannot claim a different value/asset than
 *      the note was created with (economic binding).
 *   4. `amount` is non-zero and fits in 128 bits; `token` and `recipient`
 *      fit in 160 bits (EVM address domain).
 *   5. `recipient` is quadratically self-bound so it cannot be stripped from
 *      the R1CS (withdraw-to-any-address is intentional; secrecy of the note
 *      is what authorizes the recipient choice).
 *
 * Public-input order is load-bearing for snarkjs / VeilPool / the mobile prover.
 *
 * SECURITY NOTE: Variable-amount notes are only sound if deposits also prove
 * that the inserted commitment opens to the transferred (amount, token).
 * That is `deposit.circom`. Without a valid deposit proof, a malicious
 * depositor could still insert an overstated commitment.
 */
template Withdraw(levels) {
    // ---- Private inputs ----
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // ---- Public inputs (DECLARED ORDER IS LOAD-BEARING) ----
    // [merkleRoot, nullifierHash, recipient, amount, token]
    signal input merkleRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    signal input token;

    // 1. Range / domain checks (prevents field-overflow footguns at the boundary)
    //    amount  ∈ (0, 2^128)
    //    token   ∈ [0, 2^160)   // address
    //    recipient ∈ [0, 2^160) // address
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;

    component amountNonZero = IsZero();
    amountNonZero.in <== amount;
    amountNonZero.out === 0;

    component tokenBits = Num2Bits(160);
    tokenBits.in <== token;

    component recipientBits = Num2Bits(160);
    recipientBits.in <== recipient;

    // 2. commitment = Poseidon(nullifier, secret, amount, token)
    //    amount and token are public AND hashed into the leaf → economic binding.
    component commitmentHasher = Poseidon(4);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    commitmentHasher.inputs[2] <== amount;
    commitmentHasher.inputs[3] <== token;

    // 3. nullifierHash === Poseidon(nullifier)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // 4. Merkle membership of the value-bound commitment
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== merkleRoot;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // 5. Pin recipient into R1CS (already range-checked above).
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

component main {public [merkleRoot, nullifierHash, recipient, amount, token]} = Withdraw(20);
