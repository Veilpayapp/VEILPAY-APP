// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import "../src/StealthAnnouncer.sol";

contract StealthAnnouncerTest is Test {
    StealthAnnouncer public announcer;

    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    function setUp() public {
        announcer = new StealthAnnouncer();
    }

    function test_AnnounceStealthPayment() public {
        uint256 schemeId = 1; // secp256k1
        address stealthAddress = address(0x123);
        bytes memory ephemeralPubKey = hex"04b868600cc1b40209f874c7c88b85cf55bd67634f37803e7c8052a51f04170e5d165dfa3d5cfcc686866ba4772f9dcb336b9332e18ebf4b00350ecb969dc30db0";
        bytes memory metadata = hex"010203"; // Arbitrary view tag

        // Expect the Announcement event to be emitted
        vm.expectEmit(true, true, true, true);
        emit Announcement(
            schemeId,
            stealthAddress,
            address(this), // The caller
            ephemeralPubKey,
            metadata
        );

        announcer.announce(schemeId, stealthAddress, ephemeralPubKey, metadata);
    }

    function testRevert_AnnounceEmptyPubKey() public {
        uint256 schemeId = 1;
        address stealthAddress = address(0x123);
        bytes memory emptyPubKey = new bytes(0);
        bytes memory metadata = hex"";

        vm.expectRevert(StealthAnnouncer.EmptyEphemeralKey.selector);
        announcer.announce(schemeId, stealthAddress, emptyPubKey, metadata);
    }

    function testRevert_AnnounceZeroAddress() public {
        uint256 schemeId = 1;
        address stealthAddress = address(0);
        bytes memory ephemeralPubKey = hex"02";
        bytes memory metadata = hex"";

        vm.expectRevert(StealthAnnouncer.ZeroStealthAddress.selector);
        announcer.announce(schemeId, stealthAddress, ephemeralPubKey, metadata);
    }
}
