// SPDX-License-Identifier: MIT
// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
pragma solidity ^0.8.25;

/**
 * @title IGroth16Verifier
 * @notice Canonical ABI for the on-chain Groth16 verifier used by VeilPool.
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
 *   - A future circuit revision that adds a public signal only requires
 *     updating the wrapper, not every caller.
 *   - Malformed input (length mismatch, undecodable proof bytes) returns
 *     `false` instead of reverting, so the pool layer always raises a clean
 *     `InvalidProof` revert and never a cryptic `abi.decode` revert.
 *
 * Public-input ordering contract (load-bearing — must match
 * `withdraw.circom`'s `component main { public [...] }` declaration):
 *
 *   publicInputs[0] = merkleRoot
 *   publicInputs[1] = nullifierHash
 *   publicInputs[2] = recipient (address right-padded to bytes32)
 *   publicInputs[3] = amount    (uint256 cast to bytes32)
 */
interface IGroth16Verifier {
    /**
     * @notice Verify a Groth16 proof against four canonical public inputs.
     * @param proof         abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)
     * @param publicInputs  Length-4 array in canonical order (see contract above).
     * @return ok           True iff the proof is valid for the given inputs.
     *                      Returns false (without revert) on length mismatch
     *                      or undecodable proof bytes.
     */
    function verifyProof(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool ok);
}

// -----------------------------------------------------------------------------
// Wrapper template (canonical source of truth)
// -----------------------------------------------------------------------------
//
// The Groth16Verifier wrapper that compile.sh's post-processing step injects
// at the bottom of the generated `Groth16Verifier.sol` is mirrored verbatim in
// `Groth16VerifierWrapperTemplate.txt` next to this file. Keeping it in a
// plain-text sibling (rather than a here-doc) means the build script can
// concatenate it with a single `cat` and avoid shell-quoting hazards.
//
// Reference outline (do NOT edit here — edit the .txt template):
//
//   function verifyProof(bytes calldata proof, bytes32[] calldata publicInputs)
//       external view returns (bool)
//   {
//       if (publicInputs.length != 4) return false;
//       if (proof.length == 0)         return false;
//       try this._decodeAndVerify(proof, publicInputs) returns (bool ok) {
//           return ok;
//       } catch {
//           return false;
//       }
//   }
//
//   function _decodeAndVerify(bytes calldata proof, bytes32[] calldata publicInputs)
//       external view returns (bool)
//   {
//       (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
//           abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
//       uint256[4] memory pub;
//       pub[0] = uint256(publicInputs[0]); // merkleRoot
//       pub[1] = uint256(publicInputs[1]); // nullifierHash
//       pub[2] = uint256(publicInputs[2]); // recipient
//       pub[3] = uint256(publicInputs[3]); // amount
//       return _verifyProofRaw(a, b, c, pub);
//   }
//
// The `_decodeAndVerify` helper is `external` and invoked via `this.` so an
// `abi.decode` revert on malformed proof bytes is caught by the outer
// `try/catch` and surfaced as a clean `false` to the caller. That is what
// satisfies Requirement 3.4 ("returns false without reverting on malformed
// input").
