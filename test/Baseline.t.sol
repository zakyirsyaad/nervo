// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { DeployBaseline } from "../script/DeployBaseline.s.sol";
import { TestToken } from "../src/fixtures/TestToken.sol";
import { ConstantProductPool } from "../src/fixtures/ConstantProductPool.sol";
import { ArbExecutor } from "../src/ArbExecutor.sol";
import { ArbReactive } from "../src/ArbReactive.sol";
import { MockCallbackProxy } from "./mocks/MockCallbackProxy.sol";
import { LoopFixture } from "./utils/LoopFixture.sol";

/// @dev Baseline mode through the full local loop: a callback is requested even when the margin is below the threshold.
contract BaselineLoopTest is LoopFixture {
    function setUp() public {
        _deployCore(true, 0);
        vm.recordLogs();
    }

    function test_Baseline_MarginBelowThreshold_RequestsCallbackThatExecutorSkips() public {
        _addLiquidity(poolA, POOL_WETH, POOL_A_USDC);
        _addLiquidity(poolB, POOL_WETH, POOL_B_USDC_3030);

        assertEq(_relayLogsToReactive(), 2);
        assertEq(_count(ArbReactive.Decision.MarginBelowThreshold), 0, "baseline does not filter");
        assertEq(_count(ArbReactive.Decision.CallbackRequested), 1);
        assertEq(_deliverPendingCallbacks(), 1);

        (ArbExecutor.Outcome outcome,,) = _lastOutcome();
        assertEq(uint256(outcome), uint256(ArbExecutor.Outcome.SkippedMarginGone));
        assertEq(usdc.balanceOf(address(executor)), INVENTORY, "trading balance unchanged");
        assertEq(poolA.sequence(), 1, "no executor swap");
    }
}

/// @dev Baseline stack deploy script: new pools and executor on top of existing tokens.
contract DeployBaselineTest is Test {
    uint256 private constant LASNA_NONCE = 7;
    uint256 private constant INVENTORY = 10_000e6;

    TestToken private weth;
    TestToken private usdc;
    MockCallbackProxy private proxy;

    function setUp() public {
        weth = new TestToken("Test Wrapped Ether", "tWETH", 18, DEFAULT_SENDER);
        usdc = new TestToken("Test USD Coin", "tUSDC", 6, DEFAULT_SENDER);
        proxy = new MockCallbackProxy();
    }

    function test_Run_DeploysNewPoolsAndExecutorOnExistingTokens() public {
        DeployBaseline.Deployment memory d = _deployAs(address(weth));

        assertEq(d.poolA.weth(), address(weth));
        assertEq(d.poolA.usdc(), address(usdc));
        assertEq(d.poolB.weth(), address(weth));
        assertTrue(address(d.poolA) != address(d.poolB));
        assertEq(d.poolA.owner(), DEFAULT_SENDER);
        assertEq(d.poolB.owner(), DEFAULT_SENDER);
        assertEq(d.executor.owner(), DEFAULT_SENDER);
        assertEq(d.expectedReactive, vm.computeCreateAddress(DEFAULT_SENDER, LASNA_NONCE));
        assertEq(usdc.balanceOf(address(d.executor)), INVENTORY, "executor inventory");
    }

    function test_Run_RevertsWhenTokenHasNoCode() public {
        address notAToken = makeAddr("not-a-token");
        DeployBaseline script = new DeployBaseline();

        vm.expectRevert(bytes("WETH has no code on this chain"));
        script.deploy(DEFAULT_SENDER, notAToken, usdc, address(proxy), LASNA_NONCE, 0);
    }

    function _deployAs(address weth_) private returns (DeployBaseline.Deployment memory) {
        DeployBaseline script = new DeployBaseline();
        return script.deploy(DEFAULT_SENDER, weth_, usdc, address(proxy), LASNA_NONCE, 0);
    }
}
