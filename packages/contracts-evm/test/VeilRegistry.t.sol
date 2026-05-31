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
        registry.deactivateMerchant(merchantId);

        vm.prank(address(0xBEEF));
        vm.expectRevert("Not merchant owner");
        registry.reactivateMerchant(merchantId);
    }

    function testDeactivateMerchantOnlyOwner() public {
        bytes32 merchantId = keccak256("merchant-3");
        registry.registerMerchant(merchantId, "merchant metadata");

        vm.prank(address(0xBEEF));
        vm.expectRevert("Not merchant owner");
        registry.deactivateMerchant(merchantId);
    }

    function testAdminDeactivateReactivate() public {
        bytes32 merchantId = keccak256("merchant-4");
        registry.registerMerchant(merchantId, "meta");

        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        registry.adminDeactivateMerchant(merchantId);

        registry.adminDeactivateMerchant(merchantId);
        assertFalse(registry.getMerchant(merchantId).active);

        registry.adminReactivateMerchant(merchantId);
        assertTrue(registry.getMerchant(merchantId).active);
    }

    function testPublishViewingKeyReverts() public {
        bytes32 merchantId = keccak256("merchant-5");
        registry.registerMerchant(merchantId, "meta");
        
        registry.publishViewingKey(1, hex"1234");
        assertEq(registry.getViewingKey(merchantId, 1), hex"1234");

        vm.prank(address(0xBEEF));
        vm.expectRevert("Not a merchant");
        registry.publishViewingKey(1, hex"1234");

        registry.deactivateMerchant(merchantId);
        vm.expectRevert("Merchant inactive");
        registry.publishViewingKey(1, hex"1234");
    }

    function testSetChainAddressReverts() public {
        bytes32 merchantId = keccak256("merchant-6");
        registry.registerMerchant(merchantId, "meta");

        registry.setChainAddress(1, address(0x456));
        assertEq(registry.getChainAddress(merchantId, 1), address(0x456));

        vm.prank(address(0xBEEF));
        vm.expectRevert("Not a merchant");
        registry.setChainAddress(1, address(0x456));

        registry.deactivateMerchant(merchantId);
        vm.expectRevert("Merchant inactive");
        registry.setChainAddress(1, address(0x456));
    }

    function testRegisterMerchantReverts() public {
        bytes32 merchantId = keccak256("merchant-7");
        registry.registerMerchant(merchantId, "meta");

        vm.expectRevert("Already registered");
        registry.registerMerchant(keccak256("another"), "meta");

        vm.prank(address(0xBEEF));
        vm.expectRevert("Merchant ID taken");
        registry.registerMerchant(merchantId, "meta2");
    }

    function testUnknownMerchantReverts() public {
        bytes32 unknownId = keccak256("unknown");

        vm.expectRevert("Unknown merchant");
        registry.adminDeactivateMerchant(unknownId);

        vm.expectRevert("Unknown merchant");
        registry.adminReactivateMerchant(unknownId);
    }
}