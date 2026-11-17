// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { ArbExecutor } from "../src/ArbExecutor.sol";
import { IArbPool } from "../src/interfaces/IArbPool.sol";
import { ConstantProductPool } from "../src/fixtures/ConstantProductPool.sol";
import { ShortchangingPool } from "./mocks/ShortchangingPool.sol";
import { BaseFixture } from "./utils/BaseFixture.sol";

contract ArbExecutorTest is BaseFixture {
    bytes32 private constant ID = keccak256("opportunity-1");
    uint8 private constant BUY_A_SELL_B = 0;
    uint8 private constant BUY_B_SELL_A = 1;

    function setUp() public {
        _deployCore(false, 0);
        _addLiquidity(poolA, POOL_WETH, POOL_A_USDC);
        _addLiquidity(poolB, POOL_WETH, POOL_B_USDC_3060);
    }

    function _deliver(bytes32 id, uint8 route, uint256 amountIn, uint256 minSurplus, uint256 deadline) private {
        proxy.deliver(address(executor), address(reactive), _callbackPayload(id, route, amountIn, minSurplus, deadline));
    }

    function _deliverDefault() private {
        _deliver(ID, BUY_A_SELL_B, INPUT, MIN_SURPLUS, block.timestamp + CALLBACK_TTL);
    }

    function _expectOutcome(
        ArbExecutor.Outcome outcome,
        uint8 route,
        uint256 amountIn,
        uint256 quotedOut,
        uint256 actualOut
    ) private {
        vm.expectEmit(address(executor));
        emit ArbExecutor.ArbOutcome(ID, outcome, route, amountIn, MIN_SURPLUS, quotedOut, actualOut, block.timestamp);
    }

    // --- authentication ---

    function test_ExecuteArb_RevertsWhenCallerIsNotCallbackProxy() public {
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, trader, address(proxy)));
        executor.executeArb(address(reactive), ID, BUY_A_SELL_B, INPUT, MIN_SURPLUS, block.timestamp + 1);
    }

    function test_ExecuteArb_RevertsWhenReactiveSenderIsNotAuthorized() public {
        bytes memory payload = _callbackPayload(ID, BUY_A_SELL_B, INPUT, MIN_SURPLUS, block.timestamp + 1);
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, trader, address(reactive))
        );
        proxy.deliver(address(executor), trader, payload);
    }

    function test_PerformArb_RevertsWhenCalledFromOutside() public {
        vm.expectRevert(ArbExecutor.OnlySelf.selector);
        executor.performArb(IArbPool(address(poolA)), IArbPool(address(poolB)), INPUT, 0);
    }

    function test_Constructor_RevertsWhenPoolsDoNotShareThePair() public {
        ConstantProductPool other = new ConstantProductPool(address(weth), address(weth), FEE_BPS, address(this));
        vm.expectRevert(ArbExecutor.PoolPairMismatch.selector);
        new ArbExecutor(proxy, address(reactive), poolA, other, MAX_INPUT, address(this));
        vm.expectRevert(ArbExecutor.PoolPairMismatch.selector);
        new ArbExecutor(proxy, address(reactive), poolA, poolA, MAX_INPUT, address(this));

        ConstantProductPool otherFee = new ConstantProductPool(address(weth), address(usdc), 5, address(this));
        vm.expectRevert(ArbExecutor.PoolPairMismatch.selector);
        new ArbExecutor(proxy, address(reactive), poolA, otherFee, MAX_INPUT, address(this));
    }

    // --- execution ---

    function test_ExecuteArb_SwapsOnBothPoolsAndKeepsSurplus() public {
        uint256 quoted = executor.quoteRoundTrip(BUY_A_SELL_B, INPUT);
        assertApproxEqAbs(quoted, 1_007.2e6, 0.02e6);

        _expectOutcome(ArbExecutor.Outcome.Executed, BUY_A_SELL_B, INPUT, quoted, quoted);
        _deliverDefault();

        assertEq(usdc.balanceOf(address(executor)), INVENTORY + quoted - INPUT);
        assertEq(weth.balanceOf(address(executor)), 0);
        assertTrue(executed(ID));
        assertEq(poolA.sequence(), 2);
        assertEq(poolB.sequence(), 2);
    }

    function test_ExecuteArb_UsesReverseRouteWhenPoolAIsRicher() public {
        _addLiquidity(poolA, 0, 12_000 * ONE_USDC); // Pool A becomes 3,120 USDC/WETH
        uint256 quoted = executor.quoteRoundTrip(BUY_B_SELL_A, INPUT);
        assertGt(quoted, INPUT + MIN_SURPLUS);

        _expectOutcome(ArbExecutor.Outcome.Executed, BUY_B_SELL_A, INPUT, quoted, quoted);
        _deliver(ID, BUY_B_SELL_A, INPUT, MIN_SURPLUS, block.timestamp + CALLBACK_TTL);
        assertEq(usdc.balanceOf(address(executor)), INVENTORY + quoted - INPUT);
    }

    // --- skips without revert ---

    function test_ExecuteArb_SkipsReplayAfterSuccessfulExecution() public {
        _deliverDefault();
        uint256 balanceAfterFirst = usdc.balanceOf(address(executor));

        _expectOutcome(ArbExecutor.Outcome.SkippedAlreadyExecuted, BUY_A_SELL_B, INPUT, 0, 0);
        _deliverDefault();
        assertEq(usdc.balanceOf(address(executor)), balanceAfterFirst);
    }

    function test_ExecuteArb_SkipsWhenExpired() public {
        uint256 deadline = block.timestamp + CALLBACK_TTL;
        vm.warp(deadline + 1);
        _expectOutcome(ArbExecutor.Outcome.SkippedExpired, BUY_A_SELL_B, INPUT, 0, 0);
        _deliver(ID, BUY_A_SELL_B, INPUT, MIN_SURPLUS, deadline);
        assertEq(usdc.balanceOf(address(executor)), INVENTORY);
        assertFalse(executed(ID));
    }

    function test_ExecuteArb_ExecutesExactlyAtDeadline() public {
        uint256 deadline = block.timestamp + CALLBACK_TTL;
        vm.warp(deadline);
        _deliver(ID, BUY_A_SELL_B, INPUT, MIN_SURPLUS, deadline);
        assertTrue(executed(ID));
    }

    function test_ExecuteArb_SkipsInvalidRoute() public {
        _expectOutcome(ArbExecutor.Outcome.SkippedInvalidRoute, 2, INPUT, 0, 0);
        _deliver(ID, 2, INPUT, MIN_SURPLUS, block.timestamp + CALLBACK_TTL);
    }

    function test_ExecuteArb_SkipsInputOutOfBounds() public {
        _expectOutcome(ArbExecutor.Outcome.SkippedInputOutOfBounds, BUY_A_SELL_B, MAX_INPUT + 1, 0, 0);
        _deliver(ID, BUY_A_SELL_B, MAX_INPUT + 1, MIN_SURPLUS, block.timestamp + CALLBACK_TTL);
        _expectOutcome(ArbExecutor.Outcome.SkippedInputOutOfBounds, BUY_A_SELL_B, 0, 0, 0);
        _deliver(ID, BUY_A_SELL_B, 0, MIN_SURPLUS, block.timestamp + CALLBACK_TTL);
    }

    function test_ExecuteArb_SkipsWhenMarginIsGoneAndLeavesBalancesUntouched() public {
        poolB.removeLiquidity(0, 3_000 * ONE_USDC, address(this)); // Pool B goes back to 3,030 USDC/WETH
        uint256 quoted = executor.quoteRoundTrip(BUY_A_SELL_B, INPUT);
        assertApproxEqAbs(quoted, 997.33e6, 0.02e6);

        _expectOutcome(ArbExecutor.Outcome.SkippedMarginGone, BUY_A_SELL_B, INPUT, quoted, 0);
        _deliverDefault();

        assertEq(usdc.balanceOf(address(executor)), INVENTORY);
        assertEq(poolA.sequence(), 1);
        assertFalse(executed(ID));
    }

    function test_ExecuteArb_SkipsWhenSurplusIsPositiveButBelowMinimum() public {
        uint256 quoted = executor.quoteRoundTrip(BUY_A_SELL_B, INPUT);
        uint256 tooHigh = quoted - INPUT + 1;
        vm.expectEmit(address(executor));
        emit ArbExecutor.ArbOutcome(
            ID, ArbExecutor.Outcome.SkippedMarginGone, BUY_A_SELL_B, INPUT, tooHigh, quoted, 0, block.timestamp
        );
        _deliver(ID, BUY_A_SELL_B, INPUT, tooHigh, block.timestamp + CALLBACK_TTL);
    }

    function test_ExecuteArb_DoesNotRevertOnHugeMinSurplus() public {
        _deliver(ID, BUY_A_SELL_B, INPUT, type(uint256).max, block.timestamp + CALLBACK_TTL);
        assertFalse(executed(ID));
    }

    function test_ExecuteArb_SkipsWhenInventoryIsInsufficient() public {
        executor.withdrawToken(IERC20(address(usdc)), address(this), INVENTORY);
        uint256 quoted = executor.quoteRoundTrip(BUY_A_SELL_B, INPUT);
        _expectOutcome(ArbExecutor.Outcome.SkippedInsufficientInventory, BUY_A_SELL_B, INPUT, quoted, 0);
        _deliverDefault();
    }

    function test_ExecuteArb_RevertsSwapsButCompletesCallbackWhenActualSurplusFails() public {
        // The sell pool reports reserves at 3,060 but pays only 99% of the quote.
        ShortchangingPool badPool =
            new ShortchangingPool(address(weth), address(usdc), POOL_WETH, POOL_B_USDC_3060, 9_900);
        usdc.mint(address(badPool), POOL_B_USDC_3060);
        ArbExecutor badExecutor =
            new ArbExecutor(proxy, address(reactive), poolA, IArbPool(address(badPool)), MAX_INPUT, address(this));
        usdc.mint(address(badExecutor), INVENTORY);
        uint256 quoted = badExecutor.quoteRoundTrip(BUY_A_SELL_B, INPUT);

        vm.expectEmit(address(badExecutor));
        emit ArbExecutor.ArbOutcome(
            ID, ArbExecutor.Outcome.SwapReverted, BUY_A_SELL_B, INPUT, MIN_SURPLUS, quoted, 0, block.timestamp
        );
        proxy.deliver(
            address(badExecutor),
            address(reactive),
            _callbackPayload(ID, BUY_A_SELL_B, INPUT, MIN_SURPLUS, block.timestamp + CALLBACK_TTL)
        );

        assertEq(usdc.balanceOf(address(badExecutor)), INVENTORY, "inventory intact");
        assertEq(weth.balanceOf(address(badExecutor)), 0);
        assertEq(poolA.sequence(), 1, "first swap is reverted too");
        assertFalse(badExecutor.executed(ID));
    }

    // --- funds and owner ---

    function test_CoverDebt_PaysProxyFromNativeBalance() public {
        vm.deal(address(executor), 1 ether);
        proxy.setDebt(address(executor), 0.2 ether);
        executor.coverDebt();
        assertEq(address(proxy).balance, 0.2 ether);
        assertEq(address(executor).balance, 0.8 ether);
    }

    function test_Pay_OnlyCallbackProxyCanCollect() public {
        vm.deal(address(executor), 1 ether);
        vm.prank(address(proxy));
        executor.pay(0.1 ether);
        assertEq(address(proxy).balance, 0.1 ether);

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, trader, address(proxy)));
        executor.pay(0.1 ether);
    }

    function test_Withdraw_OnlyOwner() public {
        vm.deal(address(executor), 1 ether);
        executor.withdrawNative(payable(trader), 0.4 ether);
        assertEq(trader.balance, 0.4 ether);
        executor.withdrawToken(IERC20(address(usdc)), trader, ONE_USDC);

        vm.startPrank(trader);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, trader));
        executor.withdrawNative(payable(trader), 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, trader));
        executor.withdrawToken(IERC20(address(usdc)), trader, 1);
        vm.stopPrank();
    }

    function executed(bytes32 id) private view returns (bool) {
        return executor.executed(id);
    }
}
