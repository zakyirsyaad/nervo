// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ConstantProductPool } from "../src/fixtures/ConstantProductPool.sol";
import { IArbPool } from "../src/interfaces/IArbPool.sol";
import { ArbMath } from "../src/libraries/ArbMath.sol";
import { BaseFixture } from "./utils/BaseFixture.sol";

contract ConstantProductPoolTest is BaseFixture {
    function setUp() public {
        _deployCore(false, 0);
        _addLiquidity(poolA, POOL_WETH, POOL_A_USDC);
    }

    function test_Token_ReportsConfiguredDecimalsAndRestrictsMint() public {
        assertEq(usdc.decimals(), 6);
        assertEq(weth.decimals(), 18);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, trader));
        usdc.mint(trader, 1);
    }

    function test_Constructor_RevertsWhenFeeTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPool.FeeTooHigh.selector, 1_001));
        new ConstantProductPool(address(weth), address(usdc), 1_001, address(this));
    }

    function test_AddLiquidity_UpdatesReservesAndEmitsSequencedUpdate() public {
        (uint256 reserveWeth, uint256 reserveUsdc) = poolA.getReserves();
        assertEq(reserveWeth, POOL_WETH);
        assertEq(reserveUsdc, POOL_A_USDC);
        assertEq(poolA.sequence(), 1);

        weth.mint(address(this), ONE_WETH);
        weth.approve(address(poolA), ONE_WETH);
        vm.expectEmit(address(poolA));
        emit IArbPool.ReserveUpdate(address(this), POOL_WETH + ONE_WETH, POOL_A_USDC, 2, block.timestamp);
        poolA.addLiquidity(ONE_WETH, 0);
    }

    function test_AddLiquidity_RevertsForNonOwnerAndZeroAmounts() public {
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, trader));
        poolA.addLiquidity(1, 1);
        vm.expectRevert(ConstantProductPool.ZeroAmount.selector);
        poolA.addLiquidity(0, 0);
    }

    function test_RemoveLiquidity_TransfersTokensAndGuardsReserves() public {
        poolA.removeLiquidity(ONE_WETH, 3_000 * ONE_USDC, trader);
        (uint256 reserveWeth, uint256 reserveUsdc) = poolA.getReserves();
        assertEq(reserveWeth, POOL_WETH - ONE_WETH);
        assertEq(reserveUsdc, POOL_A_USDC - 3_000 * ONE_USDC);
        assertEq(weth.balanceOf(address(poolA)), reserveWeth);

        vm.expectRevert(ConstantProductPool.InsufficientReserves.selector);
        poolA.removeLiquidity(POOL_WETH, 0, trader);
        vm.expectRevert(ConstantProductPool.ZeroAmount.selector);
        poolA.removeLiquidity(0, 0, trader);
    }

    function test_RebalanceTo_MovesBothReservesInOneUpdate() public {
        uint256 ownerUsdcBefore = usdc.balanceOf(address(this));
        weth.mint(address(this), ONE_WETH);
        weth.approve(address(poolA), ONE_WETH);

        vm.expectEmit(address(poolA));
        emit IArbPool.ReserveUpdate(
            address(this), POOL_WETH + ONE_WETH, POOL_A_USDC - 5_000 * ONE_USDC, 2, block.timestamp
        );
        poolA.rebalanceTo(POOL_WETH + ONE_WETH, POOL_A_USDC - 5_000 * ONE_USDC);

        assertEq(poolA.sequence(), 2);
        assertEq(weth.balanceOf(address(poolA)), POOL_WETH + ONE_WETH);
        assertEq(usdc.balanceOf(address(poolA)), POOL_A_USDC - 5_000 * ONE_USDC);
        assertEq(usdc.balanceOf(address(this)), ownerUsdcBefore + 5_000 * ONE_USDC);
    }

    function test_RebalanceTo_RevertsForNonOwnerAndZeroTarget() public {
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, trader));
        poolA.rebalanceTo(1, 1);
        vm.expectRevert(ConstantProductPool.ZeroAmount.selector);
        poolA.rebalanceTo(0, 1);
    }

    function test_Swap_UsdcIn_TransfersRealTokensAndUpdatesReserves() public {
        uint256 wethBefore = weth.balanceOf(trader);
        vm.prank(trader);
        uint256 wethOut = poolA.swap(address(usdc), INPUT, 0, trader);

        assertApproxEqAbs(wethOut, 0.331233e18, 0.000001e18);
        assertEq(weth.balanceOf(trader), wethBefore + wethOut);
        (uint256 reserveWeth, uint256 reserveUsdc) = poolA.getReserves();
        assertEq(reserveWeth, POOL_WETH - wethOut);
        assertEq(reserveUsdc, POOL_A_USDC + INPUT);
        assertEq(usdc.balanceOf(address(poolA)), reserveUsdc);
        assertEq(poolA.sequence(), 2);
    }

    function test_Swap_WethIn_EmitsSwapAndReserveUpdateWithInitiator() public {
        uint256 expectedOut = ArbMath.getAmountOut(ONE_WETH, POOL_WETH, POOL_A_USDC, FEE_BPS);
        assertEq(expectedOut, 2_961_474_103); // 1 WETH into 100 WETH / 300,000 USDC with a 0.30% fee
        vm.expectEmit(address(poolA));
        emit ConstantProductPool.Swap(trader, address(weth), trader, ONE_WETH, expectedOut);
        vm.expectEmit(address(poolA));
        emit IArbPool.ReserveUpdate(trader, POOL_WETH + ONE_WETH, POOL_A_USDC - expectedOut, 2, block.timestamp);
        vm.prank(trader);
        poolA.swap(address(weth), ONE_WETH, 0, trader);
    }

    function test_Swap_RevertsOnBadTokenZeroAmountAndSlippage() public {
        vm.startPrank(trader);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPool.UnsupportedToken.selector, address(this)));
        poolA.swap(address(this), 1, 0, trader);
        vm.expectRevert(ConstantProductPool.ZeroAmount.selector);
        poolA.swap(address(usdc), 0, 0, trader);
        vm.expectRevert();
        poolA.swap(address(usdc), INPUT, 1e18, trader);
        vm.stopPrank();
    }
}
