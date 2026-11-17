// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { OrderBook } from "../../src/orders/OrderBook.sol";
import { OrderReactive } from "../../src/orders/OrderReactive.sol";
import { OrderFixture } from "../utils/OrderFixture.sol";

/// @dev Fuzz handler: feeds placements, cancels, outcomes and price logs for a small id range and three owners
///      to the mirror, in any order, including duplicates and logs for ids it has never seen. Price time only
///      moves forward, by up to 600 s per price log, and half the outcomes are slippage (which re-arms), so
///      timeouts, expiries and the attempt cap are all reached within a run.
contract OrderMirrorHandler is OrderFixture {
    uint256 public constant ID_RANGE = 10;
    uint256 public constant OWNER_COUNT = 3;
    uint256 private constant MAX_STEP = 600;
    uint256 private constant MAX_LIFETIME = 6_000;

    /// @notice executeOrder callbacks requested per order id, counted from the system contract's records.
    mapping(uint256 => uint256) public callbacksFor;

    uint256 private sequence;
    uint256 private clock = START_TIME;
    uint256 private countedCallbacks;

    constructor() {
        _deployOrders();
    }

    function mirror() external view returns (OrderReactive) {
        return reactive;
    }

    function ownerAt(uint256 index) public view returns (address) {
        return [alice, bob, trader][index % OWNER_COUNT];
    }

    /// @dev Decodes the order id of an executeOrder payload; external so the selector can be sliced off.
    function orderIdOf(bytes calldata payload) external pure returns (uint256 orderId) {
        (, orderId,,) = abi.decode(payload[4:], (address, uint256, uint256, uint256));
    }

    function place(uint256 idSeed, uint256 ownerSeed, bool isAbove, uint256 priceSeed, uint256 lifetimeSeed) external {
        OrderBook.Condition condition =
            isAbove ? OrderBook.Condition.PriceAtOrAbove : OrderBook.Condition.PriceAtOrBelow;
        uint256 expiry = clock + lifetimeSeed % MAX_LIFETIME;
        _react(_placedLogExpiring(_id(idSeed), ownerAt(ownerSeed), condition, _price(priceSeed), expiry));
    }

    function cancel(uint256 idSeed) external {
        _react(_cancelledLog(_id(idSeed)));
    }

    function outcome(uint256 idSeed, uint256 outcomeSeed, bool isSlippage) external {
        OrderBook.Outcome kind = isSlippage ? OrderBook.Outcome.SkippedSlippage : OrderBook.Outcome(outcomeSeed % 4);
        _react(_outcomeLog(_id(idSeed), kind));
    }

    function movePrice(uint256 priceSeed, uint256 secondsSeed) external {
        clock += secondsSeed % MAX_STEP;
        _react(_priceLog(_price(priceSeed), ++sequence, clock));
        uint256 total = system.callbackCount();
        for (; countedCallbacks < total; countedCallbacks++) {
            callbacksFor[this.orderIdOf(system.callbackAt(countedCallbacks).payload)] += 1;
        }
    }

    function _id(uint256 seed) private pure returns (uint256) {
        return 1 + seed % ID_RANGE;
    }

    function _price(uint256 seed) private pure returns (uint256) {
        return 2_800 * ONE_USDC + seed % (400 * ONE_USDC);
    }
}

contract OrderReactiveInvariantTest is Test {
    OrderMirrorHandler private handler;
    OrderReactive private reactive;

    function setUp() public {
        handler = new OrderMirrorHandler();
        reactive = handler.mirror();

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = OrderMirrorHandler.place.selector;
        selectors[1] = OrderMirrorHandler.cancel.selector;
        selectors[2] = OrderMirrorHandler.outcome.selector;
        selectors[3] = OrderMirrorHandler.movePrice.selector;
        targetContract(address(handler));
        targetSelector(StdInvariant.FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 128
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_PerOwnerCountsMatchTheTrackedList() public view {
        uint256[] memory ids = reactive.trackedIds();
        uint256 total;
        for (uint256 o = 0; o < handler.OWNER_COUNT(); o++) {
            address owner = handler.ownerAt(o);
            uint256 counted = reactive.trackedPerOwner(owner);
            assertLe(counted, reactive.MAX_TRACKED_PER_OWNER(), "per-owner cap");
            assertEq(counted, _trackedOwnedBy(ids, owner), "per-owner count matches the list");
            total += counted;
        }
        assertEq(total, ids.length, "per-owner counts sum to the list");
        assertEq(reactive.trackedCount(), ids.length);
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 128
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_TrackedMeansOpenOrPendingAndInTheList() public view {
        uint256[] memory ids = reactive.trackedIds();
        for (uint256 id = 1; id <= handler.ID_RANGE(); id++) {
            OrderReactive.MirroredOrder memory order = reactive.getOrder(id);
            bool isLive =
                order.state == OrderReactive.MirrorState.Open || order.state == OrderReactive.MirrorState.Pending;
            bool isListed = _contains(ids, id);
            assertEq(reactive.isTracked(id), isListed, "slot map agrees with the list");
            if (isListed) assertTrue(isLive, "only Open or Pending orders are tracked");
            assertLe(order.slippageCount, reactive.MAX_SLIPPAGE_RETRIES(), "retry cap");
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 128
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_NoTrackedOrderOutlivesItsExpiry() public view {
        uint256[] memory ids = reactive.trackedIds();
        uint256 priceTime = reactive.lastSourceTimestamp();
        for (uint256 i = 0; i < ids.length; i++) {
            assertGe(reactive.getOrder(ids[i]).expiry, priceTime, "expired order still tracked");
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 128
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_CallbacksPerOrderMatchAttemptsAndStayWithinTheCap() public view {
        for (uint256 id = 1; id <= handler.ID_RANGE(); id++) {
            uint256 attempts = reactive.getOrder(id).attempts;
            assertEq(handler.callbacksFor(id), attempts, "one attempt per callback");
            assertLe(attempts, reactive.MAX_TRIGGER_ATTEMPTS(), "attempt cap");
        }
    }

    function _trackedOwnedBy(uint256[] memory ids, address owner) private view returns (uint256 count) {
        for (uint256 i = 0; i < ids.length; i++) {
            if (reactive.getOrder(ids[i]).owner == owner) count++;
        }
    }

    function _contains(uint256[] memory ids, uint256 id) private pure returns (bool) {
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == id) return true;
        }
        return false;
    }
}
