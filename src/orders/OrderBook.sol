// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { IArbPool } from "../interfaces/IArbPool.sol";

/// @title Protective orders (stop-loss, take-profit, limit buy) escrowed on the order chain (Unichain Sepolia).
/// @notice Users escrow the input token; the Reactive contract watches a price on another chain and calls
///         executeOrder through the callback proxy. Every callback ends with exactly one OrderOutcome event.
///         A skip never reverts, because the callback proxy still charges for a failed callback.
///         Each placement pays a non-refundable ORDER_FEE in native currency; the fees stay in this contract's
///         balance, which the callback proxy collects from (pay / coverDebt), so every order prepays its callbacks.
/// @dev Price unit everywhere: USDC base units (6 decimals) per one whole WETH. Stop-loss = WETH in with
///      PriceAtOrBelow, take-profit = WETH in with PriceAtOrAbove, limit buy = USDC in with PriceAtOrBelow.
///      The trigger price is checked on Lasna; the user's only guard on the execution pool is minAmountOut.
contract OrderBook is AbstractCallback, Ownable {
    using SafeERC20 for IERC20;

    enum Condition {
        PriceAtOrBelow,
        PriceAtOrAbove
    }

    enum Status {
        None,
        Open,
        Filled,
        Cancelled,
        Expired
    }

    enum Outcome {
        Filled,
        SkippedNotOpen,
        SkippedExpired,
        SkippedSlippage
    }

    /// @dev The first four fields share one storage slot.
    struct Order {
        address owner;
        uint64 expiry;
        Condition condition;
        Status status;
        address tokenIn;
        uint256 amountIn;
        uint256 triggerPrice;
        uint256 minAmountOut;
    }

    /// @notice Smallest order per input token (0.001 WETH, 1 USDC), so one faucet claim cannot open
    ///         thousands of orders.
    uint256 public constant MIN_WETH_IN = 1e15;
    uint256 public constant MIN_USDC_IN = 1e6;
    /// @notice Native fee paid with every placement. It is not refunded, also not on cancel or expiry: it stays
    ///         in this contract's balance, from which the callback proxy is paid, so each order prepays its
    ///         own callbacks.
    uint256 public constant ORDER_FEE = 0.0001 ether;
    /// @notice Longest time an order may stay open, from placement to expiry.
    uint256 public constant MAX_ORDER_LIFETIME = 7 days;

    IArbPool public immutable POOL;
    IERC20 public immutable WETH;
    IERC20 public immutable USDC;

    /// @notice ID the next placed order receives. IDs start at 1, so 0 never names an order.
    uint256 public nextOrderId = 1;

    mapping(uint256 => Order) private _orders;

    event OrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        address tokenIn,
        uint256 amountIn,
        Condition condition,
        uint256 triggerPrice,
        uint256 minAmountOut,
        uint64 expiry
    );

    event OrderCancelled(uint256 indexed orderId);

    /// @param amountOut Output sent to the order owner (0 unless Filled).
    /// @param observedPrice Price on the price chain that triggered the callback, as reported by Lasna.
    /// @param sourceTimestamp Price-chain block time of that observation.
    /// @param timestamp Block time of this callback on the order chain.
    event OrderOutcome(
        uint256 indexed orderId,
        Outcome outcome,
        uint256 amountOut,
        uint256 observedPrice,
        uint256 sourceTimestamp,
        uint256 timestamp
    );

    error UnsupportedToken(address token);
    error ZeroAmount();
    error OrderTooSmall(uint256 amountIn, uint256 minimum);
    error ZeroTriggerPrice();
    error ZeroMinAmountOut();
    error ExpiryNotInFuture(uint64 expiry);
    error ExpiryTooFar(uint64 expiry, uint256 latest);
    error WrongOrderFee(uint256 sent, uint256 required);
    error NotOrderOwner(uint256 orderId, address caller);
    error OrderNotOpen(uint256 orderId, Status status);

    constructor(IPayable callbackProxy_, address reactiveContract_, IArbPool pool_, address owner_)
        payable
        AbstractCallback(callbackProxy_, reactiveContract_)
        Ownable(owner_)
    {
        POOL = pool_;
        WETH = IERC20(pool_.weth());
        USDC = IERC20(pool_.usdc());

        WETH.forceApprove(address(pool_), type(uint256).max);
        USDC.forceApprove(address(pool_), type(uint256).max);
    }

    /// @notice Escrows `amountIn` of `tokenIn` and opens an order that sells it on the pool once the
    ///         watched price meets `condition` against `triggerPrice`. Send exactly ORDER_FEE with the call.
    /// @param tokenIn The pool's WETH (stop-loss, take-profit) or USDC (limit buy).
    /// @param triggerPrice USDC base units per one whole WETH.
    /// @param minAmountOut Minimum output of the swap, at least 1; a callback below it leaves the order open.
    /// @param expiry Last second at which the order may fill, at most MAX_ORDER_LIFETIME from now.
    function placeOrder(
        address tokenIn,
        uint256 amountIn,
        Condition condition,
        uint256 triggerPrice,
        uint256 minAmountOut,
        uint64 expiry
    ) external payable returns (uint256 orderId) {
        if (msg.value != ORDER_FEE) revert WrongOrderFee(msg.value, ORDER_FEE);
        if (tokenIn != address(WETH) && tokenIn != address(USDC)) {
            revert UnsupportedToken(tokenIn);
        }
        if (amountIn == 0) revert ZeroAmount();
        uint256 minimum = tokenIn == address(WETH) ? MIN_WETH_IN : MIN_USDC_IN;
        if (amountIn < minimum) revert OrderTooSmall(amountIn, minimum);
        if (triggerPrice == 0) revert ZeroTriggerPrice();
        if (minAmountOut == 0) revert ZeroMinAmountOut();
        // forge-lint: disable-next-line(block-timestamp) -- order lifetimes are minutes to days; drift is irrelevant
        if (expiry <= block.timestamp) revert ExpiryNotInFuture(expiry);
        uint256 latestExpiry = block.timestamp + MAX_ORDER_LIFETIME;
        if (expiry > latestExpiry) revert ExpiryTooFar(expiry, latestExpiry);

        orderId = nextOrderId++;
        _orders[orderId] = Order({
            owner: msg.sender,
            expiry: expiry,
            condition: condition,
            status: Status.Open,
            tokenIn: tokenIn,
            amountIn: amountIn,
            triggerPrice: triggerPrice,
            minAmountOut: minAmountOut
        });
        emit OrderPlaced(orderId, msg.sender, tokenIn, amountIn, condition, triggerPrice, minAmountOut, expiry);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
    }

    /// @notice Closes an open order and refunds its escrow. Owner only; also reclaims an expired order
    ///         that was never triggered.
    function cancelOrder(uint256 orderId) external {
        Order storage order = _orders[orderId];
        if (order.status != Status.Open) revert OrderNotOpen(orderId, order.status);
        if (order.owner != msg.sender) revert NotOrderOwner(orderId, msg.sender);

        order.status = Status.Cancelled;
        emit OrderCancelled(orderId);

        IERC20(order.tokenIn).safeTransfer(order.owner, order.amountIn);
    }

    /// @notice Callback entry point. The callback proxy fills the first argument with the Reactive contract address.
    /// @param observedPrice Price that met the order's condition on Lasna; recorded for the audit trail.
    /// @param sourceTimestamp Price-chain block time of that price; recorded for the audit trail.
    function executeOrder(address reactiveContract_, uint256 orderId, uint256 observedPrice, uint256 sourceTimestamp)
        external
        onlyServiceProvider
        onlyCallbackSender(reactiveContract_)
    {
        (Outcome outcome, uint256 amountOut) = _settle(orderId);
        emit OrderOutcome(orderId, outcome, amountOut, observedPrice, sourceTimestamp, block.timestamp);
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    /// @notice Pays off the debt to the callback proxy from this contract's native balance.
    function coverDebt() external {
        _coverDebt();
    }

    /// @notice Withdraws native callback funding. Escrowed order tokens cannot be withdrawn by the owner.
    function withdrawNative(address payable recipient, uint256 amount) external onlyOwner {
        _pay(recipient, amount);
    }

    /// @dev Status changes before every external call; the slippage path restores Open.
    function _settle(uint256 orderId) private returns (Outcome, uint256 amountOut) {
        Order storage order = _orders[orderId];
        if (order.status != Status.Open) return (Outcome.SkippedNotOpen, 0);

        // forge-lint: disable-next-line(block-timestamp) -- order lifetimes are minutes to days; drift is irrelevant
        if (block.timestamp > order.expiry) {
            order.status = Status.Expired;
            IERC20(order.tokenIn).safeTransfer(order.owner, order.amountIn);
            return (Outcome.SkippedExpired, 0);
        }

        order.status = Status.Filled;
        try POOL.swap(order.tokenIn, order.amountIn, order.minAmountOut, order.owner) returns (uint256 out) {
            return (Outcome.Filled, out);
        } catch {
            order.status = Status.Open;
            return (Outcome.SkippedSlippage, 0);
        }
    }
}
