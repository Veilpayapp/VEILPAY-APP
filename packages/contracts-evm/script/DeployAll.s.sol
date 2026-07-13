// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {VeilRegistry} from "../src/VeilRegistry.sol";
import {VeilPool} from "../src/VeilPool.sol";
import {IPoseidonHasher} from "../src/IPoseidonHasher.sol";
import {IGroth16Verifier} from "../src/IGroth16Verifier.sol";

contract DeployAll is Script {
    struct DeploymentAddresses {
        address verifier;
        address registry;
        address pool;
    }

    function run() external returns (DeploymentAddresses memory) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", vm.addr(deployerPrivateKey));
        address poseidonHasher = vm.envOr("POSEIDON_HASHER", address(0));
        uint256 feeBps = vm.envOr("WITHDRAW_FEE_BPS", uint256(0));
        // SEC-013: optional per-withdraw amount cap; 0 = unlimited.
        uint256 maxWithdraw = vm.envOr("MAX_WITHDRAW_AMOUNT", uint256(0));

        vm.startBroadcast(deployerPrivateKey);

        Groth16Verifier verifier = new Groth16Verifier();
        console.log("Groth16Verifier deployed at:", address(verifier));

        VeilRegistry registry = new VeilRegistry();
        console.log("VeilRegistry deployed at:", address(registry));

        VeilPool pool = new VeilPool(IGroth16Verifier(address(verifier)), IPoseidonHasher(poseidonHasher), feeRecipient, feeBps, maxWithdraw);
        console.log("VeilPool deployed at:", address(pool));
        
        vm.stopBroadcast();
        
        console.log("--- Deployment Summary ---");
        console.log("Verifier:", address(verifier));
        console.log("Registry:", address(registry));
        console.log("Pool:", address(pool));
        console.log("Fee Recipient:", feeRecipient);
        
        return DeploymentAddresses({
            verifier: address(verifier),
            registry: address(registry),
            pool: address(pool)
        });
    }
}
