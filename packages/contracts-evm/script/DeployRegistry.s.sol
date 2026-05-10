// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {VeilRegistry} from "../src/VeilRegistry.sol";

contract DeployRegistry is Script {
    function run() external returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        VeilRegistry registry = new VeilRegistry();
        
        vm.stopBroadcast();
        
        console.log("VeilRegistry deployed at:", address(registry));
        
        return address(registry);
    }
}
