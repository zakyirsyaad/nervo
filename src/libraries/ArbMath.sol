// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title Constant-product quote math for the USDC -> WETH -> USDC round trip.
library ArbMath {
    uint256 internal constant BPS = 10_000;

    /// @notice Output of an x*y=k swap after the fee.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        internal
        pure
        returns (uint256)
    {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) return 0;
        uint256 amountInAfterFee = amountIn * (BPS - feeBps);
        return (amountInAfterFee * reserveOut) / (reserveIn * BPS + amountInAfterFee);
    }

    /// @notice Final USDC from buying WETH in the buy pool and then selling it in the sell pool.
    function roundTrip(
        uint256 usdcIn,
        uint256 buyReserveWeth,
        uint256 buyReserveUsdc,
        uint256 sellReserveWeth,
        uint256 sellReserveUsdc,
        uint256 feeBps
    ) internal pure returns (uint256 usdcOut) {
        uint256 wethOut = getAmountOut(usdcIn, buyReserveUsdc, buyReserveWeth, feeBps);
        return getAmountOut(wethOut, sellReserveWeth, sellReserveUsdc, feeBps);
    }
}
