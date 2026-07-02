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
        feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address poseidonHasher = vm.envOr("POSEIDON_HASHER", address(0));
        uint256 feeBps = vm.envOr("WITHDRAW_FEE_BPS", uint256(0));
        
        vm.startBroadcast(deployerPrivateKey);
        
        VeilPool pool = new VeilPool(IGroth16Verifier(verifierAddress), IPoseidonHasher(poseidonHasher), feeRecipient, feeBps);
        
        vm.stopBroadcast();
        
        console.log("VeilPool deployed at:", address(pool));
        console.log("Verifier:", verifierAddress);
        console.log("Fee Recipient:", feeRecipient);
        
        return address(pool);
    }
}
