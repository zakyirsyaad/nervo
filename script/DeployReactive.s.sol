// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { ArbReactive } from "../src/ArbReactive.sol";

/// @notice Deploys the Reactive contract on Lasna. Run it after DeployOrigin.
/// @dev Required env: POOL_A, POOL_B, EXECUTOR, EXPECTED_REACTIVE. The deploy aborts if the resulting
///      address differs from the one already locked into the executor.
contract DeployReactive is Script {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external {
        address expectedReactive = vm.envAddress("EXPECTED_REACTIVE");
        ArbReactive.Config memory config = ArbReactive.Config({
            originChainId: vm.envOr("ORIGIN_CHAIN_ID", BASE_SEPOLIA_CHAIN_ID),
            poolA: vm.envAddress("POOL_A"),
            poolB: vm.envAddress("POOL_B"),
            executor: vm.envAddress("EXECUTOR"),
            inputAmount: vm.envOr("INPUT_AMOUNT", uint256(1_000e6)),
            minSurplus: vm.envOr("MIN_SURPLUS", uint256(2e6)),
            costBuffer: vm.envOr("COST_BUFFER", uint256(0)),
            feeBps: vm.envOr("FEE_BPS", uint256(30)),
            maxSnapshotAge: vm.envOr("MAX_SNAPSHOT_AGE", uint256(1 days)),
            callbackTtl: vm.envOr("CALLBACK_TTL", uint256(60)),
            callbackGasLimit: uint64(vm.envOr("CALLBACK_GAS_LIMIT", uint256(600_000))),
            requestEveryCandidate: vm.envOr("REQUEST_EVERY_CANDIDATE", false)
        });
        uint256 funding = vm.envOr("REACTIVE_FUNDING_WEI", uint256(0));
        address predicted = vm.computeCreateAddress(msg.sender, vm.getNonce(msg.sender));
        require(predicted == expectedReactive, "deployer nonce changed: address does not match the executor");

        vm.startBroadcast();
        ArbReactive reactive = new ArbReactive{ value: funding }(config);
        vm.stopBroadcast();

        console.log("chainId ", block.chainid);
        console.log("REACTIVE", address(reactive));
    }
}
