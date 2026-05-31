// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title IERC5564Announcer
 * @notice Standard interface for the ERC-5564 Stealth Address Announcer.
 * @dev Senders of stealth payments must call `announce` to allow recipients
 *      to parse their ephemeral public keys from the event logs.
 */
interface IERC5564Announcer {
    /**
     * @dev Emitted when a stealth payment is announced.
     * @param schemeId The integer identifier for the stealth address scheme (e.g., 1 for secp256k1).
     * @param stealthAddress The generated stealth address receiving the funds.
     * @param caller The address that called the announce function.
     * @param ephemeralPubKey The ephemeral public key used to generate the stealth address.
     * @param metadata Additional data (e.g., view tags) to help indexers parse the event.
     */
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    /**
     * @notice Announce a stealth transaction.
     * @param schemeId Identifier for the applied stealth address scheme.
     * @param stealthAddress The address of the recipient.
     * @param ephemeralPubKey Ephemeral public key created by the sender.
     * @param metadata Arbitrary data to attach to the announcement.
     */
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes memory ephemeralPubKey,
        bytes memory metadata
    ) external;
}
