// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { TestToken } from "../../src/fixtures/TestToken.sol";
import { ConstantProductPool } from "../../src/fixtures/ConstantProductPool.sol";
import { OrderBook } from "../../src/orders/OrderBook.sol";
import { OrderReactive } from "../../src/orders/OrderReactive.sol";
import { MockSystemContract } from "../mocks/MockSystemContract.sol";
import { MockCallbackProxy } from "../mocks/MockCallbackProxy.sol";

/// @dev Protective-order fixture. Everything runs on one local chain; the LogRecords carry the chain IDs the
///      network would report: the price pool stands in for Pool A on Base Sepolia, the order book and its
///      execution pool for Unichain Sepolia. Both pools start at 100 WETH / 300,000 USDC (3,000 USDC per WETH).
abstract contract OrderFixture is Test {
    address internal constant SYSTEM_ADDRESS = 0x8888888888888888888888888888888888888888;
    uint256 internal constant PRICE_CHAIN_ID = 84532;
    uint256 internal constant ORDER_CHAIN_ID = 1301;
    uint256 internal constant ONE_WETH = 1e18;
    uint256 internal constant ONE_USDC = 1e6;
    uint256 internal constant POOL_WETH = 100 * ONE_WETH;
    uint256 internal constant POOL_USDC = 300_000 * ONE_USDC;
    uint256 internal constant PRICE_3000 = 3_000 * ONE_USDC;
    uint256 internal constant FEE_BPS = 30;
    uint64 internal constant CALLBACK_GAS = 600_000;
    uint256 internal constant MAX_TRIGGERS = 3;
    uint256 internal constant START_TIME = 1_800_000_000;
    uint64 internal constant ORDER_TTL = 1 days;
    uint256 internal constant USER_WETH = 100 * ONE_WETH;
    uint256 internal constant USER_USDC = 1_000_000 * ONE_USDC;
    uint256 internal constant ORDER_FEE = 0.0001 ether;
    /// @dev Smallest accepted minAmountOut: the order takes whatever the pool pays.
    uint256 internal constant ANY_OUT = 1;

    TestToken internal weth;
    TestToken internal usdc;
    ConstantProductPool internal pricePool;
    ConstantProductPool internal bookPool;
    MockSystemContract internal system;
    MockCallbackProxy internal proxy;
    OrderBook internal book;
    OrderReactive internal reactive;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal trader = makeAddr("trader");

    struct RelayedOutcome {
        uint256 orderId;
        OrderBook.Outcome outcome;
        uint256 amountOut;
        uint256 observedPrice;
        uint256 sourceTimestamp;
    }

    /// @dev Last OrderOutcome the relay fed back to the Reactive contract.
    RelayedOutcome internal lastRelayedOutcome;

    uint256 private nextTxHash = 1;
    uint256 private deliveredCallbacks;

    function _deployOrders() internal {
        vm.warp(START_TIME);
        vm.etch(SYSTEM_ADDRESS, address(new MockSystemContract()).code);
        system = MockSystemContract(payable(SYSTEM_ADDRESS));
        proxy = new MockCallbackProxy();

        weth = new TestToken("Test Wrapped Ether", "tWETH", 18, address(this));
        usdc = new TestToken("Test USD Coin", "tUSDC", 6, address(this));
        pricePool = new ConstantProductPool(address(weth), address(usdc), FEE_BPS, address(this));
        bookPool = new ConstantProductPool(address(weth), address(usdc), FEE_BPS, address(this));
        _addLiquidity(pricePool, POOL_WETH, POOL_USDC);
        _addLiquidity(bookPool, POOL_WETH, POOL_USDC);

        address predictedReactive = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        book = new OrderBook(proxy, predictedReactive, bookPool, address(this));
        reactive = new OrderReactive(_config());
        assertEq(address(reactive), predictedReactive, "reactive address prediction");

        _fundUser(alice);
        _fundUser(bob);
        _fundUser(trader);
        vm.startPrank(trader);
        weth.approve(address(pricePool), type(uint256).max);
        usdc.approve(address(pricePool), type(uint256).max);
        weth.approve(address(bookPool), type(uint256).max);
        usdc.approve(address(bookPool), type(uint256).max);
        vm.stopPrank();
    }

    function _config() internal view returns (OrderReactive.Config memory) {
        return OrderReactive.Config({
            priceChainId: PRICE_CHAIN_ID,
            pricePool: address(pricePool),
            orderChainId: ORDER_CHAIN_ID,
            orderBook: address(book),
            callbackGasLimit: CALLBACK_GAS,
            maxTriggersPerLog: MAX_TRIGGERS
        });
    }

    function _fundUser(address user) private {
        vm.deal(user, 1 ether);
        weth.mint(user, USER_WETH);
        usdc.mint(user, USER_USDC);
        vm.startPrank(user);
        weth.approve(address(book), type(uint256).max);
        usdc.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    function _addLiquidity(ConstantProductPool pool, uint256 wethAmount, uint256 usdcAmount) internal {
        weth.mint(address(this), wethAmount);
        usdc.mint(address(this), usdcAmount);
        weth.approve(address(pool), wethAmount);
        usdc.approve(address(pool), usdcAmount);
        pool.addLiquidity(wethAmount, usdcAmount);
    }

    function _expiry() internal view returns (uint64) {
        return uint64(block.timestamp) + ORDER_TTL;
    }

    function _place(
        address owner,
        address tokenIn,
        uint256 amountIn,
        OrderBook.Condition condition,
        uint256 triggerPrice,
        uint256 minAmountOut
    ) internal returns (uint256 orderId) {
        vm.prank(owner);
        orderId =
            book.placeOrder{ value: ORDER_FEE }(tokenIn, amountIn, condition, triggerPrice, minAmountOut, _expiry());
    }

    function _executePayload(uint256 orderId, uint256 observedPrice, uint256 sourceTimestamp)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(book.executeOrder, (address(0), orderId, observedPrice, sourceTimestamp));
    }

    // --- synthetic logs for OrderReactive unit tests ---

    /// @dev ReserveUpdate whose reserves give exactly `price` USDC base units per whole WETH.
    function _priceLog(uint256 price, uint256 sequence, uint256 timestamp)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        return _reserveLog(POOL_WETH, price * POOL_WETH / ONE_WETH, sequence, timestamp);
    }

    function _reserveLog(uint256 reserveWeth, uint256 reserveUsdc, uint256 sequence, uint256 timestamp)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        return IReactive.LogRecord({
            chainId: PRICE_CHAIN_ID,
            contractAddress: address(pricePool),
            topic0: reactive.RESERVE_UPDATE_TOPIC0(),
            topic1: uint256(uint160(trader)),
            topic2: 0,
            topic3: 0,
            data: abi.encode(reserveWeth, reserveUsdc, sequence, timestamp),
            blockNumber: 1_000 + sequence,
            opCode: 2,
            blockHash: 0,
            txHash: uint256(keccak256(abi.encode("price", sequence))),
            logIndex: 0
        });
    }

    /// @dev OrderPlaced by alice selling 1 WETH.
    function _placedLog(uint256 orderId, OrderBook.Condition condition, uint256 triggerPrice)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        return _placedLogBy(orderId, alice, address(weth), ONE_WETH, condition, triggerPrice);
    }

    /// @dev OrderPlaced by alice with the given input token and amount.
    function _placedLogFor(
        uint256 orderId,
        address tokenIn,
        uint256 amountIn,
        OrderBook.Condition condition,
        uint256 triggerPrice
    ) internal view returns (IReactive.LogRecord memory) {
        return _placedLogBy(orderId, alice, tokenIn, amountIn, condition, triggerPrice);
    }

    function _placedLogBy(
        uint256 orderId,
        address owner,
        address tokenIn,
        uint256 amountIn,
        OrderBook.Condition condition,
        uint256 triggerPrice
    ) internal view returns (IReactive.LogRecord memory) {
        return _placedLogWith(orderId, owner, tokenIn, amountIn, condition, triggerPrice, START_TIME + ORDER_TTL);
    }

    /// @dev OrderPlaced selling 1 WETH with an explicit expiry.
    function _placedLogExpiring(
        uint256 orderId,
        address owner,
        OrderBook.Condition condition,
        uint256 triggerPrice,
        uint256 expiry
    ) internal view returns (IReactive.LogRecord memory) {
        return _placedLogWith(orderId, owner, address(weth), ONE_WETH, condition, triggerPrice, expiry);
    }

    function _placedLogWith(
        uint256 orderId,
        address owner,
        address tokenIn,
        uint256 amountIn,
        OrderBook.Condition condition,
        uint256 triggerPrice,
        uint256 expiry
    ) private view returns (IReactive.LogRecord memory) {
        // The expiry is a uint64 in the event; a uint256 within range has the same ABI encoding.
        bytes memory data = abi.encode(tokenIn, amountIn, condition, triggerPrice, ANY_OUT, expiry);
        return _orderLog(reactive.ORDER_PLACED_TOPIC0(), orderId, uint256(uint160(owner)), data);
    }

    /// @dev A distinct owner per order id, for tests that place many orders without hitting the per-owner cap.
    function _ownerOf(uint256 orderId) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("order owner", orderId)))));
    }

    function _cancelledLog(uint256 orderId) internal view returns (IReactive.LogRecord memory) {
        return _orderLog(reactive.ORDER_CANCELLED_TOPIC0(), orderId, 0, "");
    }

    function _outcomeLog(uint256 orderId, OrderBook.Outcome outcome)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        bytes memory data = abi.encode(outcome, uint256(0), PRICE_3000, START_TIME, START_TIME);
        return _orderLog(reactive.ORDER_OUTCOME_TOPIC0(), orderId, 0, data);
    }

    function _orderLog(uint256 topic0, uint256 orderId, uint256 topic2, bytes memory data)
        private
        view
        returns (IReactive.LogRecord memory)
    {
        return IReactive.LogRecord({
            chainId: ORDER_CHAIN_ID,
            contractAddress: address(book),
            topic0: topic0,
            topic1: orderId,
            topic2: topic2,
            topic3: 0,
            data: data,
            blockNumber: 2_000,
            opCode: 3,
            blockHash: 0,
            txHash: uint256(keccak256(abi.encode(topic0, orderId))),
            logIndex: 0
        });
    }

    function _react(IReactive.LogRecord memory record) internal {
        vm.prank(SYSTEM_ADDRESS);
        reactive.react(record);
    }

    /// @dev Places one order on the mirror per id in [firstId, firstId + count), all with the same condition,
    ///      each from its own owner (_ownerOf) so the per-owner cap does not apply.
    function _mirrorPlaced(uint256 firstId, uint256 count, OrderBook.Condition condition, uint256 triggerPrice)
        internal
    {
        for (uint256 id = firstId; id < firstId + count; id++) {
            _react(_placedLogBy(id, _ownerOf(id), address(weth), ONE_WETH, condition, triggerPrice));
        }
    }

    function _mirrorState(uint256 orderId) internal view returns (OrderReactive.MirrorState state) {
        return reactive.getOrder(orderId).state;
    }

    // --- full local loop ---

    /// @dev Forwards every recorded log that matches one of the Reactive contract's subscriptions, with the
    ///      chain ID of that subscription, as the network does.
    function _relayLogsToReactive() internal returns (uint256 relayed) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            (bool isSubscribed, uint256 chainId) = _subscribedChain(logs[i]);
            if (!isSubscribed) continue;
            _react(
                IReactive.LogRecord({
                    chainId: chainId,
                    contractAddress: logs[i].emitter,
                    topic0: uint256(logs[i].topics[0]),
                    topic1: _topic(logs[i], 1),
                    topic2: _topic(logs[i], 2),
                    topic3: _topic(logs[i], 3),
                    data: logs[i].data,
                    blockNumber: block.number,
                    opCode: logs[i].topics.length,
                    blockHash: 0,
                    txHash: nextTxHash++,
                    logIndex: i
                })
            );
            if (logs[i].topics[0] == OrderBook.OrderOutcome.selector) _rememberOutcome(logs[i]);
            relayed++;
        }
    }

    function _rememberOutcome(Vm.Log memory log_) private {
        (OrderBook.Outcome outcome, uint256 amountOut, uint256 observedPrice, uint256 sourceTimestamp,) =
            abi.decode(log_.data, (OrderBook.Outcome, uint256, uint256, uint256, uint256));
        lastRelayedOutcome = RelayedOutcome(uint256(log_.topics[1]), outcome, amountOut, observedPrice, sourceTimestamp);
    }

    /// @dev Delivers pending callbacks through the proxy, as the validators do.
    function _deliverPendingCallbacks() internal returns (uint256 delivered) {
        uint256 total = system.callbackCount();
        for (; deliveredCallbacks < total; deliveredCallbacks++) {
            _deliverCallbackAt(deliveredCallbacks);
            delivered++;
        }
    }

    /// @dev Marks the pending callbacks as handled without delivering them, as if they were lost or delayed.
    function _holdPendingCallbacks() internal returns (uint256 held) {
        held = system.callbackCount() - deliveredCallbacks;
        deliveredCallbacks += held;
    }

    /// @dev Delivers one recorded callback by index, e.g. a held one that arrives late.
    function _deliverCallbackAt(uint256 index) internal {
        ISystemContract.CallbackConfiguration_V_1_0 memory callback = system.callbackAt(index);
        proxy.deliver(callback.recipient, system.callbackSenders(index), callback.payload);
    }

    function _subscribedChain(Vm.Log memory log_) private view returns (bool, uint256) {
        if (log_.topics.length == 0) return (false, 0);
        uint256 count = system.subscriptionCount();
        for (uint256 i = 0; i < count; i++) {
            (address subscriber, uint256 chainId, address source, uint256 topic0) = system.subscriptions(i);
            if (subscriber == address(reactive) && source == log_.emitter && topic0 == uint256(log_.topics[0])) {
                return (true, chainId);
            }
        }
        return (false, 0);
    }

    function _topic(Vm.Log memory log_, uint256 index) private pure returns (uint256) {
        return index < log_.topics.length ? uint256(log_.topics[index]) : 0;
    }
}
