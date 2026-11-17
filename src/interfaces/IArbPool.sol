// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title Interface of the WETH/USDC pool used by the executor and the Reactive contract.
interface IArbPool {
    /// @notice Emitted every time the reserves change. This is the event Reactive subscribes to.
    /// @param initiator Caller that changed the reserves (msg.sender).
    /// @param sequence Per-pool change counter, starting at 1.
    /// @param timestamp Block time on the source chain, in seconds.
    event ReserveUpdate(
        address indexed initiator, uint256 reserveWeth, uint256 reserveUsdc, uint256 sequence, uint256 timestamp
    );

    function weth() external view returns (address);
    function usdc() external view returns (address);
    function feeBps() external view returns (uint256);
    function getReserves() external view returns (uint256 reserveWeth, uint256 reserveUsdc);

    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut);
}
