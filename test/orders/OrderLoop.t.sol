// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { OrderBook } from "../../src/orders/OrderBook.sol";
import { OrderReactive } from "../../src/orders/OrderReactive.sol";
import { ArbMath } from "../../src/libraries/ArbMath.sol";
import { OrderFixture } from "../utils/OrderFixture.sol";

/// @dev Protective orders through the full local loop: a swap on the price pool (Base Sepolia) -> react() on
///      Lasna -> callback through the proxy -> OrderBook executes on Unichain Sepolia -> OrderOutcome back to
///      react() -> mirror closed. The relay only forwards logs that match the Reactive contract's subscriptions.
contract OrderLoopTest is OrderFixture {
    uint256 private constant STOP_PRICE = 2_900 * ONE_USDC;
    uint256 private constant TAKE_PROFIT_PRICE = 3_100 * ONE_USDC;
    uint256 private constant CRASH_WETH = 5 * ONE_WETH / 2; // takes the price pool from 3,000 to about 2,856
    OrderBook.Condition private constant BELOW = OrderBook.Condition.PriceAtOrBelow;
    OrderBook.Condition private constant ABOVE = OrderBook.Condition.PriceAtOrAbove;

    function setUp() public {
        _deployOrders();
        vm.recordLogs();
    }

    function _sellOnPricePool(uint256 wethIn) private {
        vm.prank(trader);
        pricePool.swap(address(weth), wethIn, 0, trader);
    }

    function _buyOnPricePool(uint256 usdcIn) private {
        vm.prank(trader);
        pricePool.swap(address(usdc), usdcIn, 0, trader);
    }

    function _pricePoolPrice() private view returns (uint256) {
        (uint256 reserveWeth, uint256 reserveUsdc) = pricePool.getReserves();
        return reserveUsdc * ONE_WETH / reserveWeth;
    }

    function _quoteOnBookPool(address tokenIn, uint256 amountIn) private view returns (uint256) {
        (uint256 reserveWeth, uint256 reserveUsdc) = bookPool.getReserves();
        return tokenIn == address(weth)
            ? ArbMath.getAmountOut(amountIn, reserveWeth, reserveUsdc, FEE_BPS)
            : ArbMath.getAmountOut(amountIn, reserveUsdc, reserveWeth, FEE_BPS);
    }

    function _assertStatus(uint256 orderId, OrderBook.Status status) private view {
        assertEq(uint8(book.getOrder(orderId).status), uint8(status), "order-book status");
    }

    function _assertMirror(uint256 orderId, OrderReactive.MirrorState state) private view {
        assertEq(uint8(_mirrorState(orderId)), uint8(state), "mirror state");
    }

    function _assertLastOutcome(uint256 orderId, OrderBook.Outcome outcome, uint256 amountOut) private view {
        assertEq(lastRelayedOutcome.orderId, orderId, "outcome order");
        assertEq(uint8(lastRelayedOutcome.outcome), uint8(outcome), "outcome");
        assertEq(lastRelayedOutcome.amountOut, amountOut, "outcome amountOut");
    }

    function test_Loop_StopLossFiresWhenThePricePoolDropsAndTheMirrorCloses() public {
        uint256 orderId = _place(alice, address(weth), ONE_WETH, BELOW, STOP_PRICE, 2_800 * ONE_USDC);
        assertEq(_relayLogsToReactive(), 1, "only OrderPlaced is subscribed");
        _assertMirror(orderId, OrderReactive.MirrorState.Open);

        // A small sale keeps the price above the stop: Lasna checks it and requests nothing.
        _sellOnPricePool(ONE_WETH / 2);
        assertEq(_relayLogsToReactive(), 1);
        assertGt(reactive.lastPrice(), STOP_PRICE);
        assertEq(system.callbackCount(), 0);

        _sellOnPricePool(2 * ONE_WETH);
        uint256 observed = _pricePoolPrice();
        assertLt(observed, STOP_PRICE);
        assertEq(_relayLogsToReactive(), 1);
        assertEq(system.callbackCount(), 1);
        _assertMirror(orderId, OrderReactive.MirrorState.Pending);

        uint256 expectedOut = _quoteOnBookPool(address(weth), ONE_WETH);
        assertEq(_deliverPendingCallbacks(), 1);
        _assertStatus(orderId, OrderBook.Status.Filled);
        assertEq(usdc.balanceOf(alice), USER_USDC + expectedOut);
        assertEq(weth.balanceOf(address(book)), 0);

        // Only the OrderOutcome flows back to Lasna (the execution pool is not subscribed); it closes the mirror.
        assertEq(_relayLogsToReactive(), 1);
        _assertLastOutcome(orderId, OrderBook.Outcome.Filled, expectedOut);
        assertEq(lastRelayedOutcome.observedPrice, observed, "price seen on Lasna reaches the order book");
        assertEq(lastRelayedOutcome.sourceTimestamp, START_TIME);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        assertEq(reactive.trackedCount(), 0);

        // Further drops request nothing for the closed order.
        _sellOnPricePool(ONE_WETH);
        _relayLogsToReactive();
        assertEq(system.callbackCount(), 1);
    }

    function test_Loop_TakeProfitFiresWhenThePricePoolRises() public {
        uint256 orderId = _place(alice, address(weth), ONE_WETH, ABOVE, TAKE_PROFIT_PRICE, ANY_OUT);
        _relayLogsToReactive();

        _buyOnPricePool(6_000 * ONE_USDC);
        assertGt(_pricePoolPrice(), TAKE_PROFIT_PRICE);
        _relayLogsToReactive();
        uint256 expectedOut = _quoteOnBookPool(address(weth), ONE_WETH);
        assertEq(_deliverPendingCallbacks(), 1);
        _relayLogsToReactive();

        _assertStatus(orderId, OrderBook.Status.Filled);
        assertEq(usdc.balanceOf(alice), USER_USDC + expectedOut);
        _assertLastOutcome(orderId, OrderBook.Outcome.Filled, expectedOut);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
    }

    function test_Loop_LimitBuyFiresWhenThePricePoolDrops() public {
        uint256 spend = 2_900 * ONE_USDC;
        uint256 orderId = _place(alice, address(usdc), spend, BELOW, STOP_PRICE, ANY_OUT);
        _relayLogsToReactive();

        _sellOnPricePool(CRASH_WETH);
        _relayLogsToReactive();
        uint256 expectedOut = _quoteOnBookPool(address(usdc), spend);
        assertEq(_deliverPendingCallbacks(), 1);
        _relayLogsToReactive();

        _assertStatus(orderId, OrderBook.Status.Filled);
        assertEq(weth.balanceOf(alice), USER_WETH + expectedOut);
        assertEq(usdc.balanceOf(address(book)), 0);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
    }

    function test_Loop_OneDropFillsStopLossAndLimitBuyButLeavesTakeProfitOpen() public {
        uint256 stopLoss = _place(alice, address(weth), ONE_WETH, BELOW, STOP_PRICE, ANY_OUT);
        uint256 limitBuy = _place(bob, address(usdc), 2_900 * ONE_USDC, BELOW, STOP_PRICE, ANY_OUT);
        uint256 takeProfit = _place(alice, address(weth), ONE_WETH, ABOVE, TAKE_PROFIT_PRICE, ANY_OUT);
        assertEq(_relayLogsToReactive(), 3);

        _sellOnPricePool(CRASH_WETH);
        _relayLogsToReactive();
        assertEq(_deliverPendingCallbacks(), 2);
        assertEq(_relayLogsToReactive(), 2);

        _assertStatus(stopLoss, OrderBook.Status.Filled);
        _assertStatus(limitBuy, OrderBook.Status.Filled);
        _assertStatus(takeProfit, OrderBook.Status.Open);
        _assertMirror(takeProfit, OrderReactive.MirrorState.Open);
        _assertIdsEq(reactive.trackedIds(), takeProfit);
    }

    function test_Loop_SlippageRearmsTheOrderAndTheNextPriceUpdateFillsIt() public {
        uint256 minOut = 2_970 * ONE_USDC;
        assertLt(_quoteOnBookPool(address(weth), ONE_WETH), minOut, "execution pool too thin at first");
        uint256 orderId = _place(alice, address(weth), ONE_WETH, BELOW, STOP_PRICE, minOut);
        _relayLogsToReactive();

        _sellOnPricePool(CRASH_WETH);
        _relayLogsToReactive();
        _deliverPendingCallbacks();
        _relayLogsToReactive();
        _assertLastOutcome(orderId, OrderBook.Outcome.SkippedSlippage, 0);
        _assertStatus(orderId, OrderBook.Status.Open);
        _assertMirror(orderId, OrderReactive.MirrorState.Open);
        assertEq(weth.balanceOf(address(book)), ONE_WETH, "still escrowed");

        // A buyer lifts the execution pool on Unichain; its own logs are not subscribed and trigger nothing.
        vm.prank(trader);
        bookPool.swap(address(usdc), 3_000 * ONE_USDC, 0, trader);
        assertEq(_relayLogsToReactive(), 0);
        uint256 expectedOut = _quoteOnBookPool(address(weth), ONE_WETH);
        assertGe(expectedOut, minOut);

        // The next price update on Base re-triggers the re-armed order, and this time it fills.
        _sellOnPricePool(ONE_WETH / 10);
        _relayLogsToReactive();
        assertEq(system.callbackCount(), 2);
        _deliverPendingCallbacks();
        _relayLogsToReactive();
        _assertLastOutcome(orderId, OrderBook.Outcome.Filled, expectedOut);
        _assertStatus(orderId, OrderBook.Status.Filled);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        assertEq(usdc.balanceOf(alice), USER_USDC + expectedOut);
    }

    function test_Loop_CancelWhilePendingSkipsTheCallbackAndRefundsInFull() public {
        uint256 orderId = _place(alice, address(weth), ONE_WETH, BELOW, STOP_PRICE, ANY_OUT);
        _relayLogsToReactive();
        _sellOnPricePool(CRASH_WETH);
        _relayLogsToReactive();
        _assertMirror(orderId, OrderReactive.MirrorState.Pending);

        vm.prank(alice);
        book.cancelOrder(orderId);
        assertEq(_relayLogsToReactive(), 1);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);

        _deliverPendingCallbacks();
        _relayLogsToReactive();
        _assertLastOutcome(orderId, OrderBook.Outcome.SkippedNotOpen, 0);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        assertEq(weth.balanceOf(alice), USER_WETH);
        assertEq(bookPool.sequence(), 1, "no swap on the execution pool");
    }

    function test_Loop_ExpiredOrderIsEvictedOnLasnaAndTheOwnerCancelsForARefund() public {
        uint256 orderId = _place(alice, address(weth), ONE_WETH, BELOW, STOP_PRICE, ANY_OUT);
        _relayLogsToReactive();
        vm.warp(START_TIME + 2 * ORDER_TTL);

        // The next price update evicts the dead order instead of paying for a callback that could only refund.
        _sellOnPricePool(CRASH_WETH);
        _relayLogsToReactive();
        assertEq(system.callbackCount(), 0);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        assertEq(reactive.trackedPerOwner(alice), 0, "the slot is free again");
        _assertStatus(orderId, OrderBook.Status.Open);

        vm.prank(alice);
        book.cancelOrder(orderId);
        assertEq(_relayLogsToReactive(), 1);
        assertEq(weth.balanceOf(alice), USER_WETH);
    }

    function test_Loop_CallbackLandingAfterExpiryRefundsTheOrder() public {
        uint256 orderId = _place(alice, address(weth), ONE_WETH, BELOW, STOP_PRICE, ANY_OUT);
        uint64 expiry = book.getOrder(orderId).expiry;
        _relayLogsToReactive();

        // Triggered in the order's last second on the price chain, delivered after it on the order chain.
        vm.warp(expiry);
        _sellOnPricePool(CRASH_WETH);
        _relayLogsToReactive();
        assertEq(_holdPendingCallbacks(), 1);
        vm.warp(expiry + 1);
        _deliverCallbackAt(0);
        _relayLogsToReactive();

        _assertLastOutcome(orderId, OrderBook.Outcome.SkippedExpired, 0);
        assertEq(lastRelayedOutcome.sourceTimestamp, expiry);
        _assertStatus(orderId, OrderBook.Status.Expired);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        assertEq(weth.balanceOf(alice), USER_WETH);
    }

    function test_Loop_RetryCapStopsCallbacksAfterThreeSlippagesAndTheOwnerCanStillCancel() public {
        // No execution pool state can pay 10,000 USDC for 1 WETH here, so every attempt slips.
        uint256 orderId = _place(alice, address(weth), ONE_WETH, BELOW, STOP_PRICE, 10_000 * ONE_USDC);
        _relayLogsToReactive();
        uint256 retries = reactive.MAX_SLIPPAGE_RETRIES();

        _sellOnPricePool(CRASH_WETH);
        for (uint256 attempt = 1; attempt <= retries; attempt++) {
            if (attempt > 1) _sellOnPricePool(ONE_WETH / 10); // a fresh price update below the stop
            _relayLogsToReactive();
            assertEq(_deliverPendingCallbacks(), 1, "one callback per attempt");
            _relayLogsToReactive();
            _assertLastOutcome(orderId, OrderBook.Outcome.SkippedSlippage, 0);
        }

        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        assertFalse(reactive.isTracked(orderId));
        assertEq(reactive.trackedPerOwner(alice), 0);
        _assertStatus(orderId, OrderBook.Status.Open);
        assertEq(weth.balanceOf(address(book)), ONE_WETH, "still escrowed");

        // Further drops request no more callbacks for it.
        _sellOnPricePool(ONE_WETH / 10);
        _relayLogsToReactive();
        assertEq(system.callbackCount(), retries);

        vm.prank(alice);
        book.cancelOrder(orderId);
        assertEq(_relayLogsToReactive(), 1);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        assertEq(weth.balanceOf(alice), USER_WETH);
    }

    function test_Loop_LostCallbackIsRetriedAfterTheTimeoutAndTheLateDuplicateIsHarmless() public {
        uint256 orderId = _place(alice, address(weth), ONE_WETH, BELOW, STOP_PRICE, ANY_OUT);
        _relayLogsToReactive();
        _sellOnPricePool(CRASH_WETH);
        _relayLogsToReactive();
        assertEq(_holdPendingCallbacks(), 1, "the first callback is delayed");

        // Inside the timeout a new price update does not request a duplicate.
        uint256 timeout = reactive.PENDING_TIMEOUT();
        vm.warp(START_TIME + timeout - 1);
        _sellOnPricePool(ONE_WETH / 10);
        _relayLogsToReactive();
        assertEq(system.callbackCount(), 1);

        vm.warp(START_TIME + timeout);
        _sellOnPricePool(ONE_WETH / 10);
        _relayLogsToReactive();
        assertEq(system.callbackCount(), 2, "retried after the timeout");

        uint256 expectedOut = _quoteOnBookPool(address(weth), ONE_WETH);
        assertEq(_deliverPendingCallbacks(), 1);
        _relayLogsToReactive();
        _assertLastOutcome(orderId, OrderBook.Outcome.Filled, expectedOut);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        uint256 usdcAfterFill = usdc.balanceOf(alice);

        // The delayed first callback finally lands: the order book answers SkippedNotOpen and nothing moves.
        _deliverCallbackAt(0);
        _relayLogsToReactive();
        _assertLastOutcome(orderId, OrderBook.Outcome.SkippedNotOpen, 0);
        assertEq(usdc.balanceOf(alice), usdcAfterFill);
        _assertMirror(orderId, OrderReactive.MirrorState.Closed);
        assertEq(reactive.trackedPerOwner(alice), 0);
        assertEq(reactive.trackedCount(), 0);
    }

    function _assertIdsEq(uint256[] memory ids, uint256 only) private pure {
        assertEq(ids.length, 1);
        assertEq(ids[0], only);
    }
}
