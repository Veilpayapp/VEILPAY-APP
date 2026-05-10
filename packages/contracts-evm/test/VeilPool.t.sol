// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {VeilPool, IVerifySignature} from "../src/VeilPool.sol";

contract AcceptsEth {
    receive() external payable {}
}

contract MockVerifier is IVerifySignature {
    bool private immutable returnValue;

    constructor(bool _returnValue) {
        returnValue = _returnValue;
    }

    function verifyProof(
        bytes calldata,
        bytes32[] calldata
    ) external view returns (bool) {
        return returnValue;
    }
}

contract VeilPoolTest is Test {
    VeilPool private pool;
    MockVerifier private failingVerifier;
    MockVerifier private passingVerifier;
    AcceptsEth private feeRecipient;
    AcceptsEth private recipient;

    function setUp() public {
        failingVerifier = new MockVerifier(false);
        passingVerifier = new MockVerifier(true);
        feeRecipient = new AcceptsEth();
        recipient = new AcceptsEth();
        pool = new VeilPool(address(failingVerifier), address(feeRecipient));
    }

    function testDepositAndWithdrawWithUpdatedVerifier() public {
        vm.deal(address(this), 10_000);

        bytes32 commitment = keccak256("commitment");
        uint256 leafIndex = pool.deposit{value: 10_000}(commitment, address(0), 10_000);

        assertEq(leafIndex, 0);
        assertEq(pool.balances(address(0)), 9_970);
        assertEq(address(pool).balance, 9_970);

        pool.updateVerifier(address(passingVerifier));

        bytes memory proof = new bytes(256);
        bytes32 nullifier = keccak256("nullifier");

        uint256 feeRecipientBefore = address(feeRecipient).balance;
        uint256 recipientBefore = address(recipient).balance;

        pool.withdraw(nullifier, proof, address(recipient), address(0), 9_970);

        assertEq(pool.nullifierSpent(nullifier), true);
        assertEq(pool.balances(address(0)), 0);
        assertEq(address(pool).balance, 0);
        assertEq(address(feeRecipient).balance - feeRecipientBefore, 29);
        assertEq(address(recipient).balance - recipientBefore, 9_941);
    }

    function testDepositRevertsWhenPaused() public {
        pool.pause();

        vm.deal(address(this), 1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        pool.deposit{value: 1}(bytes32(uint256(1)), address(0), 1);
    }

    function testWithdrawRevertsWhenPaused() public {
        vm.deal(address(this), 10_000);
        pool.deposit{value: 10_000}(bytes32(uint256(1)), address(0), 10_000);
        pool.updateVerifier(address(passingVerifier));
        pool.pause();

        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        pool.withdraw(bytes32(uint256(2)), new bytes(256), address(recipient), address(0), 9_970);
    }

    function testUpdateVerifierOnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        pool.updateVerifier(address(passingVerifier));
    }

    function testUpdateFeeRecipientOnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        pool.updateFeeRecipient(address(recipient));
    }
}