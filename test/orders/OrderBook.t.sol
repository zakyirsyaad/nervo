// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { OrderBook } from "../../src/orders/OrderBook.sol";
import { ArbMath } from "../../src/libraries/ArbMath.sol";
import { OrderFixture } from "../utils/OrderFixture.sol";

contract OrderBookTest is OrderFixture {
    uint256 private constant STOP_PRICE = 2_900 * ONE_USDC;
    uint256 private constant OBSERVED_PRICE = 2_899 * ONE_USDC;
    uint256 private constant OBSERVED_AT = START_TIME - 4;
    uint256 private constant LIMIT_BUY_USDC = 2_900 * ONE_USDC;

    function setUp() public {
        _deployOrders();
    }

    function _placeStopLoss(address owner, uint256 minAmountOut) private returns (uint256) {
        return _place(owner, address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, minAmountOut);
    }

    function _execute(uint256 orderId) private {
        proxy.deliver(address(book), address(reactive), _executePayload(orderId, OBSERVED_PRICE, OBSERVED_AT));
    }

    function _expectOutcome(uint256 orderId, OrderBook.Outcome outcome, uint256 amountOut) private {
        vm.expectEmit(address(book));
        emit OrderBook.OrderOutcome(orderId, outcome, amountOut, OBSERVED_PRICE, OBSERVED_AT, block.timestamp);
    }

    function _status(uint256 orderId) private view returns (OrderBook.Status) {
        return book.getOrder(orderId).status;
    }

    function _quoteWethIn(uint256 amountIn) private view returns (uint256) {
        (uint256 reserveWeth, uint256 reserveUsdc) = bookPool.getReserves();
        return ArbMath.getAmountOut(amountIn, reserveWeth, reserveUsdc, FEE_BPS);
    }

    // --- construction ---

    function test_Constructor_ReadsTokensFromPoolAndApprovesPoolForBoth() public view {
        assertEq(address(book.POOL()), address(bookPool));
        assertEq(address(book.WETH()), address(weth));
        assertEq(address(book.USDC()), address(usdc));
        assertEq(book._CALLBACK_SENDER(), address(reactive));
        assertEq(address(book._SERVICE_PROVIDER()), address(proxy));
        assertEq(book.owner(), address(this));
        assertEq(book.nextOrderId(), 1);
        assertEq(weth.allowance(address(book), address(bookPool)), type(uint256).max);
        assertEq(usdc.allowance(address(book), address(bookPool)), type(uint256).max);
    }

    // --- placement ---

    function test_PlaceOrder_PullsTokenAndStoresOpenOrder() public {
        uint64 expiry = _expiry();
        vm.expectEmit(address(book));
        emit OrderBook.OrderPlaced(
            1, alice, address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, 2_000 * ONE_USDC, expiry
        );
        uint256 orderId = _placeStopLoss(alice, 2_000 * ONE_USDC);

        assertEq(orderId, 1);
        assertEq(book.nextOrderId(), 2);
        assertEq(weth.balanceOf(address(book)), ONE_WETH);
        assertEq(weth.balanceOf(alice), USER_WETH - ONE_WETH);

        OrderBook.Order memory order = book.getOrder(orderId);
        assertEq(order.owner, alice);
        assertEq(order.tokenIn, address(weth));
        assertEq(order.amountIn, ONE_WETH);
        assertEq(uint8(order.condition), uint8(OrderBook.Condition.PriceAtOrBelow));
        assertEq(order.triggerPrice, STOP_PRICE);
        assertEq(order.minAmountOut, 2_000 * ONE_USDC);
        assertEq(order.expiry, expiry);
        assertEq(uint8(order.status), uint8(OrderBook.Status.Open));
    }

    function test_PlaceOrder_AssignsIncreasingIdsStartingAtOne() public {
        assertEq(_placeStopLoss(alice, ANY_OUT), 1);
        assertEq(_placeStopLoss(bob, ANY_OUT), 2);
        assertEq(_placeStopLoss(alice, ANY_OUT), 3);
        assertEq(book.getOrder(2).owner, bob);
        assertEq(book.nextOrderId(), 4);
    }

    function test_PlaceOrder_AcceptsUsdcForLimitBuyAndWethForTakeProfit() public {
        uint256 limitBuy =
            _place(alice, address(usdc), LIMIT_BUY_USDC, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT);
        uint256 takeProfit =
            _place(alice, address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrAbove, 3_200 * ONE_USDC, ANY_OUT);

        assertEq(usdc.balanceOf(address(book)), LIMIT_BUY_USDC);
        assertEq(weth.balanceOf(address(book)), ONE_WETH);
        assertEq(book.getOrder(limitBuy).tokenIn, address(usdc));
        assertEq(uint8(book.getOrder(takeProfit).condition), uint8(OrderBook.Condition.PriceAtOrAbove));
    }

    function test_PlaceOrder_RevertsOnUnsupportedToken() public {
        uint64 expiry = _expiry();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.UnsupportedToken.selector, address(bookPool)));
        book.placeOrder{ value: ORDER_FEE }(
            address(bookPool), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
    }

    function test_PlaceOrder_RevertsOnZeroAmountOrZeroTriggerPrice() public {
        uint64 expiry = _expiry();
        vm.startPrank(alice);
        vm.expectRevert(OrderBook.ZeroAmount.selector);
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), 0, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
        vm.expectRevert(OrderBook.ZeroTriggerPrice.selector);
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, 0, ANY_OUT, expiry
        );
        vm.stopPrank();
    }

    function test_PlaceOrder_RevertsBelowMinimumSizeAndAcceptsExactlyTheMinimum() public {
        uint256 minWeth = book.MIN_WETH_IN();
        uint256 minUsdc = book.MIN_USDC_IN();
        assertEq(minWeth, ONE_WETH / 1_000, "0.001 WETH");
        assertEq(minUsdc, ONE_USDC, "1 USDC");
        uint64 expiry = _expiry();

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.OrderTooSmall.selector, minWeth - 1, minWeth));
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), minWeth - 1, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
        vm.expectRevert(abi.encodeWithSelector(OrderBook.OrderTooSmall.selector, minUsdc - 1, minUsdc));
        book.placeOrder{ value: ORDER_FEE }(
            address(usdc), minUsdc - 1, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
        // A USDC-sized amount of WETH is far below the WETH minimum: the minimum follows the input token.
        vm.expectRevert(abi.encodeWithSelector(OrderBook.OrderTooSmall.selector, minUsdc, minWeth));
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), minUsdc, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );

        book.placeOrder{ value: ORDER_FEE }(
            address(weth), minWeth, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
        book.placeOrder{ value: ORDER_FEE }(
            address(usdc), minUsdc, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
        vm.stopPrank();
        assertEq(book.nextOrderId(), 3);
    }

    function test_PlaceOrder_RevertsUnlessExactlyTheOrderFeeIsSent() public {
        assertEq(book.ORDER_FEE(), ORDER_FEE);
        uint64 expiry = _expiry();
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.WrongOrderFee.selector, 0, ORDER_FEE));
        book.placeOrder(address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.WrongOrderFee.selector, ORDER_FEE - 1, ORDER_FEE));
        book.placeOrder{ value: ORDER_FEE - 1 }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
        vm.expectRevert(abi.encodeWithSelector(OrderBook.WrongOrderFee.selector, ORDER_FEE + 1, ORDER_FEE));
        book.placeOrder{ value: ORDER_FEE + 1 }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
        vm.stopPrank();
        assertEq(book.nextOrderId(), 1);
        assertEq(address(book).balance, 0);
    }

    function test_PlaceOrder_FeeStaysInTheBookToPayCallbacksAndIsNotRefunded() public {
        uint256 aliceEthBefore = alice.balance;
        uint256 cancelled = _placeStopLoss(alice, ANY_OUT);
        uint256 filled = _placeStopLoss(alice, ANY_OUT);
        assertEq(address(book).balance, 2 * ORDER_FEE);

        vm.prank(alice);
        book.cancelOrder(cancelled);
        _execute(filled);
        assertEq(address(book).balance, 2 * ORDER_FEE, "neither cancel nor fill refunds the fee");
        assertEq(alice.balance, aliceEthBefore - 2 * ORDER_FEE);

        // The prepaid fees cover the callback proxy's debt.
        proxy.setDebt(address(book), 2 * ORDER_FEE);
        book.coverDebt();
        assertEq(address(proxy).balance, 2 * ORDER_FEE);
    }

    function test_PlaceOrder_RevertsOnZeroMinAmountOut() public {
        uint64 expiry = _expiry();
        vm.prank(alice);
        vm.expectRevert(OrderBook.ZeroMinAmountOut.selector);
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, 0, expiry
        );
    }

    function test_PlaceOrder_RevertsWhenExpiryIsBeyondTheMaximumLifetime() public {
        assertEq(book.MAX_ORDER_LIFETIME(), 7 days);
        uint64 latest = uint64(block.timestamp) + 7 days;
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.ExpiryTooFar.selector, latest + 1, uint256(latest)));
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, latest + 1
        );
        uint256 orderId = book.placeOrder{ value: ORDER_FEE }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, latest
        );
        vm.stopPrank();
        assertEq(book.getOrder(orderId).expiry, latest);
    }

    function test_PlaceOrder_RevertsWhenExpiryIsNotInTheFuture() public {
        uint64 now_ = uint64(block.timestamp);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.ExpiryNotInFuture.selector, now_));
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, now_
        );
        vm.expectRevert(abi.encodeWithSelector(OrderBook.ExpiryNotInFuture.selector, now_ - 1));
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, now_ - 1
        );
        vm.stopPrank();
    }

    function test_PlaceOrder_RevertsWithoutAllowance() public {
        address carol = makeAddr("carol");
        vm.deal(carol, 1 ether);
        weth.mint(carol, ONE_WETH);
        uint64 expiry = _expiry();
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(book), 0, ONE_WETH)
        );
        book.placeOrder{ value: ORDER_FEE }(
            address(weth), ONE_WETH, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT, expiry
        );
        assertEq(book.nextOrderId(), 1);
    }

    // --- cancellation ---

    function test_CancelOrder_RefundsOwnerAndMarksCancelled() public {
        uint256 orderId = _placeStopLoss(alice, ANY_OUT);
        vm.expectEmit(address(book));
        emit OrderBook.OrderCancelled(orderId);
        vm.prank(alice);
        book.cancelOrder(orderId);

        assertEq(weth.balanceOf(alice), USER_WETH);
        assertEq(weth.balanceOf(address(book)), 0);
        assertEq(uint8(_status(orderId)), uint8(OrderBook.Status.Cancelled));
    }

    function test_CancelOrder_RevertsForAnyoneButTheOwner() public {
        uint256 orderId = _placeStopLoss(alice, ANY_OUT);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.NotOrderOwner.selector, orderId, bob));
        book.cancelOrder(orderId);

        vm.expectRevert(abi.encodeWithSelector(OrderBook.NotOrderOwner.selector, orderId, address(this)));
        book.cancelOrder(orderId);
        assertEq(uint8(_status(orderId)), uint8(OrderBook.Status.Open));
    }

    function test_CancelOrder_RevertsWhenOrderIsNotOpen() public {
        uint256 cancelled = _placeStopLoss(alice, ANY_OUT);
        uint256 filled = _placeStopLoss(alice, ANY_OUT);
        vm.startPrank(alice);
        book.cancelOrder(cancelled);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.OrderNotOpen.selector, cancelled, OrderBook.Status.Cancelled));
        book.cancelOrder(cancelled);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.OrderNotOpen.selector, 99, OrderBook.Status.None));
        book.cancelOrder(99);
        vm.stopPrank();

        _execute(filled);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OrderBook.OrderNotOpen.selector, filled, OrderBook.Status.Filled));
        book.cancelOrder(filled);
    }

    function test_CancelOrder_ReclaimsExpiredOrderThatWasNeverTriggered() public {
        uint256 orderId = _placeStopLoss(alice, ANY_OUT);
        vm.warp(block.timestamp + ORDER_TTL + 1 days);
        vm.prank(alice);
        book.cancelOrder(orderId);
        assertEq(weth.balanceOf(alice), USER_WETH);
    }

    // --- callback authentication ---

    function test_ExecuteOrder_RevertsWhenCallerIsNotCallbackProxy() public {
        uint256 orderId = _placeStopLoss(alice, ANY_OUT);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, trader, address(proxy)));
        book.executeOrder(address(reactive), orderId, OBSERVED_PRICE, OBSERVED_AT);
    }

    function test_ExecuteOrder_RevertsWhenReactiveSenderIsNotAuthorized() public {
        uint256 orderId = _placeStopLoss(alice, ANY_OUT);
        bytes memory payload = _executePayload(orderId, OBSERVED_PRICE, OBSERVED_AT);
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, trader, address(reactive))
        );
        proxy.deliver(address(book), trader, payload);
        assertEq(uint8(_status(orderId)), uint8(OrderBook.Status.Open));
    }

    // --- outcomes ---

    function test_ExecuteOrder_FillsStopLossAndSendsUsdcStraightToOwner() public {
        uint256 bobOrder = _placeStopLoss(bob, ANY_OUT);
        uint256 orderId = _placeStopLoss(alice, 2_900 * ONE_USDC);
        uint256 expectedOut = _quoteWethIn(ONE_WETH);
        assertApproxEqAbs(expectedOut, 2_961.47e6, 0.01e6);

        _expectOutcome(orderId, OrderBook.Outcome.Filled, expectedOut);
        _execute(orderId);

        assertEq(uint8(_status(orderId)), uint8(OrderBook.Status.Filled));
        assertEq(usdc.balanceOf(alice), USER_USDC + expectedOut);
        assertEq(usdc.balanceOf(address(book)), 0, "output never rests in the book");
        assertEq(weth.balanceOf(address(book)), ONE_WETH, "bob's escrow untouched");
        assertEq(uint8(_status(bobOrder)), uint8(OrderBook.Status.Open));
        assertEq(bookPool.sequence(), 2);
    }

    function test_ExecuteOrder_FillsLimitBuyAndSendsWethStraightToOwner() public {
        uint256 orderId =
            _place(alice, address(usdc), LIMIT_BUY_USDC, OrderBook.Condition.PriceAtOrBelow, STOP_PRICE, ANY_OUT);
        (uint256 reserveWeth, uint256 reserveUsdc) = bookPool.getReserves();
        uint256 expectedOut = ArbMath.getAmountOut(LIMIT_BUY_USDC, reserveUsdc, reserveWeth, FEE_BPS);

        _expectOutcome(orderId, OrderBook.Outcome.Filled, expectedOut);
        _execute(orderId);

        assertEq(weth.balanceOf(alice), USER_WETH + expectedOut);
        assertEq(usdc.balanceOf(address(book)), 0);
        assertEq(weth.balanceOf(address(book)), 0);
    }

    function test_ExecuteOrder_SkipsOrderThatIsNotOpen() public {
        uint256 filled = _placeStopLoss(alice, ANY_OUT);
        uint256 cancelled = _placeStopLoss(alice, ANY_OUT);
        vm.prank(alice);
        book.cancelOrder(cancelled);
        _execute(filled);
        uint256 usdcAfterFill = usdc.balanceOf(alice);

        _expectOutcome(filled, OrderBook.Outcome.SkippedNotOpen, 0);
        _execute(filled);
        _expectOutcome(cancelled, OrderBook.Outcome.SkippedNotOpen, 0);
        _execute(cancelled);
        _expectOutcome(99, OrderBook.Outcome.SkippedNotOpen, 0);
        _execute(99);

        assertEq(usdc.balanceOf(alice), usdcAfterFill);
        assertEq(weth.balanceOf(address(book)), 0);
        assertEq(bookPool.sequence(), 2, "only the first fill swapped");
    }

    function test_ExecuteOrder_RefundsAndClosesExpiredOrder() public {
        uint256 orderId = _placeStopLoss(alice, ANY_OUT);
        vm.warp(book.getOrder(orderId).expiry + 1);

        _expectOutcome(orderId, OrderBook.Outcome.SkippedExpired, 0);
        _execute(orderId);

        assertEq(uint8(_status(orderId)), uint8(OrderBook.Status.Expired));
        assertEq(weth.balanceOf(alice), USER_WETH);
        assertEq(weth.balanceOf(address(book)), 0);
        assertEq(bookPool.sequence(), 1, "no swap");
    }

    function test_ExecuteOrder_FillsExactlyAtExpiry() public {
        uint256 orderId = _placeStopLoss(alice, ANY_OUT);
        vm.warp(book.getOrder(orderId).expiry);
        _execute(orderId);
        assertEq(uint8(_status(orderId)), uint8(OrderBook.Status.Filled));
    }

    function test_ExecuteOrder_SlippageKeepsOrderOpenAndEscrowedUntilAFillableCallback() public {
        uint256 minOut = _quoteWethIn(ONE_WETH) + 1;
        uint256 orderId = _placeStopLoss(alice, minOut);

        _expectOutcome(orderId, OrderBook.Outcome.SkippedSlippage, 0);
        _execute(orderId);

        assertEq(uint8(_status(orderId)), uint8(OrderBook.Status.Open));
        assertEq(weth.balanceOf(address(book)), ONE_WETH);
        assertEq(usdc.balanceOf(alice), USER_USDC);
        assertEq(bookPool.sequence(), 1, "the reverted swap left no trace");

        // A buyer lifts the execution pool's price; the next callback for the same order fills.
        vm.prank(trader);
        bookPool.swap(address(usdc), 3_000 * ONE_USDC, 0, trader);
        uint256 expectedOut = _quoteWethIn(ONE_WETH);
        assertGe(expectedOut, minOut);

        _expectOutcome(orderId, OrderBook.Outcome.Filled, expectedOut);
        _execute(orderId);
        assertEq(usdc.balanceOf(alice), USER_USDC + expectedOut);
    }

    function test_ExecuteOrder_DoesNotRevertOnHugeMinAmountOut() public {
        uint256 orderId = _placeStopLoss(alice, type(uint256).max);
        _expectOutcome(orderId, OrderBook.Outcome.SkippedSlippage, 0);
        _execute(orderId);
        assertEq(uint8(_status(orderId)), uint8(OrderBook.Status.Open));
    }

    // --- callback funding ---

    function test_Receive_AcceptsNativeFundingForCallbacks() public {
        (bool success,) = address(book).call{ value: 1 ether }("");
        assertTrue(success);
        assertEq(address(book).balance, 1 ether);
    }

    function test_CoverDebt_PaysProxyFromNativeBalance() public {
        vm.deal(address(book), 1 ether);
        proxy.setDebt(address(book), 0.2 ether);
        book.coverDebt();
        assertEq(address(proxy).balance, 0.2 ether);
        assertEq(address(book).balance, 0.8 ether);
    }

    function test_Pay_OnlyCallbackProxyCanCollect() public {
        vm.deal(address(book), 1 ether);
        vm.prank(address(proxy));
        book.pay(0.1 ether);
        assertEq(address(proxy).balance, 0.1 ether);

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, trader, address(proxy)));
        book.pay(0.1 ether);
    }

    function test_WithdrawNative_OnlyOwner() public {
        address treasury = makeAddr("treasury");
        vm.deal(address(book), 1 ether);
        book.withdrawNative(payable(treasury), 0.4 ether);
        assertEq(treasury.balance, 0.4 ether);

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, trader));
        book.withdrawNative(payable(trader), 1);
    }
}
