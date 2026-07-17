// SPDX-License-Identifier: GPL-3.0
// Public inputs: [merkleRoot, nullifierHash, recipient, amount, token] — see CIRCUIT_SECURITY.md
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;
import {IGroth16Verifier} from "./IGroth16Verifier.sol";

contract Groth16Verifier is IGroth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 18522149746395203485994693166160553180100138494559993334912444840873549174819;
    uint256 constant alphay  = 12798658131622875055371646659804030495410585803195166994216648725589029229420;
    uint256 constant betax1  = 16918349677213667979830599757859681517955930348002919593212602300592729861868;
    uint256 constant betax2  = 13257763580833197818256968152408922470897421784833656140010359751166901080934;
    uint256 constant betay1  = 3403431003470393141204208544825355888914149593942704610887176107544653208298;
    uint256 constant betay2  = 18029745718858945814892042122303285263850155508454545648567547557878091158979;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 2991182893934917750735854499191402906459882370926604084189766990613002221325;
    uint256 constant deltax2 = 19196310138772585113298945493073212371058974289215462196231418591013585010406;
    uint256 constant deltay1 = 7448551594298120195757543321328653659179482947263181441239458934945291040878;
    uint256 constant deltay2 = 8301897311109680566306712660900932319464298567335882401302632332600698592030;

    
    uint256 constant IC0x = 622294934648243081496643174209184689934604297808822526451878826371002000781;
    uint256 constant IC0y = 16287625798457374555777440120840266077568399778198850083439543245826255802322;
    
    uint256 constant IC1x = 19627254729670966821996072695518420200752697655388446588558175065678914147794;
    uint256 constant IC1y = 12695768340306908121164194678032325533005092374534460376341201466101010386510;
    
    uint256 constant IC2x = 12696644083171859185766963913813266047734178026690268226548200067892735046923;
    uint256 constant IC2y = 16719469673122691093095113311840266849604944411696794037490941372087176161870;
    
    uint256 constant IC3x = 15019515004492255850855462197491300254284257430989592123220751149150207856933;
    uint256 constant IC3y = 15736601465886843982558322474797830689634355680964842733001190519970897756301;
    
    uint256 constant IC4x = 16646170921408537145206510897615423886544811927775346948443552043365996944997;
    uint256 constant IC4y = 7224699419981410141636191860770691406854654191629433346709142558774581331892;
    
    uint256 constant IC5x = 8779532869041372520382137662421319721610163569899165809432957726443252494666;
    uint256 constant IC5y = 11488934484102480478890309626807185465480277860824540893533880670226847683448;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function _verifyProofRaw(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[5] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 
    // VEILPAY_WRAPPER_INJECTED
    // ---- VeilPay Groth16Verifier wrapper (injected by compile.sh) ----
    // Public inputs: [merkleRoot, nullifierHash, recipient, amount, token]
    //   — see design.md §Public input ordering contract /
    //     packages/circuits/docs/CIRCUIT_SECURITY.md
    //
    // The snarkjs-generated `verifyProof(uint[2],uint[2][2],uint[2],uint[N])`
    // is renamed `_verifyProofRaw` by the post-process step so this wrapper
    // can take the canonical public ABI name `verifyProof(bytes, bytes32[])`.

    function verifyProof(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool) {
        if (publicInputs.length != 5) return false;
        if (proof.length == 0) return false;
        try this._decodeAndVerify(proof, publicInputs) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    function _decodeAndVerify(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        uint256[5] memory pub;
        pub[0] = uint256(publicInputs[0]); // merkleRoot
        pub[1] = uint256(publicInputs[1]); // nullifierHash
        pub[2] = uint256(publicInputs[2]); // recipient
        pub[3] = uint256(publicInputs[3]); // amount
        pub[4] = uint256(publicInputs[4]); // token
        // External call so memory args encode to the raw function's calldata params.
        return this._verifyProofRaw(a, b, c, pub);
    }

}
