// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { IArbPool } from "../../src/interfaces/IArbPool.sol";
import { OrderBook } from "../../src/orders/OrderBook.sol";
import { OrderReactive } from "../../src/orders/OrderReactive.sol";
import { OrderFixture } from "../utils/OrderFixture.sol";

contract OrderReactiveTest is OrderFixture {
    uint256 private constant PRICE_2900 = 2_900 * ONE_USDC;
    OrderBook.Condition private constant BELOW = OrderBook.Condition.PriceAtOrBelow;
    OrderBook.Condition private constant ABOVE = OrderBook.Condition.PriceAtOrAbove;

    uint256 private nextSequence = 1;

    function setUp() public {
        _deployOrders();
    }

    /// @dev Decodes an executeOrder payload; external so the selector can be sliced off calldata.
    function decodeExecutePayload(bytes calldata payload)
        external
        pure
        returns (address sender, uint256 orderId, uint256 price, uint256 sourceTimestamp)
    {
        return abi.decode(payload[4:], (address, uint256, uint256, uint256));
    }

    function _callbackOrderId(uint256 index) private view returns (uint256 orderId) {
        (, orderId,,) = this.decodeExecutePayload(system.callbackAt(index).payload);
    }

    /// @dev Sends the next in-sequence price log at START_TIME and returns the ids of the orders it triggered.
    function _pushPrice(uint256 price) private returns (uint256[] memory triggeredIds) {
        return _pushPriceAt(price, START_TIME);
    }

    function _pushPriceAt(uint256 price, uint256 sourceTimestamp) private returns (uint256[] memory triggeredIds) {
        uint256 before = system.callbackCount();
        _react(_priceLog(price, nextSequence++, sourceTimestamp));
        uint256 total = system.callbackCount();
        triggeredIds = new uint256[](total - before);
        for (uint256 i = before; i < total; i++) {
            triggeredIds[i - before] = _callbackOrderId(i);
        }
    }

    function _expectMirrored(uint256 orderId, OrderReactive.MirrorState state, OrderReactive.MirrorReason reason)
        private
    {
        vm.expectEmit(address(reactive));
        emit OrderReactive.OrderMirrored(orderId, state, reason);
    }

    function _expectIgnored(IReactive.LogRecord memory record, OrderReactive.IgnoreReason reason) private {
        vm.expectEmit(address(reactive));
        emit OrderReactive.LogIgnored(
            reason, record.chainId, record.contractAddress, record.topic0, record.txHash, record.logIndex
        );
    }

    function _assertIds(uint256[] memory actual, uint256[] memory expected) private pure {
        assertEq(actual.length, expected.length, "id count");
        for (uint256 i = 0; i < expected.length; i++) {
            assertEq(actual[i], expected[i]);
        }
    }

    function _ids(uint256 a) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _ids(uint256 a, uint256 b) private pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        (ids[0], ids[1]) = (a, b);
    }

    function _ids(uint256 a, uint256 b, uint256 c) private pure returns (uint256[] memory ids) {
        ids = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (a, b, c);
    }

    function _none() private pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function _slippageCount(uint256 orderId) private view returns (uint256) {
        return reactive.getOrder(orderId).slippageCount;
    }

    function _attempts(uint256 orderId) private view returns (uint256) {
        return reactive.getOrder(orderId).attempts;
    }

    function _pendingSince(uint256 orderId) private view returns (uint256) {
        return reactive.getOrder(orderId).pendingSince;
    }

    // --- subscription and configuration ---

    function test_Constructor_SubscribesToExactlyFourStreams() public view {
        assertEq(system.subscriptionCount(), 4);
        _assertSubscription(
            0, PRICE_CHAIN_ID, address(pricePool), "ReserveUpdate(address,uint256,uint256,uint256,uint256)"
        );
        _assertSubscription(
            1,
            ORDER_CHAIN_ID,
            address(book),
            "OrderPlaced(uint256,address,address,uint256,uint8,uint256,uint256,uint64)"
        );
        _assertSubscription(2, ORDER_CHAIN_ID, address(book), "OrderCancelled(uint256)");
        _assertSubscription(
            3, ORDER_CHAIN_ID, address(book), "OrderOutcome(uint256,uint8,uint256,uint256,uint256,uint256)"
        );

        assertEq(reactive.RESERVE_UPDATE_TOPIC0(), uint256(IArbPool.ReserveUpdate.selector));
        assertEq(reactive.ORDER_PLACED_TOPIC0(), uint256(OrderBook.OrderPlaced.selector));
        assertEq(reactive.ORDER_CANCELLED_TOPIC0(), uint256(OrderBook.OrderCancelled.selector));
        assertEq(reactive.ORDER_OUTCOME_TOPIC0(), uint256(OrderBook.OrderOutcome.selector));
        assertEq(reactive.PRICE_CHAIN_ID(), PRICE_CHAIN_ID);
        assertEq(reactive.PRICE_POOL(), address(pricePool));
        assertEq(reactive.ORDER_CHAIN_ID(), ORDER_CHAIN_ID);
        assertEq(reactive.ORDER_BOOK(), address(book));
        assertEq(reactive.CALLBACK_GAS_LIMIT(), CALLBACK_GAS);
        assertEq(reactive.MAX_TRIGGERS_PER_LOG(), MAX_TRIGGERS);
    }

    function _assertSubscription(uint256 index, uint256 chainId, address source, string memory signature) private view {
        (address subscriber, uint256 subscribedChain, address subscribedSource, uint256 topic0) =
            system.subscriptions(index);
        assertEq(subscriber, address(reactive));
        assertEq(subscribedChain, chainId);
        assertEq(subscribedSource, source);
        assertEq(topic0, uint256(keccak256(bytes(signature))), signature);
    }

    function test_Constructor_RevertsOnInvalidConfig() public {
        OrderReactive.Config memory config = _config();
        config.pricePool = address(0);
        vm.expectRevert(OrderReactive.InvalidConfig.selector);
        new OrderReactive(config);

        config = _config();
        config.orderBook = address(0);
        vm.expectRevert(OrderReactive.InvalidConfig.selector);
        new OrderReactive(config);

        config = _config();
        config.orderChainId = PRICE_CHAIN_ID;
        config.orderBook = address(pricePool);
        vm.expectRevert(OrderReactive.InvalidConfig.selector);
        new OrderReactive(config);

        config = _config();
        config.callbackGasLimit = 299_999;
        vm.expectRevert(OrderReactive.InvalidConfig.selector);
        new OrderReactive(config);

        config = _config();
        config.maxTriggersPerLog = 0;
        vm.expectRevert(OrderReactive.InvalidConfig.selector);
        new OrderReactive(config);

        config = _config();
        config.maxTriggersPerLog = 11;
        vm.expectRevert(OrderReactive.InvalidConfig.selector);
        new OrderReactive(config);

        config = _config();
        config.maxTriggersPerLog = 10;
        new OrderReactive(config);
    }

    function test_React_RevertsWhenCallerIsNotSystemContract() public {
        IReactive.LogRecord memory record = _placedLog(1, BELOW, PRICE_2900);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, trader, SYSTEM_ADDRESS));
        reactive.react(record);
    }

    // --- mirroring the order book ---

    function test_React_MirrorsPlacedOrderAsOpenAndTracked() public {
        _expectMirrored(1, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.Placed);
        _react(_placedLog(1, ABOVE, 3_200 * ONE_USDC));

        OrderReactive.MirroredOrder memory order = reactive.getOrder(1);
        assertEq(order.owner, alice, "owner decoded from topic2");
        assertEq(order.expiry, START_TIME + ORDER_TTL, "expiry decoded from the data");
        assertEq(order.slippageCount, 0);
        assertEq(order.attempts, 0);
        assertEq(order.pendingSince, 0);
        assertEq(reactive.trackedPerOwner(alice), 1);
        assertEq(uint8(order.condition), uint8(ABOVE));
        assertEq(uint8(order.state), uint8(OrderReactive.MirrorState.Open));
        assertEq(order.triggerPrice, 3_200 * ONE_USDC);
        assertTrue(reactive.isTracked(1));
        assertEq(reactive.trackedCount(), 1);
        assertEq(system.callbackCount(), 0, "placement alone never triggers");
    }

    function test_React_DuplicateOrLatePlacementChangesNothing() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        _expectMirrored(1, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.NoChange);
        _react(_placedLog(1, ABOVE, 1));
        OrderReactive.MirroredOrder memory order = reactive.getOrder(1);
        assertEq(uint8(order.condition), uint8(BELOW));
        assertEq(order.triggerPrice, PRICE_2900);
        assertEq(reactive.trackedCount(), 1);

        // A placement that arrives after the order was closed never resurrects it.
        _react(_cancelledLog(2));
        _expectMirrored(2, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.NoChange);
        _react(_placedLog(2, BELOW, PRICE_2900));
        assertFalse(reactive.isTracked(2));
    }

    function test_React_CancelClosesAndUntracksOrder() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Cancelled);
        _react(_cancelledLog(1));

        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Closed));
        assertFalse(reactive.isTracked(1));
        assertEq(reactive.trackedCount(), 0);
        _assertIds(_pushPrice(PRICE_2900), _none());
    }

    function test_React_TerminalOutcomesCloseAndUntrackOrders() public {
        _mirrorPlaced(1, 3, BELOW, PRICE_2900);
        _assertIds(_pushPrice(PRICE_2900), _ids(1, 2, 3));

        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Filled);
        _react(_outcomeLog(1, OrderBook.Outcome.Filled));
        _expectMirrored(2, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.NotOpen);
        _react(_outcomeLog(2, OrderBook.Outcome.SkippedNotOpen));
        _expectMirrored(3, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Expired);
        _react(_outcomeLog(3, OrderBook.Outcome.SkippedExpired));

        assertEq(reactive.trackedCount(), 0);
        _assertIds(_pushPrice(2_800 * ONE_USDC), _none());
    }

    function test_React_SlippageOutcomeRearmsPendingOrder() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        _assertIds(_pushPrice(PRICE_2900), _ids(1));
        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Pending));

        _expectMirrored(1, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.Rearmed);
        _react(_outcomeLog(1, OrderBook.Outcome.SkippedSlippage));
        assertTrue(reactive.isTracked(1));

        _assertIds(_pushPrice(2_890 * ONE_USDC), _ids(1));
    }

    function test_React_SlippageOutcomeForOrderThatIsNotPendingChangesNothing() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        _expectMirrored(1, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.NoChange);
        _react(_outcomeLog(1, OrderBook.Outcome.SkippedSlippage));
        assertEq(_slippageCount(1), 0, "only counted while Pending");

        _react(_cancelledLog(1));
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.NoChange);
        _react(_outcomeLog(1, OrderBook.Outcome.SkippedSlippage));
        _assertIds(_pushPrice(PRICE_2900), _none());
    }

    function test_React_CancelWhilePendingClosesAndTheLateOutcomeIsHarmless() public {
        _mirrorPlaced(1, 2, BELOW, PRICE_2900);
        _pushPrice(PRICE_2900);
        _react(_cancelledLog(1));
        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Closed));

        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.NotOpen);
        _react(_outcomeLog(1, OrderBook.Outcome.SkippedNotOpen));
        _assertIds(reactive.trackedIds(), _ids(2));
    }

    // --- trigger conditions ---

    function test_React_StopLossTriggersAtAndBelowItsPriceButNotAbove() public {
        _react(_placedLog(1, BELOW, PRICE_2900 - 1)); // price is above the trigger
        _react(_placedLog(2, BELOW, PRICE_2900)); // at
        _react(_placedLog(3, BELOW, PRICE_2900 + 1)); // price is below the trigger
        _assertIds(_pushPrice(PRICE_2900), _ids(2, 3));
        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Open));
    }

    function test_React_TakeProfitTriggersAtAndAboveItsPriceButNotBelow() public {
        _react(_placedLog(1, ABOVE, PRICE_2900 - 1)); // price is above the trigger
        _react(_placedLog(2, ABOVE, PRICE_2900)); // at
        _react(_placedLog(3, ABOVE, PRICE_2900 + 1)); // price is below the trigger
        _assertIds(_pushPrice(PRICE_2900), _ids(1, 2));
        assertEq(uint8(_mirrorState(3)), uint8(OrderReactive.MirrorState.Open));
    }

    function test_React_LimitBuyTriggersAtAndBelowItsPriceButNotAbove() public {
        uint256 spend = 2_900 * ONE_USDC;
        _react(_placedLogFor(1, address(usdc), spend, BELOW, PRICE_2900 - 1));
        _react(_placedLogFor(2, address(usdc), spend, BELOW, PRICE_2900));
        _react(_placedLogFor(3, address(usdc), spend, BELOW, PRICE_2900 + 1));
        _assertIds(_pushPrice(PRICE_2900), _ids(2, 3));
        _assertIds(_pushPrice(PRICE_2900 - 1), _ids(1));
    }

    function test_React_TriggerRequestsCallbackWithFullPayload() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        IReactive.LogRecord memory record = _priceLog(PRICE_2900, 1, START_TIME + 7);

        vm.expectEmit(address(reactive));
        emit OrderReactive.OrderTriggered(1, PRICE_2900, START_TIME + 7, false);
        vm.expectEmit(address(reactive));
        emit OrderReactive.PriceChecked(1, PRICE_2900, START_TIME + 7, 1);
        _react(record);

        assertEq(system.callbackCount(), 1);
        assertEq(system.callbackSenders(0), address(reactive));
        ISystemContract.CallbackConfiguration_V_1_0 memory callback = system.callbackAt(0);
        assertEq(callback.chainId, ORDER_CHAIN_ID);
        assertEq(callback.recipient, address(book));
        assertEq(callback.gasLimit, CALLBACK_GAS);
        assertEq(callback.payload, _executePayload(1, PRICE_2900, START_TIME + 7));

        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Pending));
        assertEq(reactive.lastSequence(), 1);
        assertEq(reactive.lastPrice(), PRICE_2900);
        assertEq(reactive.lastSourceTimestamp(), START_TIME + 7);
    }

    function test_React_PriceIsUsdcBaseUnitsPerWholeWeth() public {
        vm.expectEmit(address(reactive));
        emit OrderReactive.PriceChecked(1, 3_000 * ONE_USDC, START_TIME, 0);
        _react(_reserveLog(POOL_WETH, POOL_USDC, 1, START_TIME));

        // 3 WETH / 10,000 USDC = 3,333.333333 USDC per WETH, rounded down.
        _react(_reserveLog(3 * ONE_WETH, 10_000 * ONE_USDC, 2, START_TIME));
        assertEq(reactive.lastPrice(), 3_333_333_333);
    }

    function test_React_PendingOrderIsNotTriggeredAgainUntilItsOutcomeArrives() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        _assertIds(_pushPrice(PRICE_2900), _ids(1));

        vm.expectEmit(address(reactive));
        emit OrderReactive.PriceChecked(2, 2_800 * ONE_USDC, START_TIME, 0);
        _react(_priceLog(2_800 * ONE_USDC, nextSequence++, START_TIME));
        _assertIds(_pushPrice(2_700 * ONE_USDC), _none());
        assertEq(system.callbackCount(), 1);
    }

    function test_React_StopsAfterMaxTriggersPerLogAndTriggersTheRestOnTheNextPrice() public {
        _mirrorPlaced(1, 5, BELOW, PRICE_2900);
        _assertIds(_pushPrice(PRICE_2900), _ids(1, 2, 3));
        _assertIds(_pushPrice(PRICE_2900), _ids(4, 5));
        _assertIds(_pushPrice(PRICE_2900), _none());
    }

    // --- tracked-list bounds ---

    function test_React_OrdersBeyondMaxTrackedAreRecordedUntrackedAndNeverTriggered() public {
        uint256 cap = reactive.MAX_TRACKED();
        assertEq(cap, 64);
        _mirrorPlaced(1, cap, BELOW, PRICE_2900);

        _expectMirrored(cap + 1, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.PlacedUntracked);
        _react(_placedLog(cap + 1, BELOW, PRICE_2900));
        assertEq(reactive.trackedCount(), cap);
        assertFalse(reactive.isTracked(cap + 1));

        uint256 triggered;
        for (uint256 round = 0; round < cap; round++) {
            uint256[] memory ids = _pushPrice(PRICE_2900);
            if (ids.length == 0) break;
            for (uint256 i = 0; i < ids.length; i++) {
                assertTrue(ids[i] != cap + 1, "untracked order triggered");
            }
            triggered += ids.length;
        }
        assertEq(triggered, cap);

        // The owner can still cancel it on the order book; the mirror closes it without freeing any slot.
        assertEq(reactive.trackedPerOwner(alice), 0, "never tracked, never counted");
        _expectMirrored(cap + 1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Cancelled);
        _react(_cancelledLog(cap + 1));
        assertEq(reactive.trackedCount(), cap);
        assertEq(reactive.trackedPerOwner(alice), 0);
    }

    function test_React_FreedSlotIsTakenByTheNextPlacement() public {
        uint256 cap = reactive.MAX_TRACKED();
        _mirrorPlaced(1, cap, BELOW, PRICE_2900);
        _react(_cancelledLog(10));
        assertEq(reactive.trackedCount(), cap - 1);

        _expectMirrored(cap + 1, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.Placed);
        _react(_placedLog(cap + 1, BELOW, PRICE_2900));
        assertTrue(reactive.isTracked(cap + 1));
        assertEq(reactive.trackedCount(), cap);
    }

    function test_React_RemovalSwapsLastIdIntoTheFreedSlot() public {
        _mirrorPlaced(1, 5, BELOW, PRICE_2900);
        _react(_cancelledLog(2)); // middle
        _assertIds(reactive.trackedIds(), _ids(1, 5, 3, 4));
        _react(_cancelledLog(1)); // first
        _assertIds(reactive.trackedIds(), _ids(4, 5, 3));
        _react(_cancelledLog(3)); // last
        _assertIds(reactive.trackedIds(), _ids(4, 5));
        _react(_cancelledLog(2)); // already removed
        _assertIds(reactive.trackedIds(), _ids(4, 5));

        assertTrue(reactive.isTracked(4));
        assertTrue(reactive.isTracked(5));
        assertFalse(reactive.isTracked(1));
        assertFalse(reactive.isTracked(2));
        assertFalse(reactive.isTracked(3));
    }

    function _ids(uint256 a, uint256 b, uint256 c, uint256 d) private pure returns (uint256[] memory ids) {
        ids = new uint256[](4);
        (ids[0], ids[1], ids[2], ids[3]) = (a, b, c, d);
    }

    // --- per-owner cap ---

    function test_React_OrderOverThePerOwnerCapIsMirroredUntrackedWithOwnerLimit() public {
        uint256 perOwner = reactive.MAX_TRACKED_PER_OWNER();
        assertEq(perOwner, 4);
        for (uint256 id = 1; id <= perOwner; id++) {
            _expectMirrored(id, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.Placed);
            _react(_placedLog(id, BELOW, PRICE_2900));
        }

        uint256 overCap = perOwner + 1;
        _expectMirrored(overCap, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.OwnerLimit);
        _react(_placedLog(overCap, BELOW, PRICE_2900));
        assertFalse(reactive.isTracked(overCap));
        assertEq(uint8(_mirrorState(overCap)), uint8(OrderReactive.MirrorState.Open));
        assertEq(reactive.trackedPerOwner(alice), perOwner);

        // Another owner is not affected.
        uint256 bobOrder = overCap + 1;
        _expectMirrored(bobOrder, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.Placed);
        _react(_placedLogBy(bobOrder, bob, address(weth), ONE_WETH, BELOW, PRICE_2900));
        assertEq(reactive.trackedPerOwner(bob), 1);
        assertEq(reactive.trackedCount(), perOwner + 1);

        uint256 triggered;
        for (uint256 round = 0; round < 3; round++) {
            uint256[] memory ids = _pushPrice(PRICE_2900);
            for (uint256 i = 0; i < ids.length; i++) {
                assertTrue(ids[i] != overCap, "order over the owner cap triggered");
            }
            triggered += ids.length;
        }
        assertEq(triggered, perOwner + 1);
    }

    function test_React_EveryExitFromTheTrackedSetFreesOneOwnerSlot() public {
        uint256 perOwner = reactive.MAX_TRACKED_PER_OWNER();
        for (uint256 id = 1; id <= perOwner; id++) {
            _react(_placedLog(id, BELOW, PRICE_2900));
        }
        _react(_cancelledLog(1));
        assertEq(reactive.trackedPerOwner(alice), 3);
        _react(_outcomeLog(2, OrderBook.Outcome.Filled));
        assertEq(reactive.trackedPerOwner(alice), 2);
        _react(_outcomeLog(3, OrderBook.Outcome.SkippedNotOpen));
        assertEq(reactive.trackedPerOwner(alice), 1);
        _react(_outcomeLog(4, OrderBook.Outcome.SkippedExpired));
        assertEq(reactive.trackedPerOwner(alice), 0);
        assertEq(reactive.trackedCount(), 0);

        // The owner can fill all four slots again.
        for (uint256 id = perOwner + 1; id <= 2 * perOwner; id++) {
            _expectMirrored(id, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.Placed);
            _react(_placedLog(id, BELOW, PRICE_2900));
        }
        assertEq(reactive.trackedPerOwner(alice), perOwner);
    }

    function test_React_OwnerCountIgnoresDuplicateLogsAndOrdersThatWereNeverTracked() public {
        uint256 perOwner = reactive.MAX_TRACKED_PER_OWNER();
        uint256 untracked = perOwner + 1;
        for (uint256 id = 1; id <= untracked; id++) {
            _react(_placedLog(id, BELOW, PRICE_2900));
        }

        // Duplicate placements of a tracked and of an untracked order take no slot.
        _react(_placedLog(1, BELOW, PRICE_2900));
        _react(_placedLog(untracked, BELOW, PRICE_2900));
        assertEq(reactive.trackedPerOwner(alice), perOwner);

        // Closing the order that was never tracked frees nothing.
        _react(_cancelledLog(untracked));
        _react(_outcomeLog(untracked, OrderBook.Outcome.SkippedNotOpen));
        assertEq(reactive.trackedPerOwner(alice), perOwner);

        // Closing a tracked order several times frees exactly one slot.
        _react(_cancelledLog(1));
        _react(_outcomeLog(1, OrderBook.Outcome.SkippedNotOpen));
        _react(_cancelledLog(1));
        assertEq(reactive.trackedPerOwner(alice), perOwner - 1);
        assertEq(reactive.trackedCount(), perOwner - 1);

        // A late placement of a closed order takes no slot either.
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.NoChange);
        _react(_placedLog(1, BELOW, PRICE_2900));
        assertEq(reactive.trackedPerOwner(alice), perOwner - 1);
    }

    // --- slippage retry cap ---

    function test_React_SlippageLimitClosesTheMirrorButLeavesTheCancelPath() public {
        uint256 retries = reactive.MAX_SLIPPAGE_RETRIES();
        assertEq(retries, 3);
        _react(_placedLog(1, BELOW, PRICE_2900));

        for (uint256 attempt = 1; attempt < retries; attempt++) {
            _assertIds(_pushPrice(PRICE_2900), _ids(1));
            _expectMirrored(1, OrderReactive.MirrorState.Open, OrderReactive.MirrorReason.Rearmed);
            _react(_outcomeLog(1, OrderBook.Outcome.SkippedSlippage));
            assertEq(_slippageCount(1), attempt);
        }

        _assertIds(_pushPrice(PRICE_2900), _ids(1));
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.RetryLimit);
        _react(_outcomeLog(1, OrderBook.Outcome.SkippedSlippage));

        assertEq(_slippageCount(1), retries);
        assertFalse(reactive.isTracked(1));
        assertEq(reactive.trackedPerOwner(alice), 0, "the retry limit frees the owner slot");
        _assertIds(_pushPrice(PRICE_2900), _none());
        assertEq(system.callbackCount(), retries);

        // The order is still open on the order book; the owner's cancel is mirrored as usual.
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Cancelled);
        _react(_cancelledLog(1));
        assertEq(reactive.trackedPerOwner(alice), 0);
    }

    // --- pending timeout ---

    function test_React_PendingOrderTriggersAgainOncePendingTimeoutHasPassed() public {
        uint256 timeout = reactive.PENDING_TIMEOUT();
        assertEq(timeout, 300);
        _react(_placedLog(1, BELOW, PRICE_2900));
        _assertIds(_pushPriceAt(PRICE_2900, START_TIME), _ids(1));
        assertEq(_pendingSince(1), START_TIME);

        // One second short of the timeout the first callback may still land.
        _assertIds(_pushPriceAt(PRICE_2900, START_TIME + timeout - 1), _none());

        uint256 retryAt = START_TIME + timeout;
        vm.expectEmit(address(reactive));
        emit OrderReactive.OrderTriggered(1, PRICE_2900, retryAt, true);
        vm.expectEmit(address(reactive));
        emit OrderReactive.PriceChecked(3, PRICE_2900, retryAt, 1);
        _react(_priceLog(PRICE_2900, nextSequence++, retryAt));

        assertEq(system.callbackCount(), 2);
        assertEq(system.callbackAt(1).payload, _executePayload(1, PRICE_2900, retryAt));
        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Pending));
        assertEq(_pendingSince(1), retryAt, "the retry restarts the clock");
        _assertIds(_pushPriceAt(PRICE_2900, retryAt + timeout - 1), _none());
    }

    function test_React_TimedOutOrderStaysPendingUntilItsConditionHoldsAgain() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        _pushPriceAt(PRICE_2900, START_TIME);

        _assertIds(_pushPriceAt(PRICE_3000, START_TIME + 400), _none());
        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Pending));

        vm.expectEmit(address(reactive));
        emit OrderReactive.OrderTriggered(1, 2_850 * ONE_USDC, START_TIME + 401, true);
        _react(_priceLog(2_850 * ONE_USDC, nextSequence++, START_TIME + 401));
    }

    function test_React_OutcomesOfTheLateCallbackAndTheRetryCloseTheOrderOnce() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        _pushPriceAt(PRICE_2900, START_TIME);
        _assertIds(_pushPriceAt(PRICE_2900, START_TIME + reactive.PENDING_TIMEOUT()), _ids(1));

        // The first callback lands late and fills; the order book answers the retry with SkippedNotOpen.
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Filled);
        _react(_outcomeLog(1, OrderBook.Outcome.Filled));
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.NotOpen);
        _react(_outcomeLog(1, OrderBook.Outcome.SkippedNotOpen));

        assertEq(reactive.trackedCount(), 0);
        assertEq(reactive.trackedPerOwner(alice), 0);
    }

    // --- expiry eviction ---

    function test_React_PriceScanEvictsExpiredOrdersBeforeTriggering() public {
        uint256 expiry = START_TIME + 100;
        _react(_placedLogExpiring(1, alice, BELOW, 2_800 * ONE_USDC, expiry)); // stays Open
        _react(_placedLogExpiring(2, alice, BELOW, PRICE_2900, expiry)); // goes Pending
        _react(_placedLogExpiring(3, alice, BELOW, 2_800 * ONE_USDC, START_TIME + ORDER_TTL));
        _assertIds(_pushPriceAt(PRICE_2900, START_TIME), _ids(2));

        // Still alive at its expiry second, like OrderBook, which fills up to and including expiry.
        _pushPriceAt(PRICE_3000, expiry);
        assertEq(reactive.trackedCount(), 3);

        // One second later both the Open and the Pending order are evicted before the scan, and the price that
        // would meet order 1's condition triggers only order 3. PriceChecked stays the last event of the log.
        uint256 later = expiry + 1;
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Expired);
        _expectMirrored(2, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Expired);
        vm.expectEmit(address(reactive));
        emit OrderReactive.OrderTriggered(3, 2_800 * ONE_USDC, later, false);
        vm.expectEmit(address(reactive));
        emit OrderReactive.PriceChecked(3, 2_800 * ONE_USDC, later, 1);
        _react(_priceLog(2_800 * ONE_USDC, nextSequence++, later));

        _assertIds(reactive.trackedIds(), _ids(3));
        assertEq(reactive.trackedPerOwner(alice), 1, "evictions free the owner's slots");

        // The late outcome of order 2's callback changes no count.
        _react(_outcomeLog(2, OrderBook.Outcome.SkippedExpired));
        assertEq(reactive.trackedPerOwner(alice), 1);
        assertEq(reactive.trackedCount(), 1);
    }

    // --- attempt cap ---

    function test_React_AttemptLimitEvictsAPendingOrderWhoseLastCallbackTimedOut() public {
        uint256 maxAttempts = reactive.MAX_TRIGGER_ATTEMPTS();
        uint256 timeout = reactive.PENDING_TIMEOUT();
        assertEq(maxAttempts, 5);
        _react(_placedLog(1, BELOW, PRICE_2900));

        uint256 at = START_TIME;
        for (uint256 attempt = 1; attempt <= maxAttempts; attempt++) {
            _assertIds(_pushPriceAt(PRICE_2900, at), _ids(1));
            assertEq(_attempts(1), attempt);
            at += timeout;
        }

        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.AttemptLimit);
        vm.expectEmit(address(reactive));
        emit OrderReactive.PriceChecked(maxAttempts + 1, PRICE_2900, at, 0);
        _react(_priceLog(PRICE_2900, nextSequence++, at));

        assertEq(system.callbackCount(), maxAttempts, "never a sixth callback");
        assertFalse(reactive.isTracked(1));
        assertEq(reactive.trackedPerOwner(alice), 0);
    }

    function test_React_LastAttemptIsAwaitedBeforeTheTimeout() public {
        uint256 maxAttempts = reactive.MAX_TRIGGER_ATTEMPTS();
        uint256 timeout = reactive.PENDING_TIMEOUT();
        _react(_placedLog(1, BELOW, PRICE_2900));
        uint256 at = START_TIME;
        for (uint256 attempt = 1; attempt <= maxAttempts; attempt++) {
            _pushPriceAt(PRICE_2900, at);
            at += timeout;
        }

        // Within the timeout of the fifth callback the order waits for its outcome, which still closes it.
        _assertIds(_pushPriceAt(PRICE_2900, at - 1), _none());
        assertTrue(reactive.isTracked(1));
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.Filled);
        _react(_outcomeLog(1, OrderBook.Outcome.Filled));
    }

    function test_React_SlippageAfterTheLastAttemptClosesWithAttemptLimit() public {
        uint256 maxAttempts = reactive.MAX_TRIGGER_ATTEMPTS();
        uint256 timeout = reactive.PENDING_TIMEOUT();
        _react(_placedLog(1, BELOW, PRICE_2900));
        uint256 at = START_TIME;
        for (uint256 attempt = 1; attempt <= maxAttempts; attempt++) {
            _pushPriceAt(PRICE_2900, at);
            at += timeout;
        }

        // One slippage outcome is below MAX_SLIPPAGE_RETRIES, but no attempt is left to re-arm for.
        _expectMirrored(1, OrderReactive.MirrorState.Closed, OrderReactive.MirrorReason.AttemptLimit);
        _react(_outcomeLog(1, OrderBook.Outcome.SkippedSlippage));
        assertEq(_slippageCount(1), 1);
        assertFalse(reactive.isTracked(1));
        assertEq(reactive.trackedPerOwner(alice), 0);
    }

    // --- scan rotation ---

    function test_React_ScanStartRotatesSoEarlySlotsDoNotAlwaysWin() public {
        _mirrorPlaced(1, 4, BELOW, PRICE_2900); // one more qualifying order than MAX_TRIGGERS
        _assertIds(_pushPrice(PRICE_2900), _ids(1, 2, 3));

        // All three slip and are re-armed. Scanning from the first slot again would retrigger them and
        // starve order 4; the scan resumes after the last triggered slot instead.
        for (uint256 id = 1; id <= 3; id++) {
            _react(_outcomeLog(id, OrderBook.Outcome.SkippedSlippage));
        }
        _assertIds(_pushPrice(PRICE_2900), _ids(4, 1, 2));
        _assertIds(_pushPrice(PRICE_2900), _ids(3));
    }

    // --- price logs that are ignored ---

    function test_React_IgnoresPriceLogWhosePriceIsZeroWithoutConsumingItsSequence() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        IReactive.LogRecord memory noUsdc = _reserveLog(POOL_WETH, 0, 1, START_TIME);
        _expectIgnored(noUsdc, OrderReactive.IgnoreReason.ZeroPrice);
        _react(noUsdc);

        // 1 USDC base unit for 100 WETH rounds down to a price of 0 too.
        IReactive.LogRecord memory dust = _reserveLog(POOL_WETH, 1, 1, START_TIME);
        _expectIgnored(dust, OrderReactive.IgnoreReason.ZeroPrice);
        _react(dust);

        assertEq(system.callbackCount(), 0, "a zero price never meets a stop-loss");
        assertEq(reactive.lastSequence(), 0);
        _react(_priceLog(PRICE_2900, 1, START_TIME));
        assertEq(system.callbackCount(), 1, "the same sequence is accepted with a real price");
    }

    function test_React_IgnoresStaleAndDuplicatePriceLogs() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        _react(_priceLog(PRICE_3000, 2, START_TIME));

        IReactive.LogRecord memory duplicate = _priceLog(2_800 * ONE_USDC, 2, START_TIME);
        _expectIgnored(duplicate, OrderReactive.IgnoreReason.StaleOrDuplicatePrice);
        _react(duplicate);

        IReactive.LogRecord memory late = _priceLog(2_800 * ONE_USDC, 1, START_TIME - 5);
        _expectIgnored(late, OrderReactive.IgnoreReason.StaleOrDuplicatePrice);
        _react(late);

        assertEq(system.callbackCount(), 0);
        assertEq(reactive.lastSequence(), 2);
        assertEq(reactive.lastPrice(), PRICE_3000);
        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Open));
    }

    function test_React_IgnoresPriceLogFromAnEmptyPool() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        IReactive.LogRecord memory empty = _reserveLog(0, POOL_USDC, 1, START_TIME);
        _expectIgnored(empty, OrderReactive.IgnoreReason.EmptyPool);
        _react(empty);
        assertEq(system.callbackCount(), 0);
        assertEq(reactive.lastSequence(), 0);
    }

    function test_React_RecordsUnknownLogsWithoutTouchingState() public {
        _react(_placedLog(1, BELOW, PRICE_2900));
        IReactive.LogRecord[] memory unknown = new IReactive.LogRecord[](6);
        unknown[0] = _priceLog(PRICE_2900, 1, START_TIME);
        unknown[0].chainId = ORDER_CHAIN_ID; // price event from the wrong chain
        unknown[1] = _priceLog(PRICE_2900, 1, START_TIME);
        unknown[1].contractAddress = address(bookPool); // another pool
        unknown[2] = _priceLog(PRICE_2900, 1, START_TIME);
        unknown[2].topic0 = 123; // another event of the price pool
        unknown[3] = _cancelledLog(1);
        unknown[3].chainId = PRICE_CHAIN_ID; // order event from the wrong chain
        unknown[4] = _cancelledLog(1);
        unknown[4].contractAddress = trader; // another contract
        unknown[5] = _priceLog(PRICE_2900, 1, START_TIME);
        unknown[5].chainId = ORDER_CHAIN_ID;
        unknown[5].contractAddress = address(book); // a ReserveUpdate topic from the order book

        for (uint256 i = 0; i < unknown.length; i++) {
            _expectIgnored(unknown[i], OrderReactive.IgnoreReason.UnknownSource);
            _react(unknown[i]);
        }

        assertEq(system.callbackCount(), 0);
        assertEq(reactive.lastSequence(), 0);
        assertEq(uint8(_mirrorState(1)), uint8(OrderReactive.MirrorState.Open));
        assertEq(reactive.trackedCount(), 1);
    }

    // --- funding ---

    function test_CoverDebt_PaysSystemContractFromBalance() public {
        vm.deal(address(reactive), 1 ether);
        system.setDebt(address(reactive), 0.3 ether);
        reactive.coverDebt();
        assertEq(SYSTEM_ADDRESS.balance, 0.3 ether);
        assertEq(address(reactive).balance, 0.7 ether);
    }
}
