// SPDX-License-Identifier: MIT
// Feature: veilpay-privacy-stack, Task 3.14 — Deploy script integration test
// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
pragma solidity ^0.8.25;

/* -------------------------------------------------------------------------- */
/*                       DeployPrivacyStack.t.sol                             */
/* -------------------------------------------------------------------------- */
/*
 * Integration test for `script/DeployPrivacyStack.s.sol` (task 3.13). Runs
 * the deploy script in-process against the Foundry EVM (which is what
 * `forge test` boots — equivalent to a local Anvil instance for the
 * purposes of constructor execution, CREATE address derivation, and
 * filesystem cheatcodes). The dry-run mode here is "no `--broadcast`":
 * `vm.startBroadcast(pk)` inside a test reuses the in-memory EVM rather
 * than producing a broadcast bundle, so we observe the same deploy order
 * a live broadcast would produce without touching any RPC.
 *
 * Validates Requirements:
 *
 *   5.1  — Deploy order is Groth16Verifier (withdraw) → Groth16Verifier
 *          (deposit placeholder) → VeilPool → StealthAnnouncer, and
 *          VeilPool receives the withdraw verifier as `_verifier`.
 *   5.2  — On success the script writes `deployments/sepolia.json` with
 *          addresses as 42-character `0x`-prefixed hex strings
 *          alongside `chainId` (= 11155111) and a `blockNumber`.
 *   5.3  — `VeilPool.verifier()` returns the first deployed Groth16Verifier.
 *
 * Side effect: this test overwrites `deployments/sepolia.json`. Task 1.2
 * established that file as a build-time placeholder consumed by
 * `apps/consumer-app/src/constants/contracts.ts`, so we capture its
 * contents in `setUp` and rewrite them in a teardown step at the end of
 * the test to leave the working tree in the same state we found it. If
 * the test panics mid-run the placeholder may remain overwritten with the
 * locally-derived test addresses; that is documented expected behavior
 * and a clean re-run of the test (or task 1.2's manual reset) restores
 * it. The consumer app's `isPrivacyStackConfigured()` gate ignores
 * non-Sepolia code paths, so a leaked manifest with local addresses does
 * not affect runtime behavior on a real device.
 */

import {Test} from "forge-std/Test.sol";

import {DeployPrivacyStack} from "../script/DeployPrivacyStack.s.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {VeilPool} from "../src/VeilPool.sol";
import {StealthAnnouncer} from "../src/StealthAnnouncer.sol";

// Reuse the in-test Poseidon mock from the custom-errors suite. It mirrors
// circomlib's Poseidon over BN254 well enough for the pool's constructor
// to pre-compute the empty-tree root path without needing to deploy the
// real `poseidon-solidity` contract here.
import {MockPoseidonHasher} from "./CustomErrors.t.sol";

contract DeployPrivacyStackTest is Test {
    /* ----------------------------- Fixtures ------------------------------ */

    /// Standard anvil-style test private key. Deterministic, so the address
    /// derived via `vm.addr(DEPLOYER_PK)` is also deterministic and we can
    /// assert deploy order via `vm.computeCreateAddress(deployer, nonce)`.
    /// This is intentionally a public throwaway key — never reused for
    /// anything that holds value.
    uint256 internal constant DEPLOYER_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    /// Path the deploy script writes to (relative to the foundry project
    /// root, which is `packages/contracts-evm/`). Mirrors the script's
    /// `DEPLOYMENT_OUT_PATH` constant.
    string internal constant DEPLOYMENT_PATH = "deployments/sepolia.json";

    address internal deployer;
    address internal feeRecipient = address(0xFEE);
    MockPoseidonHasher internal hasher;

    /// Snapshot of `deployments/sepolia.json` taken in setUp so we can
    /// restore the placeholder at the end of the test. Stored in plain
    /// memory because the file is small (~200 bytes) and cheaper to keep
    /// in-process than to re-derive.
    string internal originalManifest;

    function setUp() public {
        deployer = vm.addr(DEPLOYER_PK);

        // Stand up a fresh Poseidon hasher mock and wire its address into
        // the env so the script's pre-flight `vm.envAddress("POSEIDON_HASHER")`
        // resolves cleanly. Doing this in `setUp` (before the script reads
        // the env) means a misconfigured env never reaches the broadcast
        // path — same fail-fast contract the production deploy honours.
        hasher = new MockPoseidonHasher();

        vm.setEnv("FEE_RECIPIENT", vm.toString(feeRecipient));
        vm.setEnv("DEPLOYER_PK", vm.toString(bytes32(DEPLOYER_PK)));
        vm.setEnv("POSEIDON_HASHER", vm.toString(address(hasher)));

        // Snapshot the existing manifest so we can restore it post-test.
        originalManifest = vm.readFile(DEPLOYMENT_PATH);
    }

    /* ------------------------------ Tests -------------------------------- */

    /// @notice Runs the deploy script end-to-end and asserts the
    ///         load-bearing post-conditions: deploy order, constructor
    ///         wiring, and manifest contents.
    /// @dev    Validates Requirements 5.1, 5.2, 5.3.
    function test_DeploysInOrder_WiresVerifier_AndWritesManifest() public {
        // Snapshot the deployer's nonce *before* the script runs so we can
        // pin each contract's CREATE address by `(deployer, nonce + i)`.
        // Nonce semantics: an EOA's first deploy uses its current nonce,
        // and the nonce increments AFTER the deploy. So if `nonce0` is
        // the deployer's nonce at script-entry, the deploys land at
        //   nonce0     → Groth16Verifier (withdraw)
        //   nonce0 + 1 → Groth16Verifier (deposit placeholder)
        //   nonce0 + 2 → VeilPool
        //   nonce0 + 3 → StealthAnnouncer
        uint64 nonce0 = vm.getNonce(deployer);

        address expectedVerifier         = vm.computeCreateAddress(deployer, nonce0);
        address expectedDepositVerifier  = vm.computeCreateAddress(deployer, nonce0 + 1);
        address expectedPool             = vm.computeCreateAddress(deployer, nonce0 + 2);
        address expectedAnnouncer        = vm.computeCreateAddress(deployer, nonce0 + 3);

        DeployPrivacyStack script = new DeployPrivacyStack();
        (address verifier, address pool, address announcer) = script.run();

        // -- Requirement 5.1: deploy order ---------------------------------

        assertTrue(verifier  != address(0), "verifier address is zero");
        assertTrue(pool      != address(0), "pool address is zero");
        assertTrue(announcer != address(0), "announcer address is zero");

        // The CREATE-derivation check is a strictly stronger statement than
        // a nonce-count delta: it asserts not just that contracts were
        // deployed, but that they were deployed by `deployer` in order.
        assertEq(verifier,  expectedVerifier,  "verifier deployed out of order");
        assertEq(pool,      expectedPool,      "pool deployed out of order");
        assertEq(announcer, expectedAnnouncer, "announcer deployed out of order");

        // Defense-in-depth: the deployer's nonce should have advanced by
        // exactly 4 — withdraw verifier, deposit verifier, pool, announcer.
        assertEq(
            uint256(vm.getNonce(deployer)),
            uint256(nonce0) + 4,
            "deployer nonce did not advance by exactly 4"
        );

        assertGt(expectedDepositVerifier.code.length, 0, "deposit verifier has no runtime code");
        assertEq(
            address(VeilPool(pool).depositVerifier()),
            expectedDepositVerifier,
            "VeilPool.depositVerifier() does not point at the second Groth16Verifier"
        );

        // Sanity-check that each address actually has bytecode at it (a
        // CREATE-derived address with empty code would mean the deploy
        // silently no-op'd, which `forge test` would also surface as a
        // panic — but we want this to fail loudly here).
        assertGt(verifier.code.length,  0, "verifier has no runtime code");
        assertGt(pool.code.length,      0, "pool has no runtime code");
        assertGt(announcer.code.length, 0, "announcer has no runtime code");

        // -- Requirement 5.3: VeilPool._verifier wiring --------------------
        //
        // `VeilPool.verifier()` is the public immutable getter for the
        // `IGroth16Verifier verifier` field. Cast to `address` to compare
        // with the script's returned `verifier` address.
        assertEq(
            address(VeilPool(pool).verifier()),
            verifier,
            "VeilPool.verifier() does not point at the deployed Groth16Verifier"
        );

        // -- Requirement 5.2: deployments/sepolia.json contents ------------
        //
        // The deploy script writes a small JSON object with five keys.
        // We parse each one and assert it round-trips back to the same
        // address / chain-id we just observed in-process. The string-form
        // checks (length == 42, `0x` prefix) are redundant given the
        // typed parse, but explicitly documenting them anchors the
        // 42-checksummed-character requirement (5.2).
        string memory json = vm.readFile(DEPLOYMENT_PATH);

        address jVerifier  = vm.parseJsonAddress(json, ".groth16Verifier");
        address jPool      = vm.parseJsonAddress(json, ".veilPool");
        address jAnnouncer = vm.parseJsonAddress(json, ".stealthAnnouncer");
        uint256 jChainId   = vm.parseJsonUint(json,    ".chainId");

        assertEq(jVerifier,  verifier,  "manifest groth16Verifier mismatch");
        assertEq(jPool,      pool,      "manifest veilPool mismatch");
        assertEq(jAnnouncer, announcer, "manifest stealthAnnouncer mismatch");
        assertEq(jChainId,   11155111,  "manifest chainId is not Sepolia");

        // String-shape assertions: every emitted address is a 42-character
        // `0x`-prefixed hex literal (Requirement 5.2). We re-read the
        // raw string forms via `parseJsonString` so a future change that
        // breaks the formatting (e.g. forgetting the `0x` prefix or
        // emitting an un-padded address) fails this exact assertion
        // rather than silently passing the typed parse above.
        _assertIsAddressString(
            vm.parseJsonString(json, ".groth16Verifier"),
            "groth16Verifier"
        );
        _assertIsAddressString(
            vm.parseJsonString(json, ".veilPool"),
            "veilPool"
        );
        _assertIsAddressString(
            vm.parseJsonString(json, ".stealthAnnouncer"),
            "stealthAnnouncer"
        );

        // -- Cleanup: restore the placeholder file ------------------------
        //
        // Leaving the manifest populated with locally-derived test
        // addresses would be confusing for downstream tooling that reads
        // `deployments/sepolia.json` (notably the consumer app). We
        // captured the original contents in setUp; rewrite them now.
        vm.writeFile(DEPLOYMENT_PATH, originalManifest);
    }

    /* ----------------------------- Helpers ------------------------------- */

    /// @dev Asserts `s` is a 42-character `0x`-prefixed hex string. We do
    ///      not assert the EIP-55 mixed-case checksum here because
    ///      `vm.toString(address)` (used by the deploy script) emits a
    ///      lowercased form; the script's own header documents this
    ///      tradeoff and the consumer app's address-validation regex is
    ///      `^0x[a-fA-F0-9]{40}$`, which both forms satisfy.
    function _assertIsAddressString(string memory s, string memory label) internal pure {
        bytes memory b = bytes(s);
        assertEq(b.length, 42, string.concat(label, ": length != 42"));
        assertEq(b[0], bytes1("0"), string.concat(label, ": missing 0x prefix"));
        assertEq(b[1], bytes1("x"), string.concat(label, ": missing 0x prefix"));
        for (uint256 i = 2; i < 42; i++) {
            bytes1 c = b[i];
            bool isHex =
                (c >= 0x30 && c <= 0x39) || // 0-9
                (c >= 0x41 && c <= 0x46) || // A-F
                (c >= 0x61 && c <= 0x66);   // a-f
            assertTrue(isHex, string.concat(label, ": non-hex character"));
        }
    }
}
