// SPDX-License-Identifier: MIT
// Notes: commitment = Poseidon(nullifier, secret, amount, token) — see CIRCUIT_SECURITY.md
pragma solidity ^0.8.25;

/**
 * @title IPoseidonHasher
 * @notice Minimal external surface for an on-chain Poseidon-2 hasher.
 *
 * Solidity does not expose Poseidon natively. The pool instead delegates each
 * 2-input Poseidon evaluation to a hasher contract that is byte-compatible
 * with the `circomlib` Poseidon hash used inside `withdraw.circom`.
 *
 * Production deployments wire the address of the
 * [`poseidon-solidity`](https://github.com/chancehudson/poseidon-solidity)
 * `PoseidonT3` contract here so the on-chain Merkle tree built by `VeilPool`
 * agrees, leaf-for-leaf and root-for-root, with the off-chain reference tree
 * used to generate `pathElements` / `pathIndices` for the circuit.
 *
 * The interface is intentionally tiny — a single `poseidon(bytes32[2])` call —
 * because that is the only Poseidon arity `VeilPool._insert` needs (the leaf
 * itself is the result of `Poseidon(nullifier, secret, amount, token)`,
 * computed off-chain inside the circuit; the on-chain pool only ever hashes
 * pairs of bytes32 upward through the Merkle tree).
 *
 * Tests pass a mock implementation; the deploy script passes the deployed
 * `PoseidonT3` address. See `script/DeployPrivacyStack.s.sol` (task 3.13).
 */
interface IPoseidonHasher {
    /**
     * @notice Compute Poseidon(input[0], input[1]) over the BN254 scalar field.
     * @param input Two 32-byte field elements (interpreted as uint256 mod p).
     * @return out  Poseidon hash as a bytes32 field element.
     */
    function poseidon(bytes32[2] calldata input) external pure returns (bytes32 out);
}
