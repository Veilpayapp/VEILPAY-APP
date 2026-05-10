// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VeilRegistry is Ownable {
    event MerchantRegistered(
        bytes32 indexed merchantId,
        address indexed owner,
        string metadata
    );

    event ViewingKeyPublished(
        bytes32 indexed merchantId,
        uint256 indexed chainId,
        bytes viewingKey
    );

    event ChainAddressAdded(
        bytes32 indexed merchantId,
        uint256 indexed chainId,
        address settlementAddress
    );

    struct Merchant {
        address owner;
        string metadata;
        bool active;
        uint256 registeredAt;
    }

    mapping(bytes32 => Merchant) public merchants;
    mapping(bytes32 => mapping(uint256 => bytes)) public viewingKeys;
    mapping(bytes32 => mapping(uint256 => address)) public chainAddresses;
    mapping(address => bytes32) public ownerToMerchant;

    constructor() Ownable(msg.sender) {}

    function registerMerchant(
        bytes32 _merchantId,
        string calldata _metadata
    ) external returns (bytes32) {
        require(
            ownerToMerchant[msg.sender] == bytes32(0),
            "Already registered"
        );
        require(
            merchants[_merchantId].owner == address(0),
            "Merchant ID taken"
        );

        merchants[_merchantId] = Merchant({
            owner: msg.sender,
            metadata: _metadata,
            active: true,
            registeredAt: block.timestamp
        });

        ownerToMerchant[msg.sender] = _merchantId;

        emit MerchantRegistered(_merchantId, msg.sender, _metadata);

        return _merchantId;
    }

    function publishViewingKey(
        uint256 _chainId,
        bytes calldata _viewingKey
    ) external {
        bytes32 merchantId = ownerToMerchant[msg.sender];
        require(merchantId != bytes32(0), "Not a merchant");
        require(merchants[merchantId].active, "Merchant inactive");

        viewingKeys[merchantId][_chainId] = _viewingKey;

        emit ViewingKeyPublished(merchantId, _chainId, _viewingKey);
    }

    function setChainAddress(
        uint256 _chainId,
        address _settlementAddress
    ) external {
        bytes32 merchantId = ownerToMerchant[msg.sender];
        require(merchantId != bytes32(0), "Not a merchant");
        require(merchants[merchantId].active, "Merchant inactive");

        chainAddresses[merchantId][_chainId] = _settlementAddress;

        emit ChainAddressAdded(merchantId, _chainId, _settlementAddress);
    }

    function deactivateMerchant(bytes32 _merchantId) external {
        require(
            merchants[_merchantId].owner == msg.sender,
            "Not merchant owner"
        );
        merchants[_merchantId].active = false;
    }

    function reactivateMerchant(bytes32 _merchantId) external {
        require(
            merchants[_merchantId].owner == msg.sender,
            "Not merchant owner"
        );
        require(merchants[_merchantId].owner != address(0), "Unknown merchant");
        merchants[_merchantId].active = true;
    }

    function getMerchant(
        bytes32 _merchantId
    ) external view returns (Merchant memory) {
        return merchants[_merchantId];
    }

    function getViewingKey(
        bytes32 _merchantId,
        uint256 _chainId
    ) external view returns (bytes memory) {
        return viewingKeys[_merchantId][_chainId];
    }

    function getChainAddress(
        bytes32 _merchantId,
        uint256 _chainId
    ) external view returns (address) {
        return chainAddresses[_merchantId][_chainId];
    }

    // SC-M2 fix: admin functions for merchant management
    function adminDeactivateMerchant(bytes32 _merchantId) external onlyOwner {
        require(merchants[_merchantId].owner != address(0), "Unknown merchant");
        merchants[_merchantId].active = false;
    }

    function adminReactivateMerchant(bytes32 _merchantId) external onlyOwner {
        require(merchants[_merchantId].owner != address(0), "Unknown merchant");
        merchants[_merchantId].active = true;
    }
}
