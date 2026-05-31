// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./IERC5564Announcer.sol";

/**
 * @title StealthAnnouncer
 * @notice Implementation of the ERC-5564 Stealth Address Registry.
 * @dev This is a singleton contract deployed per-chain. It emits `Announcement`
 *      events that off-chain indexers (or on-chain view functions) scan to discover
 *      incoming stealth payments.
 *
 *      Input validation uses named custom errors (cheaper than revert strings and
 *      stable selectors for off-chain decoding):
 *        - EmptyEphemeralKey()    when `ephemeralPubKey.length == 0`
 *        - ZeroStealthAddress()   when `stealthAddress == address(0)`
 */
contract StealthAnnouncer is IERC5564Announcer {
    /// @notice Thrown when `ephemeralPubKey` has zero length.
    error EmptyEphemeralKey();

    /// @notice Thrown when `stealthAddress` is the zero address.
    error ZeroStealthAddress();

    /**
     * @notice Announce a stealth transaction.
     * @param schemeId Identifier for the applied stealth address scheme (e.g. 1 for secp256k1).
     * @param stealthAddress The address of the recipient.
     * @param ephemeralPubKey Ephemeral public key created by the sender.
     * @param metadata Arbitrary data to attach to the announcement.
     */
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes memory ephemeralPubKey,
        bytes memory metadata
    ) external override {
        // Enforce basic validation to prevent spamming empty / null announcements.
        if (ephemeralPubKey.length == 0) revert EmptyEphemeralKey();
        if (stealthAddress == address(0)) revert ZeroStealthAddress();

        // Canonical ERC-5564 event (signature inherited from IERC5564Announcer):
        //   Announcement(uint256 indexed schemeId,
        //                address indexed stealthAddress,
        //                address indexed caller,
        //                bytes ephemeralPubKey,
        //                bytes metadata)
        emit Announcement(
            schemeId,
            stealthAddress,
            msg.sender,
            ephemeralPubKey,
            metadata
        );
    }
}
