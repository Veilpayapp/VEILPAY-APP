// SPDX-License-Identifier: MIT
// Withdraw public inputs: [merkleRoot, nullifierHash, recipient, amount, token]
// Deposit public inputs:  [commitment, amount, token]
// See packages/circuits/docs/CIRCUIT_SECURITY.md
pragma solidity ^0.8.25;

/**
 * @title IGroth16Verifier
 * @notice Canonical ABI for on-chain Groth16 verifiers used by VeilPool.
 *
 * The snarkjs-generated `Groth16Verifier.sol` exports a positional function
 * `verifyProof(uint[2], uint[2][2], uint[2], uint[N])`. We do not call that
 * directly. `compile.sh`'s post-processing step renames the generated
 * function to `_verifyProofRaw` and appends a thin wrapper that conforms to
 * this interface, so:
 *
 *   - VeilPool, the relayer, and the mobile prover all deal in
 *     (bytes proof, bytes32[] publicInputs); they remain agnostic to the
 *     exact public-signal count of the underlying circuit.
 *   - Malformed input (length mismatch, undecodable proof bytes) returns
 *     `false` instead of reverting, so the pool layer always raises a clean
 *     `InvalidProof` revert and never a cryptic `abi.decode` revert.
 *
 * Withdraw public-input ordering (load-bearing — `withdraw.circom`):
 *
 *   publicInputs[0] = merkleRoot
 *   publicInputs[1] = nullifierHash
 *   publicInputs[2] = recipient (address as uint160 in bytes32)
 *   publicInputs[3] = amount
 *   publicInputs[4] = token     (address as uint160 in bytes32)
 *
 * Deposit public-input ordering (load-bearing — `deposit.circom`):
 *
 *   publicInputs[0] = commitment
 *   publicInputs[1] = amount
 *   publicInputs[2] = token
 *
 * Each circuit's verifier wrapper enforces its own `publicInputs.length`.
 */
interface IGroth16Verifier {
    /**
     * @notice Verify a Groth16 proof against the circuit's public inputs.
     * @param proof         abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)
     * @param publicInputs  Canonical order for the circuit this verifier was built for.
     * @return ok           True iff the proof is valid for the given inputs.
     *                      Returns false (without revert) on length mismatch
     *                      or undecodable proof bytes.
     */
    function verifyProof(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool ok);
}
