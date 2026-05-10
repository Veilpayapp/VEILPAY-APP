// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";

contract DeployVerifier is Script {
    function run() external returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        Groth16Verifier verifier = new Groth16Verifier();
        
        vm.stopBroadcast();
        
        console.log("Groth16Verifier deployed at:", address(verifier));
        
        return address(verifier);
    }
}
