// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { ArbReactive } from "../src/ArbReactive.sol";
import { BaseFixture } from "./utils/BaseFixture.sol";

contract ArbReactiveTest is BaseFixture {
    uint256 private constant TX_A = 0xA1;
    uint256 private constant TX_B = 0xB1;

    function setUp() public {
        _deployCore(false, 0);
    }

    function _logA(uint256 sequence, uint256 timestamp, uint256 txHash)
        private
        view
        returns (IReactive.LogRecord memory)
    {
        return _logRecord(address(poolA), trader, POOL_WETH, POOL_A_USDC, sequence, timestamp, txHash);
    }

    function _logB(uint256 reserveUsdc, uint256 sequence, uint256 timestamp, uint256 txHash)
        private
        view
        returns (IReactive.LogRecord memory)
    {
        return _logRecord(address(poolB), trader, POOL_WETH, reserveUsdc, sequence, timestamp, txHash);
    }

    function _expectDecision(
        IReactive.LogRecord memory record,
        ArbReactive.Decision decision,
        uint256 sequence,
        uint8 route,
        uint256 quotedOut,
        uint256 timestamp
    ) private {
        vm.expectEmit(address(reactive));
        emit ArbReactive.DecisionRecorded(
            _opportunityId(record),
            record.contractAddress,
            decision,
            record.txHash,
            record.logIndex,
            sequence,
            route,
            quotedOut,
            timestamp
        );
    }

    function _count(ArbReactive.Decision decision) private view returns (uint256) {
        return reactive.decisionCounts(decision);
    }

    // --- subscription and configuration ---

    function test_Constructor_SubscribesOnlyToBothPoolsOnOriginChain() public view {
        assertEq(system.subscriptionCount(), 2);
        (address subscriber, uint256 chainId, address source, uint256 topic0) = system.subscriptions(0);
        assertEq(subscriber, address(reactive));
        assertEq(chainId, ORIGIN_CHAIN_ID);
        assertEq(source, address(poolA));
        assertEq(topic0, uint256(keccak256("ReserveUpdate(address,uint256,uint256,uint256,uint256)")));
        (,, source,) = system.subscriptions(1);
        assertEq(source, address(poolB));
    }

    function test_Constructor_RevertsOnInvalidConfig() public {
        ArbReactive.Config memory config = _config(false, 0);
        config.poolB = config.poolA;
        vm.expectRevert(ArbReactive.InvalidConfig.selector);
        new ArbReactive(config);

        config = _config(false, 0);
        config.callbackGasLimit = 299_999;
        vm.expectRevert(ArbReactive.InvalidConfig.selector);
        new ArbReactive(config);

        config = _config(false, 0);
        config.inputAmount = 0;
        vm.expectRevert(ArbReactive.InvalidConfig.selector);
        new ArbReactive(config);

        // "Unlimited" values are rejected so react() never overflows and reverts.
        config = _config(false, 0);
        config.maxSnapshotAge = type(uint256).max;
        vm.expectRevert(ArbReactive.InvalidConfig.selector);
        new ArbReactive(config);

        config = _config(false, 0);
        config.minSurplus = type(uint256).max;
        vm.expectRevert(ArbReactive.InvalidConfig.selector);
        new ArbReactive(config);
    }

    function test_React_RevertsWhenCallerIsNotSystemContract() public {
        IReactive.LogRecord memory record = _logA(1, START_TIME, TX_A);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, trader, SYSTEM_ADDRESS));
        reactive.react(record);
    }

    // --- rejection reasons ---

    function test_React_RecordsSnapshotIncompleteUntilBothPoolsReport() public {
        IReactive.LogRecord memory record = _logA(1, START_TIME, TX_A);
        _expectDecision(record, ArbReactive.Decision.SnapshotIncomplete, 1, 0, 0, START_TIME);
        _react(record);

        (uint256 reserveWeth, uint256 reserveUsdc, uint256 sequence, uint256 sourceTimestamp,,) =
            reactive.snapshots(address(poolA));
        assertEq(reserveWeth, POOL_WETH);
        assertEq(reserveUsdc, POOL_A_USDC);
        assertEq(sequence, 1);
        assertEq(sourceTimestamp, START_TIME);
        assertEq(system.callbackCount(), 0);
    }

    function test_React_RecordsUnknownSourceForOtherChainPoolOrTopic() public {
        IReactive.LogRecord memory wrongChain = _logA(1, START_TIME, TX_A);
        wrongChain.chainId = 1;
        IReactive.LogRecord memory wrongPool = _logA(1, START_TIME, TX_A);
        wrongPool.contractAddress = trader;
        IReactive.LogRecord memory wrongTopic = _logA(1, START_TIME, TX_A);
        wrongTopic.topic0 = 123;

        _react(wrongChain);
        _react(wrongPool);
        _react(wrongTopic);

        assertEq(_count(ArbReactive.Decision.UnknownSource), 3);
        (,, uint256 sequence,,,) = reactive.snapshots(address(poolA));
        assertEq(sequence, 0, "snapshot unchanged");
    }

    function test_React_RejectsDuplicateAndLateLogsWithoutTouchingSnapshot() public {
        _react(_logA(2, START_TIME, TX_A));
        _react(_logB(POOL_B_USDC_3030, 1, START_TIME, TX_B));

        IReactive.LogRecord memory duplicate = _logA(2, START_TIME, TX_A);
        _expectDecision(duplicate, ArbReactive.Decision.StaleOrDuplicateLog, 2, 0, 0, START_TIME);
        _react(duplicate);

        IReactive.LogRecord memory late = _logRecord(address(poolA), trader, 1, 1, 1, START_TIME - 5, 0xA0);
        _expectDecision(late, ArbReactive.Decision.StaleOrDuplicateLog, 1, 0, 0, START_TIME - 5);
        _react(late);

        (uint256 reserveWeth,, uint256 sequence,,,) = reactive.snapshots(address(poolA));
        assertEq(reserveWeth, POOL_WETH);
        assertEq(sequence, 2);
        assertEq(_count(ArbReactive.Decision.StaleOrDuplicateLog), 2);
        assertEq(system.callbackCount(), 0);
    }

    function test_React_RecordsSnapshotStaleWhenOtherPoolIsTooOld() public {
        _react(_logA(1, START_TIME, TX_A));
        uint256 lateTime = START_TIME + MAX_SNAPSHOT_AGE + 1;
        IReactive.LogRecord memory record = _logB(POOL_B_USDC_3060, 1, lateTime, TX_B);
        _expectDecision(record, ArbReactive.Decision.SnapshotStale, 1, 0, 0, lateTime);
        _react(record);
        assertEq(system.callbackCount(), 0);
    }

    function test_React_RecordsMarginBelowThresholdAtPrice3030() public {
        _react(_logA(1, START_TIME, TX_A));
        IReactive.LogRecord memory record = _logB(POOL_B_USDC_3030, 1, START_TIME, TX_B);
        (, uint256 expectedQuote) = _quoteAfter(POOL_B_USDC_3030);
        assertApproxEqAbs(expectedQuote, 997.33e6, 0.02e6);

        _expectDecision(record, ArbReactive.Decision.MarginBelowThreshold, 1, 0, expectedQuote, START_TIME);
        _react(record);
        assertEq(system.callbackCount(), 0);
    }

    function test_React_CostBufferRaisesTheBar() public {
        _deployCore(false, 6 * ONE_USDC); // 2 USDC threshold + 6 USDC buffer > 7.20 USDC surplus
        _react(_logA(1, START_TIME, TX_A));
        _react(_logB(POOL_B_USDC_3060, 1, START_TIME, TX_B));
        assertEq(_count(ArbReactive.Decision.MarginBelowThreshold), 1);
        assertEq(system.callbackCount(), 0);
    }

    function test_React_ExecutorSwapUpdatesSnapshotWithoutNewCallback() public {
        _react(_logA(1, START_TIME, TX_A));
        IReactive.LogRecord memory record =
            _logRecord(address(poolB), address(executor), POOL_WETH, POOL_B_USDC_3060, 1, START_TIME, TX_B);
        _expectDecision(record, ArbReactive.Decision.ExecutorSwap, 1, 0, 0, START_TIME);
        _react(record);

        (, uint256 reserveUsdc, uint256 sequence,,,) = reactive.snapshots(address(poolB));
        assertEq(reserveUsdc, POOL_B_USDC_3060);
        assertEq(sequence, 1);
        assertEq(system.callbackCount(), 0);
    }

    // --- callback requests ---

    function test_React_RequestsCallbackAtPrice3060WithFullPayload() public {
        _react(_logA(1, START_TIME, TX_A));
        IReactive.LogRecord memory record = _logB(POOL_B_USDC_3060, 1, START_TIME + 3, TX_B);
        (, uint256 expectedQuote) = _quoteAfter(POOL_B_USDC_3060);
        assertApproxEqAbs(expectedQuote, 1_007.2e6, 0.02e6);

        _expectDecision(record, ArbReactive.Decision.CallbackRequested, 1, 0, expectedQuote, START_TIME + 3);
        _react(record);

        assertEq(system.callbackCount(), 1);
        assertEq(system.callbackSenders(0), address(reactive));
        ISystemContract.CallbackConfiguration_V_1_0 memory callback = system.callbackAt(0);
        assertEq(callback.chainId, ORIGIN_CHAIN_ID);
        assertEq(callback.recipient, address(executor));
        assertEq(callback.gasLimit, CALLBACK_GAS);
        assertEq(
            callback.payload,
            _callbackPayload(_opportunityId(record), 0, INPUT, MIN_SURPLUS, START_TIME + 3 + CALLBACK_TTL)
        );
    }

    function test_React_PicksReverseRouteWhenPoolAIsRicher() public {
        _react(_logB(POOL_A_USDC, 1, START_TIME, TX_B)); // Pool B 3,000
        IReactive.LogRecord memory record =
            _logRecord(address(poolA), trader, POOL_WETH, POOL_B_USDC_3060, 1, START_TIME, TX_A); // Pool A 3,060
        _react(record);

        ISystemContract.CallbackConfiguration_V_1_0 memory callback = system.callbackAt(0);
        assertEq(
            callback.payload, _callbackPayload(_opportunityId(record), 1, INPUT, MIN_SURPLUS, START_TIME + CALLBACK_TTL)
        );
    }

    function test_React_BaselineRequestsCallbackEvenBelowThreshold() public {
        _deployCore(true, 0);
        _react(_logA(1, START_TIME, TX_A));
        _react(_logB(POOL_B_USDC_3030, 1, START_TIME, TX_B));
        assertEq(system.callbackCount(), 1);
        assertEq(_count(ArbReactive.Decision.CallbackRequested), 1);
        assertEq(_count(ArbReactive.Decision.MarginBelowThreshold), 0);
    }

    function test_React_BaselineStillRejectsStructuralCases() public {
        _deployCore(true, 0);
        _react(_logA(1, START_TIME, TX_A));
        _react(_logA(1, START_TIME, TX_A));
        _react(_logRecord(address(poolB), address(executor), POOL_WETH, POOL_B_USDC_3060, 1, START_TIME, TX_B));
        assertEq(system.callbackCount(), 0);
    }

    function test_CoverDebt_PaysSystemContractFromBalance() public {
        vm.deal(address(reactive), 1 ether);
        system.setDebt(address(reactive), 0.3 ether);
        reactive.coverDebt();
        assertEq(SYSTEM_ADDRESS.balance, 0.3 ether);
    }

    function _quoteAfter(uint256 poolBUsdc) private pure returns (uint256 buyBSellA, uint256 buyASellB) {
        buyASellB = _roundTrip(POOL_A_USDC, poolBUsdc);
        buyBSellA = _roundTrip(poolBUsdc, POOL_A_USDC);
    }

    function _roundTrip(uint256 buyUsdc, uint256 sellUsdc) private pure returns (uint256) {
        uint256 inAfterFee = INPUT * (10_000 - FEE_BPS);
        uint256 wethOut = (inAfterFee * POOL_WETH) / (buyUsdc * 10_000 + inAfterFee);
        uint256 wethAfterFee = wethOut * (10_000 - FEE_BPS);
        return (wethAfterFee * sellUsdc) / (POOL_WETH * 10_000 + wethAfterFee);
    }
}
