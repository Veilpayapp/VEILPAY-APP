// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {VeilRegistry} from "../src/VeilRegistry.sol";
import {VeilPool} from "../src/VeilPool.sol";

contract DeployAll is Script {
    struct DeploymentAddresses {
        address verifier;
        address registry;
        address pool;
    }

    function run() external returns (DeploymentAddresses memory) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", vm.addr(deployerPrivateKey));
        
        vm.startBroadcast(deployerPrivateKey);
        
        Groth16Verifier verifier = new Groth16Verifier();
        console.log("Groth16Verifier deployed at:", address(verifier));
        
        VeilRegistry registry = new VeilRegistry();
        console.log("VeilRegistry deployed at:", address(registry));
        
        VeilPool pool = new VeilPool(address(verifier), feeRecipient);
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
