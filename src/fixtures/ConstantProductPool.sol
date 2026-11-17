// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IArbPool } from "../interfaces/IArbPool.sol";
import { ArbMath } from "../libraries/ArbMath.sol";

/// @title Constant-product WETH/USDC AMM for the demo fixture.
/// @notice Swaps move real tokens. Only the owner manages liquidity.
contract ConstantProductPool is IArbPool, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant MAX_FEE_BPS = 1_000;

    address public immutable override weth;
    address public immutable override usdc;
    uint256 public immutable override feeBps;

    uint256 public reserveWeth;
    uint256 public reserveUsdc;
    uint256 public sequence;

    event Swap(
        address indexed sender, address indexed tokenIn, address indexed recipient, uint256 amountIn, uint256 amountOut
    );

    error UnsupportedToken(address token);
    error ZeroAmount();
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);
    error InsufficientReserves();
    error FeeTooHigh(uint256 feeBps);

    constructor(address weth_, address usdc_, uint256 feeBps_, address owner_) Ownable(owner_) {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_);
        weth = weth_;
        usdc = usdc_;
        feeBps = feeBps_;
    }

    function getReserves() external view override returns (uint256, uint256) {
        return (reserveWeth, reserveUsdc);
    }

    function addLiquidity(uint256 wethAmount, uint256 usdcAmount) external onlyOwner nonReentrant {
        if (wethAmount == 0 && usdcAmount == 0) revert ZeroAmount();
        _setReserves(reserveWeth + wethAmount, reserveUsdc + usdcAmount);
        if (wethAmount > 0) IERC20(weth).safeTransferFrom(msg.sender, address(this), wethAmount);
        if (usdcAmount > 0) IERC20(usdc).safeTransferFrom(msg.sender, address(this), usdcAmount);
    }

    function removeLiquidity(uint256 wethAmount, uint256 usdcAmount, address recipient)
        external
        onlyOwner
        nonReentrant
    {
        if (wethAmount == 0 && usdcAmount == 0) revert ZeroAmount();
        if (wethAmount > reserveWeth || usdcAmount > reserveUsdc) revert InsufficientReserves();
        _setReserves(reserveWeth - wethAmount, reserveUsdc - usdcAmount);
        if (wethAmount > 0) IERC20(weth).safeTransfer(recipient, wethAmount);
        if (usdcAmount > 0) IERC20(usdc).safeTransfer(recipient, usdcAmount);
    }

    /// @notice Sets the reserves to the target in one transaction and one event; the difference is pulled
    ///         from or sent to the owner. The demo scenarios use it to equalize the prices of the two pools.
    function rebalanceTo(uint256 targetWeth, uint256 targetUsdc) external onlyOwner nonReentrant {
        if (targetWeth == 0 || targetUsdc == 0) revert ZeroAmount();
        uint256 currentWeth = reserveWeth;
        uint256 currentUsdc = reserveUsdc;
        _setReserves(targetWeth, targetUsdc);
        _settle(IERC20(weth), currentWeth, targetWeth);
        _settle(IERC20(usdc), currentUsdc, targetUsdc);
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        override
        nonReentrant
        returns (uint256 amountOut)
    {
        bool isWethIn = tokenIn == weth;
        if (!isWethIn && tokenIn != usdc) revert UnsupportedToken(tokenIn);
        if (amountIn == 0) revert ZeroAmount();

        (uint256 reserveIn, uint256 reserveOut) = isWethIn ? (reserveWeth, reserveUsdc) : (reserveUsdc, reserveWeth);
        amountOut = ArbMath.getAmountOut(amountIn, reserveIn, reserveOut, feeBps);
        if (amountOut == 0 || amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);

        emit Swap(msg.sender, tokenIn, recipient, amountIn, amountOut);
        if (isWethIn) {
            _setReserves(reserveIn + amountIn, reserveOut - amountOut);
        } else {
            _setReserves(reserveOut - amountOut, reserveIn + amountIn);
        }

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(isWethIn ? usdc : weth).safeTransfer(recipient, amountOut);
    }

    function _settle(IERC20 token, uint256 current, uint256 target) private {
        if (target > current) token.safeTransferFrom(msg.sender, address(this), target - current);
        if (target < current) token.safeTransfer(msg.sender, current - target);
    }

    function _setReserves(uint256 newReserveWeth, uint256 newReserveUsdc) private {
        reserveWeth = newReserveWeth;
        reserveUsdc = newReserveUsdc;
        sequence += 1;
        emit ReserveUpdate(msg.sender, newReserveWeth, newReserveUsdc, sequence, block.timestamp);
    }
}
