// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { ArbMath } from "../src/libraries/ArbMath.sol";

contract ArbMathTest is Test {
    uint256 private constant WETH_100 = 100e18;
    uint256 private constant INPUT = 1_000e6;
    uint256 private constant FEE_BPS = 30;

    function test_GetAmountOut_ReturnsZeroForEmptyInputOrReserves() public pure {
        assertEq(ArbMath.getAmountOut(0, 1e18, 1e18, FEE_BPS), 0);
        assertEq(ArbMath.getAmountOut(1e18, 0, 1e18, FEE_BPS), 0);
        assertEq(ArbMath.getAmountOut(1e18, 1e18, 0, FEE_BPS), 0);
    }

    function test_GetAmountOut_MatchesBriefFirstLeg() public pure {
        // 1,000 USDC into Pool A (100 WETH / 300,000 USDC) yields about 0.331233 WETH.
        uint256 wethOut = ArbMath.getAmountOut(INPUT, 300_000e6, WETH_100, FEE_BPS);
        assertApproxEqAbs(wethOut, 0.331233e18, 0.000001e18);
    }

    function test_RoundTrip_PriceB3060_MatchesBriefEstimate() public pure {
        uint256 usdcOut = ArbMath.roundTrip(INPUT, WETH_100, 300_000e6, WETH_100, 306_000e6, FEE_BPS);
        assertApproxEqAbs(usdcOut, 1_007.2e6, 0.02e6);
    }

    function test_RoundTrip_PriceB3030_MatchesBriefEstimate() public pure {
        uint256 usdcOut = ArbMath.roundTrip(INPUT, WETH_100, 300_000e6, WETH_100, 303_000e6, FEE_BPS);
        assertApproxEqAbs(usdcOut, 997.33e6, 0.02e6);
    }

    function testFuzz_GetAmountOut_NeverDrainsReserveAndKeepsInvariant(
        uint96 amountIn,
        uint96 reserveIn,
        uint96 reserveOut
    ) public pure {
        vm.assume(amountIn > 0 && reserveIn > 0 && reserveOut > 0);
        uint256 amountOut = ArbMath.getAmountOut(amountIn, reserveIn, reserveOut, FEE_BPS);
        assertLt(amountOut, reserveOut);
        assertGe((uint256(reserveIn) + amountIn) * (reserveOut - amountOut), uint256(reserveIn) * reserveOut);
    }
}
