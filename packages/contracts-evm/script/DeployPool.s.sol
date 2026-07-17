// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {VeilPool} from "../src/VeilPool.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {IPoseidonHasher} from "../src/IPoseidonHasher.sol";
import {IGroth16Verifier} from "../src/IGroth16Verifier.sol";

contract DeployPool is Script {
    address public verifierAddress;
    address public feeRecipient;

    function run() external returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        verifierAddress = vm.envAddress("VERIFIER_ADDRESS");
        address depositVerifierAddress = vm.envAddress("DEPOSIT_VERIFIER_ADDRESS");
        feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address poseidonHasher = vm.envOr("POSEIDON_HASHER", address(0));
        uint256 feeBps = vm.envOr("WITHDRAW_FEE_BPS", uint256(0));
        // SEC-013: optional per-withdraw amount cap; 0 = unlimited.
        uint256 maxWithdraw = vm.envOr("MAX_WITHDRAW_AMOUNT", uint256(0));

        vm.startBroadcast(deployerPrivateKey);

        VeilPool pool = new VeilPool(
            IGroth16Verifier(verifierAddress),
            IGroth16Verifier(depositVerifierAddress),
            IPoseidonHasher(poseidonHasher),
            feeRecipient,
            feeBps,
            maxWithdraw
        );

        vm.stopBroadcast();

        console.log("VeilPool deployed at:", address(pool));
        console.log("Withdraw verifier:", verifierAddress);
        console.log("Deposit verifier:", depositVerifierAddress);
        console.log("Fee Recipient:", feeRecipient);
        console.log("Max withdraw (0=unlimited):", maxWithdraw);
        
        return address(pool);
    }
}
