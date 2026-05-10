// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {VeilPool} from "../src/VeilPool.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";

contract DeployPool is Script {
    address public verifierAddress;
    address public feeRecipient;

    function run() external returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        verifierAddress = vm.envAddress("VERIFIER_ADDRESS");
        feeRecipient = vm.envAddress("FEE_RECIPIENT");
        
        vm.startBroadcast(deployerPrivateKey);
        
        VeilPool pool = new VeilPool(verifierAddress, feeRecipient);
        
        vm.stopBroadcast();
        
        console.log("VeilPool deployed at:", address(pool));
        console.log("Verifier:", verifierAddress);
        console.log("Fee Recipient:", feeRecipient);
        
        return address(pool);
    }
}
