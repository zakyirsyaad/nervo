// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ConstantProductPool } from "../src/fixtures/ConstantProductPool.sol";
import { ArbExecutor } from "../src/ArbExecutor.sol";

/// @notice Demo scenarios on the origin chain. The caller must own both pools and hold the test tokens.
/// @dev Required env: POOL_A, POOL_B, EXECUTOR. Run with --sig, for example --sig "persist()".
///      The scenarios never touch Pool A; only the Pool B price is moved, with real swaps.
contract Scenario is Script {
    struct Context {
        ConstantProductPool poolA;
        ConstantProductPool poolB;
        ArbExecutor executor;
        IERC20 weth;
        IERC20 usdc;
    }

    uint256 internal constant SEED_WETH = 100e18;
    uint256 internal constant SEED_USDC = 300_000e6;
    uint256 internal constant INPUT = 1_000e6;
    uint256 internal constant MIN_SURPLUS = 2e6;
    uint256 internal constant PERSIST_GAP_BPS = 200; // Pool B 2% above Pool A: surplus of about 7 USDC
    uint256 internal constant REJECT_GAP_BPS = 100; // Pool B 1% above Pool A: the round trip loses money
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint8 internal constant ROUTE_BUY_A_SELL_B = 0;

    error ExpectedProfitable(uint256 quotedOut);
    error ExpectedUnprofitable(uint256 quotedOut);

    // --- entry points ---

    /// @notice Fills both pools with 100 WETH / 300,000 USDC and sets the token approvals.
    function seed() external {
        Context memory c = _context();
        vm.startBroadcast();
        _seed(c);
        vm.stopBroadcast();
        _report(c, "seed");
    }

    /// @notice Sets Pool B to the current Pool A reserves, so there is no price gap.
    function neutralize() external {
        Context memory c = _context();
        vm.startBroadcast();
        _neutralize(c);
        vm.stopBroadcast();
        _report(c, "neutralize");
    }

    /// @notice Opportunity persists: one swap opens a 2% gap, which is left open until the callback arrives.
    function persist() external {
        Context memory c = _context();
        vm.startBroadcast();
        _persist(c);
        vm.stopBroadcast();
        _report(c, "persist");
    }

    /// @notice Opportunity vanishes: a swap opens a 2% gap, then a reverse swap closes it before the callback arrives.
    function vanish() external {
        Context memory c = _context();
        vm.startBroadcast();
        _vanish(c);
        vm.stopBroadcast();
        _report(c, "vanish");
    }

    /// @notice Rejected on Lasna: the swap opens only a 1% gap, below the threshold.
    function reject() external {
        Context memory c = _context();
        vm.startBroadcast();
        _reject(c);
        vm.stopBroadcast();
        _report(c, "reject");
    }

    /// @notice Prints reserves, prices and quotes without sending a transaction.
    function status() external view {
        _report(_context(), "status");
    }

    // --- actions ---

    function _seed(Context memory c) internal {
        c.weth.approve(address(c.poolA), type(uint256).max);
        c.weth.approve(address(c.poolB), type(uint256).max);
        c.usdc.approve(address(c.poolA), type(uint256).max);
        c.usdc.approve(address(c.poolB), type(uint256).max);
        c.poolA.rebalanceTo(SEED_WETH, SEED_USDC);
        c.poolB.rebalanceTo(SEED_WETH, SEED_USDC);
    }

    function _neutralize(Context memory c) internal {
        (uint256 reserveWeth, uint256 reserveUsdc) = c.poolA.getReserves();
        c.poolB.rebalanceTo(reserveWeth, reserveUsdc);
    }

    function _persist(Context memory c) internal {
        _movePoolBToGap(c, PERSIST_GAP_BPS);
        _requireProfitable(c);
    }

    function _vanish(Context memory c) internal {
        _movePoolBToGap(c, PERSIST_GAP_BPS);
        _requireProfitable(c);
        _movePoolBToGap(c, REJECT_GAP_BPS);
        _requireUnprofitable(c);
    }

    function _reject(Context memory c) internal {
        _movePoolBToGap(c, REJECT_GAP_BPS);
        _requireUnprofitable(c);
    }

    /// @dev Swaps on Pool B until its price is roughly `gapBps` above the Pool A price.
    function _movePoolBToGap(Context memory c, uint256 gapBps) internal {
        (uint256 aWeth, uint256 aUsdc) = c.poolA.getReserves();
        (uint256 bWeth, uint256 bUsdc) = c.poolB.getReserves();
        uint256 priceRatioWad = (aUsdc * bWeth * (BPS + gapBps) * WAD) / (aWeth * bUsdc * BPS);
        uint256 sqrtRatioWad = Math.sqrt(priceRatioWad * WAD);

        if (sqrtRatioWad > WAD) {
            uint256 usdcIn = (bUsdc * (sqrtRatioWad - WAD)) / WAD;
            if (usdcIn > 0) c.poolB.swap(address(c.usdc), usdcIn, 0, msg.sender);
        } else if (sqrtRatioWad < WAD) {
            uint256 wethIn = (bWeth * (WAD - sqrtRatioWad)) / sqrtRatioWad;
            if (wethIn > 0) c.poolB.swap(address(c.weth), wethIn, 0, msg.sender);
        }
    }

    function _requireProfitable(Context memory c) internal view {
        uint256 quotedOut = c.executor.quoteRoundTrip(ROUTE_BUY_A_SELL_B, INPUT);
        if (quotedOut < INPUT + MIN_SURPLUS) revert ExpectedProfitable(quotedOut);
    }

    function _requireUnprofitable(Context memory c) internal view {
        uint256 quotedOut = c.executor.quoteRoundTrip(ROUTE_BUY_A_SELL_B, INPUT);
        if (quotedOut >= INPUT + MIN_SURPLUS) revert ExpectedUnprofitable(quotedOut);
    }

    // --- context and report ---

    function _context() internal view returns (Context memory c) {
        c.poolA = ConstantProductPool(vm.envAddress("POOL_A"));
        c.poolB = ConstantProductPool(vm.envAddress("POOL_B"));
        c.executor = ArbExecutor(payable(vm.envAddress("EXECUTOR")));
        c.weth = IERC20(c.poolA.weth());
        c.usdc = IERC20(c.poolA.usdc());
    }

    function _report(Context memory c, string memory label) internal view {
        (uint256 aWeth, uint256 aUsdc) = c.poolA.getReserves();
        (uint256 bWeth, uint256 bUsdc) = c.poolB.getReserves();
        console.log("== %s (chain %s)", label, block.chainid);
        console.log("Pool A  WETH %s  USDC %s", aWeth, aUsdc);
        console.log("Pool B  WETH %s  USDC %s", bWeth, bUsdc);
        if (aWeth == 0 || bWeth == 0) return;
        console.log("price A (USDC/WETH x100) %s", (aUsdc * 1e14) / aWeth);
        console.log("price B (USDC/WETH x100) %s", (bUsdc * 1e14) / bWeth);
        console.log("quote buy A sell B for 1,000 USDC: %s", c.executor.quoteRoundTrip(ROUTE_BUY_A_SELL_B, INPUT));
        console.log("quote buy B sell A for 1,000 USDC: %s", c.executor.quoteRoundTrip(1, INPUT));
        console.log("executor USDC inventory: %s", c.usdc.balanceOf(address(c.executor)));
    }
}
