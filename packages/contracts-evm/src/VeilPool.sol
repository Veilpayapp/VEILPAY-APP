// SPDX-License-Identifier: MIT
// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IGroth16Verifier} from "./IGroth16Verifier.sol";
import {IPoseidonHasher} from "./IPoseidonHasher.sol";

/* -------------------------------------------------------------------------- */
/*                               Custom errors                                */
/* -------------------------------------------------------------------------- */

// Constructor / configuration
error InvalidVerifier();
error InvalidHasher();
error InvalidFeeRecipient();
error InvalidFeeBps();

// Withdraw / deposit semantics (canonical set used by the relayer's
// `Interface.parseError` decoder — see design.md §Error Handling).
error InvalidMerkleRoot();
error InvalidProof();
error NullifierAlreadySpent();
error TreeFull();

// SEC-013: withdrawal amount exceeds the pool's configured per-withdraw cap.
// Part of the relayer's `Interface.parseError` decoder surface.
error AmountExceedsMax();

// Temporary marker until tasks 3.3 / 3.4 land. Provides a clean ABI surface
// for the relayer client and the mobile app to integrate against, instead of
// reverting with no data and confusing downstream error-decoders.
error NotImplemented();

/**
 * @title  VeilPool
 * @notice Privacy pool for shielded ERC-20 deposits and proof-gated
 *         withdrawals. Implements a Tornado-style depth-20 incremental
 *         Merkle tree with a 30-root ring buffer, plus a nullifier-spent
 *         set keyed by `Poseidon(nullifier)`.
 *
 *         Withdrawals are authorized by a Groth16 proof verified against
 *         the canonical public-input layout
 *         `[merkleRoot, nullifierHash, recipient, amount]`.
 *
 * @dev    This task (3.2) wires up storage, errors, the constructor, and
 *         the two helpers `_insert` / `_isKnownRoot`. The public `deposit`
 *         and `withdraw` entry points are intentionally stubs that revert
 *         with `NotImplemented` — tasks 3.3 and 3.4 fill in their bodies.
 *
 *         The contract still inherits `Pausable`, `ReentrancyGuard`, and
 *         `Ownable` because the operational surface (pause / unpause /
 *         re-target fee recipient) is part of the deploy-script flow and
 *         is unchanged by the privacy-stack rewrite.
 *
 *         NOTE on Poseidon: Solidity has no native Poseidon, so the pool
 *         delegates each level-hash to an external `IPoseidonHasher`
 *         contract supplied at construction. Production deployments wire
 *         the deployed address of the `poseidon-solidity` PoseidonT3
 *         contract; tests pass a mock that mirrors the circomlib Poseidon
 *         used inside `withdraw.circom` so the on-chain root and the
 *         off-chain reference tree agree leaf-for-leaf.
 */
contract VeilPool is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    /* ---------------------------------------------------------------------- */
    /*                                Constants                               */
    /* ---------------------------------------------------------------------- */

    /// Tree depth; capacity is 2 ** LEVELS leaves.
    uint256 public constant LEVELS = 20;

    /// Size of the on-chain root ring buffer.
    uint256 public constant ROOT_HISTORY = 30;

    /// BN254 scalar field size (matches circomlib Poseidon's domain).
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// Basis-point divisor for fee math.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /* ---------------------------------------------------------------------- */
    /*                              Configuration                             */
    /* ---------------------------------------------------------------------- */

    /// Withdraw fee in basis points. Configurable at construction; immutable
    /// thereafter so the deploy-time value is auditable from the bytecode.
    uint256 public immutable WITHDRAW_FEE_BPS;

    /// SEC-013: hard ceiling on the `amount` of any single withdrawal, in the
    /// token's smallest unit. Immutable so the deploy-time value is auditable
    /// from the bytecode, mirroring `WITHDRAW_FEE_BPS`. A value of `0` is the
    /// explicit "no cap" sentinel — the check is skipped and withdrawals of any
    /// size are permitted (the pre-SEC-013 behavior). Any non-zero value bounds
    /// the blast radius of a verifier/proof bug (see SEC-007): even a forged
    /// proof can drain at most `MAX_WITHDRAW_AMOUNT` per nullifier.
    uint256 public immutable MAX_WITHDRAW_AMOUNT;

    /// Groth16 verifier — invoked by `withdraw` against the canonical
    /// `[merkleRoot, nullifierHash, recipient, amount]` public-input layout.
    IGroth16Verifier public immutable verifier;

    /// Poseidon-2 hasher used to fold leaves up the Merkle tree on insert.
    /// MUST be byte-compatible with the circomlib Poseidon used in
    /// `withdraw.circom` or roots will silently disagree.
    IPoseidonHasher public immutable hasher;

    /// Receives the bps-scaled fee on each withdrawal.
    address public feeRecipient;

    /* ---------------------------------------------------------------------- */
    /*                              Tree storage                              */
    /* ---------------------------------------------------------------------- */

    /// Right-side sibling of each level along the rightmost path. Tornado-
    /// style: when a leaf is inserted at an even index in level `i`, its
    /// hash is cached here so the next insertion (odd index) can pair with
    /// it without re-walking the tree.
    bytes32[LEVELS] public filledSubtrees;

    /// `zeros[i]` is the Poseidon root of an all-zero subtree of depth `i`.
    /// Pre-computed in the constructor so `_insert` never hashes a
    /// known-zero pair at runtime.
    bytes32[LEVELS] public zeros;

    /// Index of the next leaf to be inserted; equals the current leaf count.
    uint32 public nextLeafIndex;

    /* ---------------------------------------------------------------------- */
    /*                            Root ring buffer                            */
    /* ---------------------------------------------------------------------- */

    /// Last `ROOT_HISTORY` Merkle roots produced by `_insert`. Slot 0 is
    /// seeded in the constructor with the empty-tree root so withdrawals
    /// can succeed against the very first deposit's pre-image (i.e. the
    /// root proved against need not strictly post-date the leaf, only
    /// not pre-date its insertion).
    bytes32[ROOT_HISTORY] public roots;

    /// Index of the most recently written root in `roots`. Advances with
    /// `(currentRootIndex + 1) % ROOT_HISTORY` on every successful insert.
    uint8 public currentRootIndex;

    /// `nullifierSpent[h]` is `true` once a withdrawal with
    /// `nullifierHash == h` has been processed. Prevents double-spends
    /// across the entire pool lifetime.
    mapping(bytes32 => bool) public nullifierSpent;

    /* ---------------------------------------------------------------------- */
    /*                                 Events                                 */
    /* ---------------------------------------------------------------------- */

    event Deposit(
        bytes32 indexed commitment,
        uint32 indexed leafIndex,
        bytes32 merkleRoot,
        address indexed token,
        uint256 amount,
        address depositor
    );

    event Withdrawal(
        bytes32 indexed nullifierHash,
        address indexed recipient,
        address indexed token,
        uint256 amount,
        uint256 fee
    );

    /* ---------------------------------------------------------------------- */
    /*                              Constructor                               */
    /* ---------------------------------------------------------------------- */

    /**
     * @param _verifier        Groth16 verifier contract (post-processed wrapper).
     * @param _hasher          Poseidon-2 hasher contract (byte-compatible with
     *                         the circomlib Poseidon used in the circuit).
     * @param _feeRecipient    Address that collects the per-withdraw bps fee.
     * @param _withdrawFeeBps  Fee in basis points, capped at `BPS_DENOMINATOR`.
     * @param _maxWithdrawAmount  Per-withdraw amount ceiling (SEC-013), in the
     *                            token's smallest unit. `0` disables the cap.
     */
    constructor(
        IGroth16Verifier _verifier,
        IPoseidonHasher _hasher,
        address _feeRecipient,
        uint256 _withdrawFeeBps,
        uint256 _maxWithdrawAmount
    ) Ownable(msg.sender) {
        if (address(_verifier) == address(0)) revert InvalidVerifier();
        if (address(_hasher) == address(0)) revert InvalidHasher();
        if (_feeRecipient == address(0)) revert InvalidFeeRecipient();
        if (_withdrawFeeBps > BPS_DENOMINATOR) revert InvalidFeeBps();

        verifier = _verifier;
        hasher = _hasher;
        feeRecipient = _feeRecipient;
        WITHDRAW_FEE_BPS = _withdrawFeeBps;
        MAX_WITHDRAW_AMOUNT = _maxWithdrawAmount;

        // Pre-compute the all-zero subtree roots for every level and seed
        // `filledSubtrees` so the first insertion's right siblings are the
        // canonical zero values. After the loop, `current` holds the root
        // of an all-zero depth-LEVELS tree, which goes into `roots[0]`.
        bytes32 current = bytes32(0);
        for (uint256 i = 0; i < LEVELS; i++) {
            zeros[i] = current;
            filledSubtrees[i] = current;
            current = _hasher.poseidon([current, current]);
        }
        roots[0] = current;
        // currentRootIndex defaults to 0 — the slot we just wrote.
    }

    /* ---------------------------------------------------------------------- */
    /*                            Operational hooks                           */
    /* ---------------------------------------------------------------------- */

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function updateFeeRecipient(address _newFeeRecipient) external onlyOwner {
        if (_newFeeRecipient == address(0)) revert InvalidFeeRecipient();
        feeRecipient = _newFeeRecipient;
    }

    /* ---------------------------------------------------------------------- */
    /*                          Public entry points                           */
    /* ---------------------------------------------------------------------- */

    /**
     * @notice Deposit `amount` of `token` and insert `commitment` into the tree.
     * @dev    ERC-20 only — native ETH is intentionally not supported in the
     *         privacy pool path (see design.md §VeilPool). The flow is:
     *
     *           1. Pull `amount` of `token` from `msg.sender` via SafeERC20,
     *              which reverts on missing approval, transfer failure, or
     *              non-standard return values.
     *           2. Insert `commitment` into the incremental Merkle tree;
     *              `_insert` reverts with `TreeFull` once `nextLeafIndex`
     *              reaches `2 ** LEVELS` (Requirement 2.11).
     *           3. Emit `Deposit` with the assigned leaf index and the
     *              post-insert root, so off-chain indexers and the mobile
     *              app can persist a `CommitmentRecord` against the same
     *              root the on-chain pool just stamped (Requirement 2.2).
     *
     *         `nonReentrant` guards the external token call; `whenNotPaused`
     *         lets the owner halt new deposits without disturbing the
     *         already-shielded balance.
     */
    function deposit(
        bytes32 commitment,
        address token,
        uint256 amount
    ) external whenNotPaused nonReentrant returns (uint32) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        (uint32 leafIndex, bytes32 newRoot) = _insert(commitment);

        emit Deposit(commitment, leafIndex, newRoot, token, amount, msg.sender);

        return leafIndex;
    }

    /**
     * @notice Withdraw `amount` of `token` to `recipient`, gated by a Groth16
     *         proof against the canonical public-input layout
     *         `[merkleRoot, nullifierHash, recipient, amount]`.
     * @dev    Order of operations follows the CEI pattern: validate root,
     *         check the nullifier-spent set, verify the proof, mark the
     *         nullifier spent, and only then perform external token
     *         transfers. The merkleRoot parameter is the version the
     *         prover proved against and must still live inside the
     *         pool's 30-root ring buffer at execution time.
     *
     *         Public inputs to the verifier are constructed in the
     *         canonical order [merkleRoot, nullifierHash, recipient, amount].
     *         See `IGroth16Verifier` and `withdraw.circom` for the
     *         contract this ordering must match.
     */
    function withdraw(
        bytes32 nullifierHash,
        bytes calldata proof,
        bytes32 merkleRoot,
        address recipient,
        address token,
        uint256 amount
    ) external whenNotPaused nonReentrant {
        // 1. Reject proofs whose merkle root is no longer in the ring buffer
        //    (or has never been seen). `_isKnownRoot` rejects bytes32(0)
        //    up-front so unfilled slots cannot be exploited.
        if (!_isKnownRoot(merkleRoot)) revert InvalidMerkleRoot();

        // 2. Reject already-spent nullifiers up-front to short-circuit the
        //    verifier call (which is the most expensive step in this method).
        if (nullifierSpent[nullifierHash]) revert NullifierAlreadySpent();

        // 2b. SEC-013: enforce the per-withdraw amount ceiling before the
        //     expensive proof verification. `amount` is a bound public input,
        //     so this gate holds regardless of proof validity and bounds the
        //     blast radius of any verifier/proof bug (SEC-007). Skipped when
        //     the cap is the `0` sentinel (unlimited).
        if (MAX_WITHDRAW_AMOUNT != 0 && amount > MAX_WITHDRAW_AMOUNT) {
            revert AmountExceedsMax();
        }

        // 3. Build the public-input array in canonical order and verify.
        //    The order here is load-bearing — it must match the circuit's
        //    `component main { public [merkleRoot, nullifierHash, recipient, amount] }`
        //    declaration and the wrapper in Groth16Verifier.
        bytes32[] memory pub = new bytes32[](4);
        pub[0] = merkleRoot;                                    // merkleRoot
        pub[1] = nullifierHash;                                 // nullifierHash
        pub[2] = bytes32(uint256(uint160(recipient)));          // recipient
        pub[3] = bytes32(amount);                               // amount

        if (!verifier.verifyProof(proof, pub)) revert InvalidProof();

        // 4. Effects: mark the nullifier spent BEFORE any external call
        //    (CEI). A subsequent re-entry through `withdraw` with the same
        //    nullifier hits the check in step 2 and reverts.
        nullifierSpent[nullifierHash] = true;

        // 5. Compute fee split. Integer division truncates toward zero, so
        //    `payout + fee == amount` holds exactly for all (amount, bps).
        uint256 fee = (amount * WITHDRAW_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = amount - fee;

        // 6. Interactions: pay the recipient, then the fee recipient.
        //    `safeTransfer` reverts on failure, which surfaces to the
        //    relayer as a generic transaction-failed revert (the
        //    nullifier-spent state has already been committed to memory
        //    and will be reverted along with the transfer).
        IERC20(token).safeTransfer(recipient, payout);
        if (fee > 0) {
            IERC20(token).safeTransfer(feeRecipient, fee);
        }

        emit Withdrawal(nullifierHash, recipient, token, amount, fee);
    }

    /* ---------------------------------------------------------------------- */
    /*                          Internal Merkle helpers                       */
    /* ---------------------------------------------------------------------- */

    /**
     * @notice Insert a leaf into the incremental Merkle tree.
     * @dev    Tornado-style: walks bottom-up, hashing the leaf with cached
     *         right-siblings (`filledSubtrees`) on odd indices and with
     *         pre-computed `zeros[i]` on even indices. Advances the root
     *         ring buffer.
     * @param  leaf  The commitment hash to insert.
     * @return leafIndex  Index assigned to this leaf (zero-indexed).
     * @return newRoot    Merkle root after this insertion.
     */
    function _insert(bytes32 leaf) internal returns (uint32 leafIndex, bytes32 newRoot) {
        uint32 _nextLeafIndex = nextLeafIndex;
        if (_nextLeafIndex >= uint32(1 << LEVELS)) revert TreeFull();

        uint32 currentIndex = _nextLeafIndex;
        bytes32 currentLevelHash = leaf;
        bytes32 left;
        bytes32 right;

        for (uint256 i = 0; i < LEVELS; i++) {
            if (currentIndex & 1 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hasher.poseidon([left, right]);
            currentIndex >>= 1;
        }

        uint8 newRootIndex = uint8((uint256(currentRootIndex) + 1) % ROOT_HISTORY);
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;

        nextLeafIndex = _nextLeafIndex + 1;
        return (_nextLeafIndex, currentLevelHash);
    }

    /**
     * @notice Returns true iff `root` matches one of the last `ROOT_HISTORY`
     *         non-zero roots stored by the pool.
     * @dev    Walks the ring buffer backwards from `currentRootIndex`. The
     *         zero hash is rejected up-front so an attacker cannot exploit
     *         unfilled ring-buffer slots (which read as `bytes32(0)`).
     */
    function _isKnownRoot(bytes32 root) internal view returns (bool) {
        if (root == bytes32(0)) return false;
        uint8 i = currentRootIndex;
        for (uint256 n = 0; n < ROOT_HISTORY; n++) {
            if (roots[i] == root) return true;
            if (i == 0) {
                i = uint8(ROOT_HISTORY - 1);
            } else {
                i--;
            }
        }
        return false;
    }
}
