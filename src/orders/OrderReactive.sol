// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractReactive } from "@reactive/src/base/AbstractReactive.sol";
import { OrderBook } from "./OrderBook.sol";

/// @title Reactive contract on Lasna: mirrors the order book from its events, watches the price pool and
///        requests an executeOrder callback for every open order whose condition holds.
/// @notice Every received log ends with exactly one audit event: PriceChecked, OrderMirrored or LogIgnored.
///         Inside a price log, before its closing PriceChecked, OrderMirrored records each tracked order evicted
///         by the scan (Expired, AttemptLimit) and OrderTriggered each callback requested.
/// @dev A triggered order stays Pending, and is not triggered again until its OrderOutcome arrives or
///      PENDING_TIMEOUT of price-chain time passes. Each owner holds at most MAX_TRACKED_PER_OWNER tracked
///      orders; an order gets at most MAX_TRIGGER_ATTEMPTS callbacks and stops being retried after
///      MAX_SLIPPAGE_RETRIES slippage outcomes; an expired order is evicted on the next price log.
///      Price unit: USDC base units (6 decimals) per one whole WETH, as in OrderBook.
contract OrderReactive is AbstractReactive {
    enum MirrorState {
        None,
        Open,
        Pending,
        Closed
    }

    /// @dev Why an order-book log left the mirror in its state. NoChange covers duplicate or late logs.
    ///      PlacedUntracked and OwnerLimit leave an Open order untracked (MAX_TRACKED, MAX_TRACKED_PER_OWNER);
    ///      RetryLimit (MAX_SLIPPAGE_RETRIES slippage outcomes) and AttemptLimit (MAX_TRIGGER_ATTEMPTS callbacks)
    ///      close the mirror while the order stays Open in the order book. Expired and AttemptLimit are also
    ///      recorded during a price scan, when a tracked order is evicted.
    enum MirrorReason {
        Placed,
        PlacedUntracked,
        Cancelled,
        Filled,
        Expired,
        NotOpen,
        Rearmed,
        NoChange,
        OwnerLimit,
        RetryLimit,
        AttemptLimit
    }

    enum IgnoreReason {
        UnknownSource,
        StaleOrDuplicatePrice,
        EmptyPool,
        ZeroPrice
    }

    struct Config {
        uint256 priceChainId;
        address pricePool;
        uint256 orderChainId;
        address orderBook;
        uint64 callbackGasLimit;
        uint256 maxTriggersPerLog; // callbacks requested per price log, 1..10
    }

    /// @dev The first six fields share one storage slot.
    struct MirroredOrder {
        address owner;
        OrderBook.Condition condition;
        MirrorState state;
        uint8 slippageCount; // SkippedSlippage outcomes received while Pending
        uint8 attempts; // callbacks requested, timeouts included
        uint64 expiry; // from OrderPlaced; compared with price-chain time
        uint256 triggerPrice;
        uint256 pendingSince; // price-chain time of the last trigger
    }

    /// @notice Open or Pending orders watched at once. An order placed beyond it is never triggered;
    ///         its owner can still cancel it on the order book.
    uint256 public constant MAX_TRACKED = 64;
    /// @notice Open or Pending orders watched at once per owner, so one visitor cannot take every slot.
    uint256 public constant MAX_TRACKED_PER_OWNER = 4;
    /// @notice Slippage outcomes after which the mirror stops retrying an order.
    uint256 public constant MAX_SLIPPAGE_RETRIES = 3;
    /// @notice Price-chain seconds after which a Pending order whose callback never answered may trigger again.
    uint256 public constant PENDING_TIMEOUT = 300;
    /// @notice Callbacks requested per order at most, timeouts included.
    uint256 public constant MAX_TRIGGER_ATTEMPTS = 5;
    /// @dev Event selectors are not compile-time constants, so the topics are hashed from the signatures;
    ///      the tests pin them to IArbPool.ReserveUpdate and the OrderBook events. Enums encode as uint8.
    uint256 public constant RESERVE_UPDATE_TOPIC0 =
        uint256(keccak256("ReserveUpdate(address,uint256,uint256,uint256,uint256)"));
    uint256 public constant ORDER_PLACED_TOPIC0 =
        uint256(keccak256("OrderPlaced(uint256,address,address,uint256,uint8,uint256,uint256,uint64)"));
    uint256 public constant ORDER_CANCELLED_TOPIC0 = uint256(keccak256("OrderCancelled(uint256)"));
    uint256 public constant ORDER_OUTCOME_TOPIC0 =
        uint256(keccak256("OrderOutcome(uint256,uint8,uint256,uint256,uint256,uint256)"));
    /// @dev executeOrder makes one swap (ArbExecutor makes two); the same floor as ArbReactive leaves headroom.
    uint64 private constant MIN_CALLBACK_GAS = 300_000;
    uint256 private constant MAX_TRIGGERS_CAP = 10;
    uint256 private constant WETH_UNIT = 1e18;

    uint256 public immutable PRICE_CHAIN_ID;
    address public immutable PRICE_POOL;
    uint256 public immutable ORDER_CHAIN_ID;
    address public immutable ORDER_BOOK;
    uint64 public immutable CALLBACK_GAS_LIMIT;
    uint256 public immutable MAX_TRIGGERS_PER_LOG;

    mapping(uint256 => MirroredOrder) private _orders;
    /// @notice Sequence, price and source time of the last accepted ReserveUpdate.
    uint256 public lastSequence;
    uint256 public lastPrice;
    uint256 public lastSourceTimestamp;

    /// @notice Tracked (Open or Pending) orders per owner; always sums to trackedCount().
    mapping(address => uint256) public trackedPerOwner;

    uint256[] private _trackedIds;
    /// @dev Position in _trackedIds plus one; 0 means not tracked.
    mapping(uint256 => uint256) private _trackedSlot;
    /// @dev Position after the last triggered slot; the next trigger scan starts there (modulo the list length).
    uint256 private _scanCursor;

    /// @param triggered Number of callbacks requested for this price.
    event PriceChecked(uint256 sequence, uint256 price, uint256 sourceTimestamp, uint256 triggered);
    /// @param afterTimeout True when the order was still Pending and its previous callback had not answered
    ///        within PENDING_TIMEOUT; the order book answers a late duplicate with SkippedNotOpen.
    event OrderTriggered(uint256 indexed orderId, uint256 price, uint256 sourceTimestamp, bool afterTimeout);
    event OrderMirrored(uint256 indexed orderId, MirrorState state, MirrorReason reason);
    event LogIgnored(
        IgnoreReason reason, uint256 chainId, address source, uint256 topic0, uint256 txHash, uint256 logIndex
    );

    error InvalidConfig();

    constructor(Config memory config_) payable {
        if (
            config_.pricePool == address(0) || config_.orderBook == address(0)
                || (config_.priceChainId == config_.orderChainId && config_.pricePool == config_.orderBook)
                || config_.callbackGasLimit < MIN_CALLBACK_GAS || config_.maxTriggersPerLog == 0
                || config_.maxTriggersPerLog > MAX_TRIGGERS_CAP
        ) revert InvalidConfig();

        PRICE_CHAIN_ID = config_.priceChainId;
        PRICE_POOL = config_.pricePool;
        ORDER_CHAIN_ID = config_.orderChainId;
        ORDER_BOOK = config_.orderBook;
        CALLBACK_GAS_LIMIT = config_.callbackGasLimit;
        MAX_TRIGGERS_PER_LOG = config_.maxTriggersPerLog;

        _subscribe(config_.priceChainId, config_.pricePool, RESERVE_UPDATE_TOPIC0);
        _subscribe(config_.orderChainId, config_.orderBook, ORDER_PLACED_TOPIC0);
        _subscribe(config_.orderChainId, config_.orderBook, ORDER_CANCELLED_TOPIC0);
        _subscribe(config_.orderChainId, config_.orderBook, ORDER_OUTCOME_TOPIC0);
    }

    /// @notice Called by the system contract for every log that matches a subscription.
    function react(LogRecord calldata log_) external onlySystem {
        if (_isPriceLog(log_)) {
            _onPrice(log_);
        } else if (_isOrderLog(log_)) {
            _onOrderLog(log_);
        } else {
            _ignore(log_, IgnoreReason.UnknownSource);
        }
    }

    function trackedCount() external view returns (uint256) {
        return _trackedIds.length;
    }

    /// @notice IDs of the Open and Pending orders being watched, in scan order.
    function trackedIds() external view returns (uint256[] memory) {
        return _trackedIds;
    }

    function isTracked(uint256 orderId) external view returns (bool) {
        return _trackedSlot[orderId] != 0;
    }

    /// @notice The mirror's view of an order; state None for an id it has never seen.
    function getOrder(uint256 orderId) external view returns (MirroredOrder memory) {
        return _orders[orderId];
    }

    /// @notice Pays off the debt to the system contract from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    // --- price logs ---

    function _onPrice(LogRecord calldata log_) private {
        (uint256 reserveWeth, uint256 reserveUsdc, uint256 sequence, uint256 sourceTimestamp) =
            abi.decode(log_.data, (uint256, uint256, uint256, uint256));
        if (sequence <= lastSequence) return _ignore(log_, IgnoreReason.StaleOrDuplicatePrice);
        if (reserveWeth == 0) return _ignore(log_, IgnoreReason.EmptyPool);
        uint256 price = Math.mulDiv(reserveUsdc, WETH_UNIT, reserveWeth);
        if (price == 0) return _ignore(log_, IgnoreReason.ZeroPrice);

        lastSequence = sequence;
        lastPrice = price;
        lastSourceTimestamp = sourceTimestamp;

        _evictDeadOrders(sourceTimestamp);
        uint256 triggered = _triggerOrders(price, sourceTimestamp);
        emit PriceChecked(sequence, price, sourceTimestamp, triggered);
    }

    /// @dev First phase of a price scan: closes every tracked order that can never trigger again, recording each
    ///      with OrderMirrored. In-place swap-and-pop over the whole list: a freed slot is refilled from the end
    ///      and checked again, so the loop runs exactly once per tracked order.
    function _evictDeadOrders(uint256 sourceTimestamp) private {
        uint256 i = 0;
        while (i < _trackedIds.length) {
            uint256 orderId = _trackedIds[i];
            (bool isDead, MirrorReason reason) = _deathReason(_orders[orderId], sourceTimestamp);
            if (!isDead) {
                i++;
                continue;
            }
            _close(orderId, reason);
            emit OrderMirrored(orderId, MirrorState.Closed, reason);
        }
    }

    /// @dev Expired: the order's expiry is before the price-chain time, so the order book could only refund it.
    ///      AttemptLimit: its last allowed callback timed out. Within the timeout the last outcome is awaited.
    function _deathReason(MirroredOrder storage order, uint256 sourceTimestamp)
        private
        view
        returns (bool isDead, MirrorReason reason)
    {
        if (order.expiry < sourceTimestamp) return (true, MirrorReason.Expired);
        if (order.attempts >= MAX_TRIGGER_ATTEMPTS && _timedOut(order, sourceTimestamp)) {
            return (true, MirrorReason.AttemptLimit);
        }
        return (false, MirrorReason.NoChange);
    }

    /// @dev Second phase: scans the tracked list once, starting after the slot that triggered last, and stops
    ///      after MAX_TRIGGERS_PER_LOG callbacks; the remaining orders trigger on a later price log. The rotating
    ///      start keeps early slots from always winning. The list itself is not modified here.
    function _triggerOrders(uint256 price, uint256 sourceTimestamp) private returns (uint256 triggered) {
        uint256 count = _trackedIds.length;
        uint256 start = count == 0 ? 0 : _scanCursor % count;
        for (uint256 k = 0; k < count && triggered < MAX_TRIGGERS_PER_LOG; k++) {
            uint256 position = (start + k) % count;
            uint256 orderId = _trackedIds[position];
            MirroredOrder storage order = _orders[orderId];
            (bool isArmed, bool afterTimeout) = _armed(order, sourceTimestamp);
            if (!isArmed || !_conditionHolds(order, price)) continue;

            order.state = MirrorState.Pending;
            order.pendingSince = sourceTimestamp;
            order.attempts += 1;
            _requestCallback(orderId, price, sourceTimestamp);
            emit OrderTriggered(orderId, price, sourceTimestamp, afterTimeout);
            triggered++;
            _scanCursor = position + 1;
        }
    }

    /// @dev An Open order is armed. A Pending order is armed again once PENDING_TIMEOUT of price-chain time has
    ///      passed without an OrderOutcome; it stays Pending until it actually triggers, so a late outcome of
    ///      the first callback is still handled as the outcome of a Pending order. Orders out of attempts never
    ///      get here: the eviction phase has closed them.
    function _armed(MirroredOrder storage order, uint256 sourceTimestamp)
        private
        view
        returns (bool isArmed, bool afterTimeout)
    {
        if (order.state == MirrorState.Open) return (true, false);
        afterTimeout = _timedOut(order, sourceTimestamp);
        return (afterTimeout, afterTimeout);
    }

    function _timedOut(MirroredOrder storage order, uint256 sourceTimestamp) private view returns (bool) {
        return order.state == MirrorState.Pending && sourceTimestamp >= order.pendingSince + PENDING_TIMEOUT;
    }

    function _conditionHolds(MirroredOrder storage order, uint256 price) private view returns (bool) {
        return order.condition == OrderBook.Condition.PriceAtOrBelow
            ? price <= order.triggerPrice
            : price >= order.triggerPrice;
    }

    function _requestCallback(uint256 orderId, uint256 price, uint256 sourceTimestamp) private {
        bytes memory payload = abi.encodeCall(OrderBook.executeOrder, (address(0), orderId, price, sourceTimestamp));
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: ORDER_CHAIN_ID, recipient: ORDER_BOOK, gasLimit: CALLBACK_GAS_LIMIT, payload: payload
            })
        );
    }

    // --- order-book logs ---

    function _onOrderLog(LogRecord calldata log_) private {
        uint256 orderId = log_.topic1;
        MirrorState state;
        MirrorReason reason;
        if (log_.topic0 == ORDER_PLACED_TOPIC0) {
            (state, reason) = _onPlaced(orderId, address(uint160(log_.topic2)), log_.data);
        } else if (log_.topic0 == ORDER_CANCELLED_TOPIC0) {
            (state, reason) = _close(orderId, MirrorReason.Cancelled);
        } else {
            (state, reason) = _onOutcome(orderId, log_.data);
        }
        emit OrderMirrored(orderId, state, reason);
    }

    /// @dev Only an unseen id is mirrored, so a duplicate or late placement never resurrects an order or takes
    ///      a slot. An order over a cap is mirrored Open but untracked, and is never adopted later.
    function _onPlaced(uint256 orderId, address orderOwner, bytes calldata data)
        private
        returns (MirrorState, MirrorReason)
    {
        MirroredOrder storage order = _orders[orderId];
        if (order.state != MirrorState.None) return (order.state, MirrorReason.NoChange);

        (,, OrderBook.Condition condition, uint256 triggerPrice,, uint64 expiry) =
            abi.decode(data, (address, uint256, OrderBook.Condition, uint256, uint256, uint64));
        order.owner = orderOwner;
        order.condition = condition;
        order.expiry = expiry;
        order.triggerPrice = triggerPrice;
        order.state = MirrorState.Open;

        if (trackedPerOwner[orderOwner] >= MAX_TRACKED_PER_OWNER) return (MirrorState.Open, MirrorReason.OwnerLimit);
        if (_trackedIds.length >= MAX_TRACKED) return (MirrorState.Open, MirrorReason.PlacedUntracked);
        _track(orderId, orderOwner);
        return (MirrorState.Open, MirrorReason.Placed);
    }

    function _onOutcome(uint256 orderId, bytes calldata data) private returns (MirrorState, MirrorReason) {
        (OrderBook.Outcome outcome,,,,) = abi.decode(data, (OrderBook.Outcome, uint256, uint256, uint256, uint256));
        if (outcome == OrderBook.Outcome.SkippedSlippage) return _onSlippage(orderId);
        if (outcome == OrderBook.Outcome.Filled) return _close(orderId, MirrorReason.Filled);
        if (outcome == OrderBook.Outcome.SkippedExpired) return _close(orderId, MirrorReason.Expired);
        return _close(orderId, MirrorReason.NotOpen);
    }

    /// @dev Only a Pending order counts the slippage. While both slippage retries and trigger attempts remain
    ///      it goes back to Open and triggers again on a later price log; otherwise the mirror closes it
    ///      (RetryLimit first, then AttemptLimit), while the order stays Open in the order book for its owner
    ///      to cancel.
    function _onSlippage(uint256 orderId) private returns (MirrorState, MirrorReason) {
        MirroredOrder storage order = _orders[orderId];
        if (order.state != MirrorState.Pending) return (order.state, MirrorReason.NoChange);
        order.slippageCount += 1;
        if (order.slippageCount >= MAX_SLIPPAGE_RETRIES) return _close(orderId, MirrorReason.RetryLimit);
        if (order.attempts >= MAX_TRIGGER_ATTEMPTS) return _close(orderId, MirrorReason.AttemptLimit);
        order.state = MirrorState.Open;
        return (MirrorState.Open, MirrorReason.Rearmed);
    }

    /// @dev The order book is the source of truth: a terminal log closes the order whatever the mirror held.
    function _close(uint256 orderId, MirrorReason reason) private returns (MirrorState, MirrorReason) {
        _orders[orderId].state = MirrorState.Closed;
        _untrack(orderId);
        return (MirrorState.Closed, reason);
    }

    /// @dev The only way into the tracked set; keeps trackedPerOwner in step with the list.
    function _track(uint256 orderId, address orderOwner) private {
        _trackedIds.push(orderId);
        _trackedSlot[orderId] = _trackedIds.length;
        trackedPerOwner[orderOwner] += 1;
    }

    /// @dev The only way out of the tracked set: O(1) swap-and-pop, and a no-op for an id that is not
    ///      tracked, so an order closed twice or never tracked frees no owner slot.
    function _untrack(uint256 orderId) private {
        uint256 slot = _trackedSlot[orderId];
        if (slot == 0) return;
        uint256 lastId = _trackedIds[_trackedIds.length - 1];
        _trackedIds[slot - 1] = lastId;
        _trackedSlot[lastId] = slot;
        _trackedIds.pop();
        delete _trackedSlot[orderId];
        trackedPerOwner[_orders[orderId].owner] -= 1;
    }

    // --- sources ---

    function _isPriceLog(LogRecord calldata log_) private view returns (bool) {
        return
            log_.chainId == PRICE_CHAIN_ID && log_.contractAddress == PRICE_POOL && log_.topic0 == RESERVE_UPDATE_TOPIC0;
    }

    function _isOrderLog(LogRecord calldata log_) private view returns (bool) {
        if (log_.chainId != ORDER_CHAIN_ID || log_.contractAddress != ORDER_BOOK) return false;
        return log_.topic0 == ORDER_PLACED_TOPIC0 || log_.topic0 == ORDER_CANCELLED_TOPIC0
            || log_.topic0 == ORDER_OUTCOME_TOPIC0;
    }

    function _ignore(LogRecord calldata log_, IgnoreReason reason) private {
        emit LogIgnored(reason, log_.chainId, log_.contractAddress, log_.topic0, log_.txHash, log_.logIndex);
    }

    function _subscribe(uint256 chainId, address source, uint256 topic0) private {
        SYSTEM.subscribe(chainId, source, topic0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }
}
