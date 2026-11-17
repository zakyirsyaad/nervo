// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { ArbExecutor } from "../src/ArbExecutor.sol";
import { ArbReactive } from "../src/ArbReactive.sol";
import { LoopFixture } from "./utils/LoopFixture.sol";

/// @dev The three demo scenarios through the full local loop.
contract IntegrationTest is LoopFixture {
    function setUp() public {
        _deployCore(false, 0);
        vm.recordLogs();
    }

    function _seedPools(uint256 poolBUsdc) private {
        _addLiquidity(poolA, POOL_WETH, POOL_A_USDC);
        _addLiquidity(poolB, POOL_WETH, poolBUsdc);
    }

    function test_Scenario_OpportunityPersists_ExecutesBothSwapsWithSurplus() public {
        _seedPools(POOL_B_USDC_3060);

        assertEq(_relayLogsToReactive(), 2);
        assertEq(_count(ArbReactive.Decision.SnapshotIncomplete), 1);
        assertEq(_count(ArbReactive.Decision.CallbackRequested), 1);

        assertEq(_deliverPendingCallbacks(), 1);
        uint256 surplus = usdc.balanceOf(address(executor)) - INVENTORY;
        assertApproxEqAbs(surplus, 7.2e6, 0.02e6);
        assertGe(surplus, MIN_SURPLUS);
        assertEq(poolA.sequence(), 2, "buy swap on Pool A");
        assertEq(poolB.sequence(), 2, "sell swap on Pool B");

        // The executor's two swap logs update the snapshot without triggering a new callback.
        assertEq(_relayLogsToReactive(), 2);
        assertEq(_count(ArbReactive.Decision.ExecutorSwap), 2);
        assertEq(system.callbackCount(), 1);
        (uint256 snapshotWeth, uint256 snapshotUsdc,,,,) = reactive.snapshots(address(poolA));
        (uint256 reserveWeth, uint256 reserveUsdc) = poolA.getReserves();
        assertEq(snapshotWeth, reserveWeth);
        assertEq(snapshotUsdc, reserveUsdc);
    }

    function test_Scenario_OpportunityVanishes_CallbackArrivesAndSkips() public {
        _seedPools(POOL_B_USDC_3060);
        _relayLogsToReactive();
        assertEq(system.callbackCount(), 1, "Lasna requests a callback when the candidate is valid");

        // State moves before the callback arrives: selling 0.5 WETH pushes the Pool B price down to about 3,030.
        vm.prank(trader);
        poolB.swap(address(weth), ONE_WETH / 2, 0, trader);
        vm.getRecordedLogs();

        assertEq(_deliverPendingCallbacks(), 1);
        (ArbExecutor.Outcome outcome, uint256 quotedOut, uint256 actualOut) = _lastOutcome();
        assertEq(uint8(outcome), uint8(ArbExecutor.Outcome.SkippedMarginGone));
        assertLt(quotedOut, INPUT + MIN_SURPLUS);
        assertEq(actualOut, 0);
        assertEq(usdc.balanceOf(address(executor)), INVENTORY, "trading balance unchanged");
        assertEq(weth.balanceOf(address(executor)), 0);
        assertEq(poolA.sequence(), 1, "no executor swap");
    }

    function test_Scenario_RejectedOnLasna_NoCallbackRequested() public {
        _seedPools(POOL_B_USDC_3030);

        assertEq(_relayLogsToReactive(), 2);
        assertEq(_count(ArbReactive.Decision.MarginBelowThreshold), 1);
        assertEq(system.callbackCount(), 0);
        assertEq(_deliverPendingCallbacks(), 0);
        assertEq(usdc.balanceOf(address(executor)), INVENTORY);
    }

    function test_Scenario_ReplayedCallbackAfterExecution_IsSkipped() public {
        _seedPools(POOL_B_USDC_3060);
        _relayLogsToReactive();
        _deliverPendingCallbacks();
        uint256 balanceAfter = usdc.balanceOf(address(executor));
        vm.getRecordedLogs();

        ISystemContract.CallbackConfiguration_V_1_0 memory callback = system.callbackAt(0);
        proxy.deliver(callback.recipient, address(reactive), callback.payload);

        (ArbExecutor.Outcome outcome,,) = _lastOutcome();
        assertEq(uint8(outcome), uint8(ArbExecutor.Outcome.SkippedAlreadyExecuted));
        assertEq(usdc.balanceOf(address(executor)), balanceAfter);
    }

    function test_Scenario_TraderSwapOpensGap_TriggersCallbackFromSwapEvent() public {
        _seedPools(POOL_A_USDC); // both pools start at 3,000
        _relayLogsToReactive();
        assertEq(system.callbackCount(), 0);

        // A large buy on Pool B raises its price; this swap event is the trigger.
        vm.prank(trader);
        poolB.swap(address(usdc), 4_000 * ONE_USDC, 0, trader);
        _relayLogsToReactive();
        assertEq(system.callbackCount(), 1);

        _deliverPendingCallbacks();
        assertGe(usdc.balanceOf(address(executor)), INVENTORY + MIN_SURPLUS);
    }
}
