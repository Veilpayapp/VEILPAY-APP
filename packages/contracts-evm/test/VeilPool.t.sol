// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {VeilPool, InvalidFeeRecipient, InvalidFeeBps, InvalidVerifier, InvalidHasher, AmountExceedsMax} from "../src/VeilPool.sol";
import {ToggleableVerifier, MockPoseidonHasher, MockERC20} from "./CustomErrors.t.sol";
import {IGroth16Verifier} from "../src/IGroth16Verifier.sol";
import {IPoseidonHasher} from "../src/IPoseidonHasher.sol";

contract VeilPoolTest is Test {
    VeilPool private pool;
    ToggleableVerifier private verifier;
    MockPoseidonHasher private hasher;
    MockERC20 private token;

    address private feeRecipient = address(0xFEE);
    address private recipient = address(0xBEEF);
    uint256 private constant WITHDRAW_FEE_BPS = 300; // 3%

    function setUp() public {
        verifier = new ToggleableVerifier();
        verifier.setOk(true); // default passing
        hasher = new MockPoseidonHasher();
        token = new MockERC20();

        pool = new VeilPool(
            IGroth16Verifier(address(verifier)),
            IPoseidonHasher(address(hasher)),
            feeRecipient,
            WITHDRAW_FEE_BPS,
            0 // 0 = no max-withdraw cap (SEC-013); covered explicitly below
        );

        token.mint(address(this), 1_000_000);
        token.approve(address(pool), type(uint256).max);
    }

    function testDepositAndWithdraw() public {
        bytes32 commitment = keccak256("commitment");
        uint256 depositAmount = 10_000;

        uint256 poolBalanceBefore = token.balanceOf(address(pool));

        uint32 leafIndex = pool.deposit(commitment, address(token), depositAmount);
        
        assertEq(leafIndex, 0);
        assertEq(token.balanceOf(address(pool)), poolBalanceBefore + depositAmount);

        bytes memory proof = new bytes(256);
        bytes32 nullifier = keccak256("nullifier");
        bytes32 root = pool.roots(pool.currentRootIndex());

        uint256 feeRecipientBefore = token.balanceOf(feeRecipient);
        uint256 recipientBefore = token.balanceOf(recipient);

        pool.withdraw(nullifier, proof, root, recipient, address(token), depositAmount);

        assertEq(pool.nullifierSpent(nullifier), true);
        assertEq(token.balanceOf(address(pool)), 0);

        uint256 expectedFee = (depositAmount * WITHDRAW_FEE_BPS) / 10_000;
        uint256 expectedPayout = depositAmount - expectedFee;

        assertEq(token.balanceOf(feeRecipient) - feeRecipientBefore, expectedFee);
        assertEq(token.balanceOf(recipient) - recipientBefore, expectedPayout);
    }

    /// SEC-013: `MAX_WITHDRAW_AMOUNT == 0` is the unlimited sentinel. The pool
    /// built in `setUp` uses it, so the 10_000 withdraw in
    /// `testDepositAndWithdraw` already exercises the uncapped path.
    function testMaxWithdrawZeroIsUnlimited() public view {
        assertEq(pool.MAX_WITHDRAW_AMOUNT(), 0);
    }

    /// SEC-013: a pool built with a non-zero cap rejects any withdraw whose
    /// `amount` exceeds the ceiling — before proof verification, so the gate
    /// holds even with a passing verifier — and permits a withdraw exactly at
    /// the ceiling.
    function testWithdrawRespectsMaxWithdrawCap() public {
        uint256 cap = 5_000;
        VeilPool capped = new VeilPool(
            IGroth16Verifier(address(verifier)),
            IPoseidonHasher(address(hasher)),
            feeRecipient,
            WITHDRAW_FEE_BPS,
            cap
        );
        assertEq(capped.MAX_WITHDRAW_AMOUNT(), cap);

        token.approve(address(capped), type(uint256).max);
        capped.deposit(keccak256("c"), address(token), 10_000);
        bytes32 root = capped.roots(capped.currentRootIndex());
        bytes memory proof = new bytes(256);

        // Above the cap: reverts with AmountExceedsMax even though the shared
        // verifier mock is set to pass (setUp calls verifier.setOk(true)).
        vm.expectRevert(AmountExceedsMax.selector);
        capped.withdraw(keccak256("n1"), proof, root, recipient, address(token), cap + 1);

        // Exactly at the cap: succeeds and marks the nullifier spent.
        capped.withdraw(keccak256("n2"), proof, root, recipient, address(token), cap);
        assertEq(capped.nullifierSpent(keccak256("n2")), true);
    }

    function testDepositRevertsWhenPaused() public {
        pool.pause();

        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        pool.deposit(keccak256("c"), address(token), 10_000);
    }

    function testWithdrawRevertsWhenPaused() public {
        pool.deposit(keccak256("c"), address(token), 10_000);
        bytes32 root = pool.roots(pool.currentRootIndex());
        
        pool.pause();

        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        pool.withdraw(keccak256("n"), new bytes(0), root, recipient, address(token), 10_000);
    }

    function testUpdateFeeRecipient() public {
        address newFeeRecip = address(0x42);
        pool.updateFeeRecipient(newFeeRecip);
        assertEq(pool.feeRecipient(), newFeeRecip);
    }

    function testUpdateFeeRecipientOnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        pool.updateFeeRecipient(address(recipient));
    }

    function testUpdateFeeRecipientRevertsZeroAddress() public {
        vm.expectRevert(InvalidFeeRecipient.selector);
        pool.updateFeeRecipient(address(0));
    }

    function testConstructorReverts() public {
        vm.expectRevert(InvalidVerifier.selector);
        new VeilPool(IGroth16Verifier(address(0)), IPoseidonHasher(address(hasher)), feeRecipient, WITHDRAW_FEE_BPS, 0);

        vm.expectRevert(InvalidHasher.selector);
        new VeilPool(IGroth16Verifier(address(verifier)), IPoseidonHasher(address(0)), feeRecipient, WITHDRAW_FEE_BPS, 0);

        vm.expectRevert(InvalidFeeRecipient.selector);
        new VeilPool(IGroth16Verifier(address(verifier)), IPoseidonHasher(address(hasher)), address(0), WITHDRAW_FEE_BPS, 0);

        vm.expectRevert(InvalidFeeBps.selector);
        new VeilPool(IGroth16Verifier(address(verifier)), IPoseidonHasher(address(hasher)), feeRecipient, 10_001, 0);
    }

    function testUnpause() public {
        pool.pause();
        assertTrue(pool.paused());
        pool.unpause();
        assertFalse(pool.paused());
    }

    function testPauseUnpauseOnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        pool.pause();

        pool.pause();

        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        pool.unpause();
    }
}