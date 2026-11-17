// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Vm } from "forge-std/Vm.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { ArbExecutor } from "../../src/ArbExecutor.sol";
import { ArbReactive } from "../../src/ArbReactive.sol";
import { BaseFixture } from "./BaseFixture.sol";

/// @dev Simulates the full loop locally: pool event -> react() on Lasna -> callback via proxy -> executor.
abstract contract LoopFixture is BaseFixture {
    uint256 private nextTxHash = 1;
    uint256 private deliveredCallbacks;

    /// @dev Forwards every recorded ReserveUpdate to the Reactive contract, as the network does.
    function _relayLogsToReactive() internal returns (uint256 relayed) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 topic0 = reactive.RESERVE_UPDATE_TOPIC0();
        for (uint256 i = 0; i < logs.length; i++) {
            bool isPool = logs[i].emitter == address(poolA) || logs[i].emitter == address(poolB);
            if (!isPool || uint256(logs[i].topics[0]) != topic0) continue;
            IReactive.LogRecord memory record = IReactive.LogRecord({
                chainId: ORIGIN_CHAIN_ID,
                contractAddress: logs[i].emitter,
                topic0: topic0,
                topic1: uint256(logs[i].topics[1]),
                topic2: 0,
                topic3: 0,
                data: logs[i].data,
                blockNumber: block.number,
                opCode: 2,
                blockHash: 0,
                txHash: nextTxHash++,
                logIndex: i
            });
            vm.prank(SYSTEM_ADDRESS);
            reactive.react(record);
            relayed++;
        }
    }

    /// @dev Delivers pending callbacks through the proxy, as the validators do.
    function _deliverPendingCallbacks() internal returns (uint256 delivered) {
        uint256 total = system.callbackCount();
        for (; deliveredCallbacks < total; deliveredCallbacks++) {
            ISystemContract.CallbackConfiguration_V_1_0 memory callback = system.callbackAt(deliveredCallbacks);
            proxy.deliver(callback.recipient, system.callbackSenders(deliveredCallbacks), callback.payload);
            delivered++;
        }
    }

    function _count(ArbReactive.Decision decision) internal view returns (uint256) {
        return reactive.decisionCounts(decision);
    }

    function _lastOutcome() internal view returns (ArbExecutor.Outcome outcome, uint256 quotedOut, uint256 actualOut) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(executor) || logs[i].topics[0] != ArbExecutor.ArbOutcome.selector) continue;
            (outcome,,,, quotedOut, actualOut,) =
                abi.decode(logs[i].data, (ArbExecutor.Outcome, uint8, uint256, uint256, uint256, uint256, uint256));
            found = true;
        }
        assertTrue(found, "ArbOutcome not found");
    }
}
