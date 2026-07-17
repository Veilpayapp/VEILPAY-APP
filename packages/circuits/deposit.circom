// Public inputs (load-bearing order):
//   [commitment, amount, token]
// Complements withdraw.circom — see docs/CIRCUIT_SECURITY.md
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/*
 * Deposit Circuit
 *
 * Proves that a public `commitment` is a well-formed note for the public
 * (amount, token) being transferred into the pool:
 *
 *   commitment === Poseidon(nullifier, secret, amount, token)
 *
 * Private (nullifier, secret) stay hidden. The pool can require this proof
 * on `deposit` so a user cannot insert a leaf that claims a larger amount
 * (or different token) than they actually transferred.
 *
 * Domain checks match withdraw.circom so deposit and withdraw notes are
 * interchangeable under the same commitment formula.
 */
template Deposit() {
    // ---- Private inputs ----
    signal input nullifier;
    signal input secret;

    // ---- Public inputs (DECLARED ORDER IS LOAD-BEARING) ----
    // [commitment, amount, token]
    signal input commitment;
    signal input amount;
    signal input token;

    // amount ∈ (0, 2^128), token ∈ [0, 2^160)
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;

    component amountNonZero = IsZero();
    amountNonZero.in <== amount;
    amountNonZero.out === 0;

    component tokenBits = Num2Bits(160);
    tokenBits.in <== token;

    component commitmentHasher = Poseidon(4);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    commitmentHasher.inputs[2] <== amount;
    commitmentHasher.inputs[3] <== token;

    commitment === commitmentHasher.out;
}

component main {public [commitment, amount, token]} = Deposit();
