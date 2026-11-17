// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { IArbPool } from "./interfaces/IArbPool.sol";
import { ArbMath } from "./libraries/ArbMath.sol";

/// @title Callback receiver and executor for USDC -> WETH -> USDC arbitrage on the destination chain.
/// @notice Every callback ends with exactly one ArbOutcome event. A skip never reverts,
///         because the callback proxy still charges for a failed callback.
contract ArbExecutor is AbstractCallback, Ownable {
    using SafeERC20 for IERC20;

    enum Outcome {
        Executed,
        SkippedAlreadyExecuted,
        SkippedExpired,
        SkippedInvalidRoute,
        SkippedInputOutOfBounds,
        SkippedMarginGone,
        SkippedInsufficientInventory,
        SwapReverted
    }

    uint8 public constant ROUTE_BUY_A_SELL_B = 0;
    uint8 public constant ROUTE_BUY_B_SELL_A = 1;

    IArbPool public immutable POOL_A;
    IArbPool public immutable POOL_B;
    IERC20 public immutable WETH;
    IERC20 public immutable USDC;
    uint256 public immutable MAX_INPUT;

    /// @notice IDs of opportunities that have been executed successfully.
    mapping(bytes32 => bool) public executed;

    /// @param quotedOut USDC recomputed from the actual reserves (0 if not computed).
    /// @param actualOut USDC actually received (0 if no swap was kept).
    event ArbOutcome(
        bytes32 indexed opportunityId,
        Outcome outcome,
        uint8 route,
        uint256 amountIn,
        uint256 minSurplus,
        uint256 quotedOut,
        uint256 actualOut,
        uint256 timestamp
    );

    error OnlySelf();
    error PoolPairMismatch();
    error SurplusBelowMinimum(uint256 usdcOut, uint256 amountIn, uint256 minSurplus);

    constructor(
        IPayable callbackProxy_,
        address reactiveContract_,
        IArbPool poolA_,
        IArbPool poolB_,
        uint256 maxInput_,
        address owner_
    ) payable AbstractCallback(callbackProxy_, reactiveContract_) Ownable(owner_) {
        if (
            poolA_.weth() != poolB_.weth() || poolA_.usdc() != poolB_.usdc() || poolA_.feeBps() != poolB_.feeBps()
                || address(poolA_) == address(poolB_)
        ) {
            revert PoolPairMismatch();
        }
        POOL_A = poolA_;
        POOL_B = poolB_;
        WETH = IERC20(poolA_.weth());
        USDC = IERC20(poolA_.usdc());
        MAX_INPUT = maxInput_;

        USDC.forceApprove(address(poolA_), type(uint256).max);
        USDC.forceApprove(address(poolB_), type(uint256).max);
        WETH.forceApprove(address(poolA_), type(uint256).max);
        WETH.forceApprove(address(poolB_), type(uint256).max);
    }

    /// @notice Callback entry point. The callback proxy fills the first argument with the Reactive contract address.
    function executeArb(
        address reactiveContract_,
        bytes32 opportunityId,
        uint8 route,
        uint256 amountIn,
        uint256 minSurplus,
        uint256 deadline
    ) external onlyServiceProvider onlyCallbackSender(reactiveContract_) {
        (Outcome outcome, uint256 quotedOut, uint256 actualOut) =
            _decideAndExecute(opportunityId, route, amountIn, minSurplus, deadline);
        emit ArbOutcome(opportunityId, outcome, route, amountIn, minSurplus, quotedOut, actualOut, block.timestamp);
    }

    /// @notice Two atomic swaps. Only this contract can call it, so a failed surplus check
    ///         reverts both swaps without reverting the callback.
    function performArb(IArbPool buyPool, IArbPool sellPool, uint256 amountIn, uint256 minSurplus)
        external
        returns (uint256 usdcOut)
    {
        if (msg.sender != address(this)) revert OnlySelf();
        uint256 usdcBefore = USDC.balanceOf(address(this));
        uint256 wethOut = buyPool.swap(address(USDC), amountIn, 0, address(this));
        sellPool.swap(address(WETH), wethOut, 0, address(this));
        uint256 usdcAfter = USDC.balanceOf(address(this));

        usdcOut = usdcAfter + amountIn - usdcBefore;
        if (!_meetsSurplus(usdcOut, amountIn, minSurplus)) revert SurplusBelowMinimum(usdcOut, amountIn, minSurplus);
    }

    /// @notice Quotes the round trip from the actual reserves of both pools.
    function quoteRoundTrip(uint8 route, uint256 amountIn) public view returns (uint256) {
        (IArbPool buyPool, IArbPool sellPool) = _pools(route);
        (uint256 buyWeth, uint256 buyUsdc) = buyPool.getReserves();
        (uint256 sellWeth, uint256 sellUsdc) = sellPool.getReserves();
        uint256 wethOut = ArbMath.getAmountOut(amountIn, buyUsdc, buyWeth, buyPool.feeBps());
        return ArbMath.getAmountOut(wethOut, sellWeth, sellUsdc, sellPool.feeBps());
    }

    /// @notice Pays off the debt to the callback proxy from this contract's native balance.
    function coverDebt() external {
        _coverDebt();
    }

    function withdrawToken(IERC20 token, address recipient, uint256 amount) external onlyOwner {
        token.safeTransfer(recipient, amount);
    }

    function withdrawNative(address payable recipient, uint256 amount) external onlyOwner {
        _pay(recipient, amount);
    }

    function _decideAndExecute(
        bytes32 opportunityId,
        uint8 route,
        uint256 amountIn,
        uint256 minSurplus,
        uint256 deadline
    ) private returns (Outcome, uint256 quotedOut, uint256 actualOut) {
        if (executed[opportunityId]) return (Outcome.SkippedAlreadyExecuted, 0, 0);
        // forge-lint: disable-next-line(block-timestamp) -- a deadline in seconds; validator drift is irrelevant at 60 s
        if (block.timestamp > deadline) return (Outcome.SkippedExpired, 0, 0);
        if (route > ROUTE_BUY_B_SELL_A) return (Outcome.SkippedInvalidRoute, 0, 0);
        if (amountIn == 0 || amountIn > MAX_INPUT) return (Outcome.SkippedInputOutOfBounds, 0, 0);

        quotedOut = quoteRoundTrip(route, amountIn);
        if (!_meetsSurplus(quotedOut, amountIn, minSurplus)) return (Outcome.SkippedMarginGone, quotedOut, 0);
        if (USDC.balanceOf(address(this)) < amountIn) return (Outcome.SkippedInsufficientInventory, quotedOut, 0);

        (IArbPool buyPool, IArbPool sellPool) = _pools(route);
        try this.performArb(buyPool, sellPool, amountIn, minSurplus) returns (uint256 usdcOut) {
            executed[opportunityId] = true;
            return (Outcome.Executed, quotedOut, usdcOut);
        } catch {
            return (Outcome.SwapReverted, quotedOut, 0);
        }
    }

    function _pools(uint8 route) private view returns (IArbPool buyPool, IArbPool sellPool) {
        return route == ROUTE_BUY_A_SELL_B ? (POOL_A, POOL_B) : (POOL_B, POOL_A);
    }

    function _meetsSurplus(uint256 usdcOut, uint256 amountIn, uint256 minSurplus) private pure returns (bool) {
        return usdcOut >= amountIn && usdcOut - amountIn >= minSurplus;
    }
}
