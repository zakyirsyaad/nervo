// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IArbPool } from "../../src/interfaces/IArbPool.sol";
import { ArbMath } from "../../src/libraries/ArbMath.sol";

/// @dev Pool that reports healthy reserves but pays out less than the quote,
///      to test a failed surplus check after the swaps are attempted.
contract ShortchangingPool is IArbPool {
    address public immutable weth;
    address public immutable usdc;
    uint256 public constant feeBps = 30;
    uint256 public reserveWeth;
    uint256 public reserveUsdc;
    uint256 public payoutBps;

    constructor(address weth_, address usdc_, uint256 reserveWeth_, uint256 reserveUsdc_, uint256 payoutBps_) {
        weth = weth_;
        usdc = usdc_;
        reserveWeth = reserveWeth_;
        reserveUsdc = reserveUsdc_;
        payoutBps = payoutBps_;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (reserveWeth, reserveUsdc);
    }

    function swap(address tokenIn, uint256 amountIn, uint256, address recipient) external returns (uint256 amountOut) {
        bool isWethIn = tokenIn == weth;
        (uint256 reserveIn, uint256 reserveOut) = isWethIn ? (reserveWeth, reserveUsdc) : (reserveUsdc, reserveWeth);
        amountOut = ArbMath.getAmountOut(amountIn, reserveIn, reserveOut, feeBps) * payoutBps / 10_000;
        // forge-lint: disable-next-line(erc20-unchecked-transfer) -- test mock with standard test tokens
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        IERC20(isWethIn ? usdc : weth).transfer(recipient, amountOut);
    }
}
