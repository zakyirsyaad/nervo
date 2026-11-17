// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Scenario } from "../script/Scenario.s.sol";
import { ArbExecutor } from "../src/ArbExecutor.sol";
import { ArbReactive } from "../src/ArbReactive.sol";
import { LoopFixture } from "./utils/LoopFixture.sol";

/// @dev Exposes the scenario script's internal actions so the test can run them as the pool owner.
contract ScenarioHarness is Scenario {
    function seedNow(Context memory c) external {
        _seed(c);
    }

    function neutralizeNow(Context memory c) external {
        _neutralize(c);
    }

    function persistNow(Context memory c) external {
        _persist(c);
    }

    function vanishNow(Context memory c) external {
        _vanish(c);
    }

    function rejectNow(Context memory c) external {
        _reject(c);
    }

    function moveNow(Context memory c, uint256 gapBps) external {
        _movePoolBToGap(c, gapBps);
    }
}

/// @dev Runs the scenario script against the full local loop: pool -> Lasna -> proxy -> executor.
contract ScenarioTest is LoopFixture {
    ScenarioHarness private harness;
    Scenario.Context private context;

    function setUp() public {
        _deployCore(false, 0);
        harness = new ScenarioHarness();
        context = Scenario.Context(poolA, poolB, executor, IERC20(address(weth)), IERC20(address(usdc)));
        poolA.transferOwnership(address(harness));
        poolB.transferOwnership(address(harness));
        weth.mint(address(harness), 10_000 * ONE_WETH);
        usdc.mint(address(harness), 30_000_000 * ONE_USDC);

        vm.recordLogs();
        harness.seedNow(context);
        _relayLogsToReactive();
    }

    function _gapBps() private view returns (uint256) {
        (uint256 aWeth, uint256 aUsdc) = poolA.getReserves();
        (uint256 bWeth, uint256 bUsdc) = poolB.getReserves();
        return (bUsdc * aWeth * 10_000) / (bWeth * aUsdc) - 10_000;
    }

    function test_Seed_FillsBothPoolsAtEqualPriceWithoutCallback() public view {
        (uint256 aWeth, uint256 aUsdc) = poolA.getReserves();
        (uint256 bWeth, uint256 bUsdc) = poolB.getReserves();
        assertEq(aWeth, POOL_WETH);
        assertEq(aUsdc, POOL_A_USDC);
        assertEq(bWeth, POOL_WETH);
        assertEq(bUsdc, POOL_A_USDC);
        assertEq(_count(ArbReactive.Decision.SnapshotIncomplete), 1);
        assertEq(_count(ArbReactive.Decision.MarginBelowThreshold), 1);
        assertEq(system.callbackCount(), 0);
    }

    function test_MovePoolBToGap_LandsNearTargetInBothDirections() public {
        harness.moveNow(context, 200);
        assertApproxEqAbs(_gapBps(), 200, 2);
        harness.moveNow(context, 100);
        assertApproxEqAbs(_gapBps(), 100, 2);
        harness.moveNow(context, 0);
        assertApproxEqAbs(_gapBps(), 0, 2);
    }

    function test_Persist_OneSwapLeadsToExecutedArbitrage() public {
        harness.persistNow(context);

        assertEq(_relayLogsToReactive(), 1, "one trigger swap event");
        assertEq(_count(ArbReactive.Decision.CallbackRequested), 1);
        assertEq(_deliverPendingCallbacks(), 1);

        (ArbExecutor.Outcome outcome, uint256 quotedOut, uint256 actualOut) = _lastOutcome();
        assertEq(uint8(outcome), uint8(ArbExecutor.Outcome.Executed));
        assertEq(actualOut, quotedOut);
        assertGe(usdc.balanceOf(address(executor)), INVENTORY + MIN_SURPLUS);
    }

    function test_Vanish_CallbackIsRequestedThenSkippedOnArrival() public {
        harness.vanishNow(context);

        // Lasna receives two logs in order: the first is viable, the second is already below the threshold.
        assertEq(_relayLogsToReactive(), 2);
        assertEq(_count(ArbReactive.Decision.CallbackRequested), 1);
        assertEq(_count(ArbReactive.Decision.MarginBelowThreshold), 2, "seed + reverse swap");

        assertEq(_deliverPendingCallbacks(), 1);
        (ArbExecutor.Outcome outcome,, uint256 actualOut) = _lastOutcome();
        assertEq(uint8(outcome), uint8(ArbExecutor.Outcome.SkippedMarginGone));
        assertEq(actualOut, 0);
        assertEq(usdc.balanceOf(address(executor)), INVENTORY);
    }

    function test_Reject_NoCallbackIsRequested() public {
        harness.rejectNow(context);

        assertEq(_relayLogsToReactive(), 1);
        assertEq(_count(ArbReactive.Decision.CallbackRequested), 0);
        assertEq(_count(ArbReactive.Decision.MarginBelowThreshold), 2, "seed + trigger swap");
        assertEq(_deliverPendingCallbacks(), 0);
    }

    function test_Neutralize_ClosesGapWithOneEventAndNoCallback() public {
        harness.persistNow(context);
        _relayLogsToReactive();
        _deliverPendingCallbacks();
        _relayLogsToReactive(); // the executor's two swap logs

        harness.neutralizeNow(context);
        assertEq(_relayLogsToReactive(), 1, "one event, not two");
        assertEq(system.callbackCount(), 1, "no new callback");
        (uint256 aWeth, uint256 aUsdc) = poolA.getReserves();
        (uint256 bWeth, uint256 bUsdc) = poolB.getReserves();
        assertEq(aWeth, bWeth);
        assertEq(aUsdc, bUsdc);
    }

    function test_AllScenariosInSequence_EachStartsFromNeutralState() public {
        harness.persistNow(context);
        _relayLogsToReactive();
        _deliverPendingCallbacks();
        _relayLogsToReactive();
        harness.neutralizeNow(context);
        _relayLogsToReactive();

        harness.vanishNow(context);
        _relayLogsToReactive();
        _deliverPendingCallbacks();
        harness.neutralizeNow(context);
        _relayLogsToReactive();

        harness.rejectNow(context);
        _relayLogsToReactive();
        _deliverPendingCallbacks();

        assertEq(system.callbackCount(), 2, "only persist and vanish request a callback");
        assertEq(_count(ArbReactive.Decision.ExecutorSwap), 2);
        uint256 surplus = usdc.balanceOf(address(executor)) - INVENTORY;
        assertGe(surplus, MIN_SURPLUS);
        assertLt(surplus, 20 * ONE_USDC, "only one arbitrage was executed");
    }
}
