// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {VeilRegistry} from "../src/VeilRegistry.sol";

contract VeilRegistryTest is Test {
    VeilRegistry private registry;

    function setUp() public {
        registry = new VeilRegistry();
    }

    function testRegisterDeactivateAndReactivateMerchant() public {
        bytes32 merchantId = keccak256("merchant-1");

        registry.registerMerchant(merchantId, "merchant metadata");
        VeilRegistry.Merchant memory merchant = registry.getMerchant(merchantId);
        assertTrue(merchant.active);

        registry.deactivateMerchant(merchantId);
        merchant = registry.getMerchant(merchantId);
        assertFalse(merchant.active);

        registry.reactivateMerchant(merchantId);
        merchant = registry.getMerchant(merchantId);
        assertTrue(merchant.active);
    }

    function testReactivateMerchantOnlyOwner() public {
        bytes32 merchantId = keccak256("merchant-2");
        registry.registerMerchant(merchantId, "merchant metadata");

        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        registry.reactivateMerchant(merchantId);
    }

    function testDeactivateMerchantOnlyOwner() public {
        bytes32 merchantId = keccak256("merchant-3");
        registry.registerMerchant(merchantId, "merchant metadata");

        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        registry.deactivateMerchant(merchantId);
    }
}