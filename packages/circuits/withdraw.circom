// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "merkletree.circom"; // MerkleTreeChecker(levels)

/*
 * Withdraw Circuit
 *
 * Proves knowledge of (nullifier, secret) such that:
 *   1. Poseidon(nullifier, secret) is a leaf of the depth-`levels` Merkle tree
 *      whose root is the public input `merkleRoot`.
 *   2. Poseidon(nullifier) === public input `nullifierHash`.
 *   3. The public inputs `recipient` and `amount` are quadratically bound into
 *      the constraint system so they cannot be substituted post-proof.
 *
 * Public-input declaration order in the `main` component is load-bearing:
 * `snarkjs zkey export solidityverifier` lays `_pubSignals` out in this order,
 * and `VeilPool.withdraw` builds its `bytes32[] publicInputs` array to match.
 * See design.md §Public input ordering contract.
 */
template Withdraw(levels) {
    // ---- Private inputs ----
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // ---- Public inputs (DECLARED ORDER IS LOAD-BEARING) ----
    // [merkleRoot, nullifierHash, recipient, amount]
    signal input merkleRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;

    // 1. commitment = Poseidon(nullifier, secret)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;

    // 2. nullifierHash === Poseidon(nullifier)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // 3. Merkle membership: tree.leaf must be the commitment, tree.root must be the public merkleRoot.
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== merkleRoot;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // 4. Quadratic binding for recipient and amount.
    //    These constraints don't restrict the value of `recipient` / `amount`,
    //    but they pin those public signals into the R1CS so a malicious caller
    //    cannot post-substitute them after a proof has been generated.
    signal recipientSquare;
    signal amountSquare;
    recipientSquare <== recipient * recipient;
    amountSquare    <== amount * amount;
}

component main {public [merkleRoot, nullifierHash, recipient, amount]} = Withdraw(20);
