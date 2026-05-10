// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";

contract Groth16VerifierTest is Test {
    Groth16Verifier private verifier;

    function setUp() public {
        verifier = new Groth16Verifier();
    }

    function testVerifyProofReturnsFalse() public view {
        bytes memory proof = new bytes(256);
        bytes32[] memory publicInputs = new bytes32[](4);

        assertFalse(verifier.verifyProof(proof, publicInputs));
    }

    function testVerifyProofWithInputsReturnsFalse() public view {
        uint256[2] memory a;
        uint256[2][2] memory b;
        uint256[2] memory c;
        uint256[4] memory input;

        assertFalse(verifier.verifyProofWithInputs(a, b, c, input));
    }
}