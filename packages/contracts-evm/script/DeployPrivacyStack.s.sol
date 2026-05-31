// SPDX-License-Identifier: MIT
// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
pragma solidity ^0.8.25;

/* -------------------------------------------------------------------------- */
/*                         DeployPrivacyStack.s.sol                           */
/* -------------------------------------------------------------------------- */
/*
 * forge-config: default
 *
 * Deploys the full VeilPay privacy stack (Layer 1) to a target chain in the
 * canonical order required by design.md §packages/contracts-evm:
 *
 *      Groth16Verifier  →  VeilPool(verifier, hasher, feeRecipient, FEE_BPS)
 *                       →  StealthAnnouncer
 *
 * On success — and only after all three constructors return — the script
 * writes `deployments/sepolia.json` (the consumer app's build-time import
 * target) with:
 *
 *   {
 *     "groth16Verifier":  "<address>",
 *     "veilPool":         "<address>",
 *     "stealthAnnouncer": "<address>",
 *     "chainId":          11155111,
 *     "blockNumber":      <block.number>
 *   }
 *
 * Required environment variables (read pre-broadcast so config errors fail
 * before any tx is broadcast):
 *
 *   FEE_RECIPIENT     (address)  — receives WITHDRAW_FEE_BPS of every withdraw.
 *   DEPLOYER_PK       (uint256)  — private key broadcasting the deploys.
 *   POSEIDON_HASHER   (address)  — pre-deployed PoseidonT3-compatible hasher
 *                                  byte-compatible with circomlib's Poseidon
 *                                  (no production-ready Solidity Poseidon
 *                                  ships in this repo; deploy poseidon-solidity
 *                                  separately and supply its address here).
 *
 * Optional:
 *   WITHDRAW_FEE_BPS  (uint256)  — default 25 (0.25%); capped at 10_000.
 *
 * Example invocation:
 *
 *   forge script script/DeployPrivacyStack.s.sol:DeployPrivacyStack \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --broadcast \
 *     --verify
 *
 * Note on checksumming: forge-std v1.8.1 does not expose
 * `vm.toChecksumAddress`, so we emit lowercased 42-char hex addresses via
 * `vm.toString(address)`. They still satisfy the consumer app's
 * `^0x[a-fA-F0-9]{40}$` placeholder gate (see
 * `apps/consumer-app/src/constants/contracts.ts`). TODO: switch to
 * `vm.toChecksumAddress` once forge-std is bumped past v1.7's checksum
 * cheatcode.
 */

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {IGroth16Verifier} from "../src/IGroth16Verifier.sol";
import {IPoseidonHasher} from "../src/IPoseidonHasher.sol";
import {VeilPool} from "../src/VeilPool.sol";
import {StealthAnnouncer} from "../src/StealthAnnouncer.sol";

contract DeployPrivacyStack is Script {
    /// Target chain id baked into `sepolia.json`. The consumer app's
    /// `useNetworkPrivacySupport` hook gates the privacy flows on this
    /// exact value, so it is intentionally a constant rather than
    /// `block.chainid` (the script may run on a fork during dry-runs).
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    /// Default withdraw fee in basis points; matches the design doc's
    /// stated FEE_BPS. Overridable via the `WITHDRAW_FEE_BPS` env var.
    uint256 internal constant DEFAULT_WITHDRAW_FEE_BPS = 25;

    /// Path the consumer app imports at build time
    /// (`apps/consumer-app/src/constants/contracts.ts`). Relative to the
    /// foundry project root (`packages/contracts-evm/`).
    string internal constant DEPLOYMENT_OUT_PATH = "deployments/sepolia.json";

    function run() external returns (
        address verifierAddr,
        address poolAddr,
        address announcerAddr
    ) {
        // ---------------------------------------------------------------- //
        //  Pre-flight: read & validate every env var BEFORE any broadcast. //
        //  A misconfigured deploy must fail fast — no half-deployed stack. //
        // ---------------------------------------------------------------- //
        address feeRecipient   = vm.envAddress("FEE_RECIPIENT");
        uint256 deployerPk     = vm.envUint("DEPLOYER_PK");
        address poseidonHasher = vm.envAddress("POSEIDON_HASHER");
        uint256 feeBps         = vm.envOr("WITHDRAW_FEE_BPS", DEFAULT_WITHDRAW_FEE_BPS);

        require(feeRecipient   != address(0), "FEE_RECIPIENT not set or zero");
        require(deployerPk     != 0,          "DEPLOYER_PK not set or zero");
        require(poseidonHasher != address(0), "POSEIDON_HASHER not set or zero");
        require(feeBps         <= 10_000,     "WITHDRAW_FEE_BPS exceeds 10_000");

        console.log("Deploying privacy stack");
        console.log("  feeRecipient:   ", feeRecipient);
        console.log("  poseidonHasher: ", poseidonHasher);
        console.log("  feeBps:         ", feeBps);

        // ---------------------------------------------------------------- //
        //  Broadcast in the canonical order. If any constructor reverts,   //
        //  Foundry surfaces a non-zero exit and `vm.writeFile` below is    //
        //  never reached, so `sepolia.json` keeps its previous (or zero)   //
        //  contents — the consumer app's `isPrivacyStackConfigured()`     //
        //  gate keeps the privacy flows disabled until a clean re-run.    //
        // ---------------------------------------------------------------- //
        vm.startBroadcast(deployerPk);

        Groth16Verifier verifier = new Groth16Verifier();
        VeilPool pool = new VeilPool(
            IGroth16Verifier(address(verifier)),
            IPoseidonHasher(poseidonHasher),
            feeRecipient,
            feeBps
        );
        StealthAnnouncer announcer = new StealthAnnouncer();

        vm.stopBroadcast();

        verifierAddr  = address(verifier);
        poolAddr      = address(pool);
        announcerAddr = address(announcer);

        console.log("Groth16Verifier:  ", verifierAddr);
        console.log("VeilPool:         ", poolAddr);
        console.log("StealthAnnouncer: ", announcerAddr);

        // ---------------------------------------------------------------- //
        //  Persist deployment manifest. Only reached after all three       //
        //  constructors returned successfully (Requirement 5.4).           //
        // ---------------------------------------------------------------- //
        string memory json = string.concat(
            '{\n  "groth16Verifier": "',  vm.toString(verifierAddr),  '",\n',
            '  "veilPool": "',            vm.toString(poolAddr),      '",\n',
            '  "stealthAnnouncer": "',    vm.toString(announcerAddr), '",\n',
            '  "chainId": ',              vm.toString(SEPOLIA_CHAIN_ID), ',\n',
            '  "blockNumber": ',          vm.toString(block.number),  '\n}'
        );
        vm.writeFile(DEPLOYMENT_OUT_PATH, json);

        console.log("Wrote deployment manifest to", DEPLOYMENT_OUT_PATH);
    }
}
