// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VeilPool
 * @notice Privacy pool for shielded ETH and ERC-20 deposits/withdrawals.
 *
 * ⚠️  AUDIT STATUS: This contract is a PROTOTYPE / placeholder.
 *     Known gaps before mainnet deployment:
 *       1. No incremental Merkle tree — commitments are stored in a flat array.
 *          Merkle root must be included in ZK public inputs.
 *       2. The Groth16 verifier interface must be finalised and audited.
 *       3. No event indexing for commitment sets (required for proof generation).
 *     Do NOT deploy to mainnet without a full security audit.
 */
contract VeilPool is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    event NewCommitment(
        bytes32 indexed commitment,
        address indexed token,
        uint256 amount,
        uint256 leafIndex
    );

    event Withdrawal(
        bytes32 indexed nullifier,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    bytes32 public constant ZERO_VALUE = 0;
    uint32 public constant LEVELS = 30;

    IVerifySignature public verifier;

    bytes32[] public commitments;
    mapping(bytes32 => bool) public nullifierSpent;
    mapping(bytes32 => bool) public commitmentExists; // SC-M1 fix: commitment uniqueness tracking
    mapping(address => uint256) public balances;

    uint256 public constant DEPOSIT_FEE_BPS = 30;
    uint256 public constant WITHDRAW_FEE_BPS = 30;
    address public feeRecipient;

    constructor(address _verifier, address _feeRecipient) Ownable(msg.sender) {
        require(_verifier != address(0), "Invalid verifier");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        verifier = IVerifySignature(_verifier);
        feeRecipient = _feeRecipient;
    }

    function deposit(
        bytes32 _commitment,
        address _token,
        uint256 _amount
    ) external payable whenNotPaused nonReentrant returns (uint256) {
        require(_amount > 0, "Amount must be greater than 0");
        require(_commitment != bytes32(0), "Invalid commitment");
        require(!commitmentExists[_commitment], "Commitment already exists"); // SC-M1 fix

        uint256 fee = (_amount * DEPOSIT_FEE_BPS) / 10000;
        uint256 depositAmount = _amount - fee;

        if (_token == address(0)) {
            require(msg.value == _amount, "Invalid ETH amount");
            if (fee > 0) {
                _sendValue(payable(feeRecipient), fee);
            }
        } else {
            IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
            if (fee > 0) {
                IERC20(_token).safeTransfer(feeRecipient, fee);
            }
        }

        balances[_token] += depositAmount;

    uint256 leafIndex = commitments.length;
    commitments.push(_commitment);
    commitmentExists[_commitment] = true; // SC-M1 fix

        emit NewCommitment(_commitment, _token, depositAmount, leafIndex);

        return leafIndex;
    }

    function withdraw(
        bytes32 _nullifier,
        bytes calldata _proof,
        address _recipient,
        address _token,
        uint256 _amount
    ) external whenNotPaused nonReentrant {
        require(_recipient != address(0), "Invalid recipient");
        require(address(verifier) != address(0), "Verifier unavailable");
        require(!nullifierSpent[_nullifier], "Nullifier already spent");
        require(balances[_token] >= _amount, "Insufficient pool balance");

        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = _nullifier;
        publicInputs[1] = bytes32(uint256(uint160(_recipient)));
        publicInputs[2] = bytes32(uint256(uint160(_token)));
        publicInputs[3] = bytes32(_amount);

        require(verifier.verifyProof(_proof, publicInputs), "Invalid proof");

        nullifierSpent[_nullifier] = true;
        balances[_token] -= _amount;

        uint256 fee = (_amount * WITHDRAW_FEE_BPS) / 10000;
        uint256 withdrawAmount = _amount - fee;

        if (_token == address(0)) {
            _sendValue(payable(feeRecipient), fee);
            _sendValue(payable(_recipient), withdrawAmount);
        } else {
            IERC20(_token).safeTransfer(feeRecipient, fee);
            IERC20(_token).safeTransfer(_recipient, withdrawAmount);
        }

        emit Withdrawal(_nullifier, _recipient, _token, _amount);
    }

    function updateFeeRecipient(address _newFeeRecipient) external onlyOwner {
        require(_newFeeRecipient != address(0), "Invalid fee recipient");
        feeRecipient = _newFeeRecipient;
    }

    function updateVerifier(address _newVerifier) external onlyOwner {
        require(_newVerifier != address(0), "Invalid verifier");
        verifier = IVerifySignature(_newVerifier);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Rescue ETH accidentally sent to the contract via direct transfer.
     *      Only the owner can call this; funds go to feeRecipient.
     *      C3 fix: The previous open `receive()` allowed ETH to be silently locked
     *      because no bookkeeping was performed for untracked deposits.
     */
    function rescueETH() external onlyOwner {
        uint256 trackedBalance = balances[address(0)];
        uint256 contractBalance = address(this).balance;
        if (contractBalance > trackedBalance) {
            _sendValue(payable(feeRecipient), contractBalance - trackedBalance);
        }
    }

    function _sendValue(address payable recipient, uint256 amount) internal {
        if (amount == 0) {
            return;
        }

        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}

interface IVerifySignature {
    function verifyProof(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool);
}
