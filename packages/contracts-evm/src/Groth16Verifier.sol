// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract Groth16Verifier {
    function verifyProof(
        bytes calldata _proof,
        bytes32[] calldata _publicInputs
    ) external pure returns (bool) {
        _proof;
        _publicInputs;
        return false;
    }

    function verifyProofWithInputs(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[4] memory input
    ) external pure returns (bool) {
        a;
        b;
        c;
        input;
        return false;
    }
}
