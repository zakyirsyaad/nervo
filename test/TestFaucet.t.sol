// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TestToken } from "../src/fixtures/TestToken.sol";
import { TestFaucet } from "../src/fixtures/TestFaucet.sol";

contract TestFaucetTest is Test {
    uint256 private constant WETH_PER_CLAIM = 5e18;
    uint256 private constant USDC_PER_CLAIM = 10_000e6;
    uint256 private constant COOLDOWN = 1 days;
    uint256 private constant FUNDED_CLAIMS = 3;
    uint256 private constant START_TIME = 1_800_000_000;

    TestToken private weth;
    TestToken private usdc;
    TestFaucet private faucet;
    address private visitor = makeAddr("visitor");
    address private otherVisitor = makeAddr("otherVisitor");

    function setUp() public {
        vm.warp(START_TIME);
        weth = new TestToken("Test Wrapped Ether", "tWETH", 18, address(this));
        usdc = new TestToken("Test USD Coin", "tUSDC", 6, address(this));
        faucet = new TestFaucet(
            IERC20(address(weth)), IERC20(address(usdc)), WETH_PER_CLAIM, USDC_PER_CLAIM, COOLDOWN, address(this)
        );
        weth.mint(address(faucet), FUNDED_CLAIMS * WETH_PER_CLAIM);
        usdc.mint(address(faucet), FUNDED_CLAIMS * USDC_PER_CLAIM);
    }

    function _claimAs(address account) private {
        vm.prank(account);
        faucet.claim();
    }

    // --- construction ---

    function test_Constructor_StoresConfiguration() public view {
        assertEq(address(faucet.WETH()), address(weth));
        assertEq(address(faucet.USDC()), address(usdc));
        assertEq(faucet.WETH_PER_CLAIM(), WETH_PER_CLAIM);
        assertEq(faucet.USDC_PER_CLAIM(), USDC_PER_CLAIM);
        assertEq(faucet.COOLDOWN(), COOLDOWN);
        assertEq(faucet.owner(), address(this));
    }

    // --- claim ---

    function test_Claim_TransfersBothAmountsAndEmitsEvent() public {
        vm.expectEmit(address(faucet));
        emit TestFaucet.Claimed(visitor, WETH_PER_CLAIM, USDC_PER_CLAIM);
        _claimAs(visitor);

        assertEq(weth.balanceOf(visitor), WETH_PER_CLAIM);
        assertEq(usdc.balanceOf(visitor), USDC_PER_CLAIM);
        assertEq(weth.balanceOf(address(faucet)), (FUNDED_CLAIMS - 1) * WETH_PER_CLAIM);
        assertEq(usdc.balanceOf(address(faucet)), (FUNDED_CLAIMS - 1) * USDC_PER_CLAIM);
    }

    function test_Claim_RevertsInsideCooldown() public {
        _claimAs(visitor);
        uint256 availableAt = START_TIME + COOLDOWN;

        vm.expectRevert(abi.encodeWithSelector(TestFaucet.CooldownActive.selector, availableAt));
        _claimAs(visitor);

        vm.warp(availableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(TestFaucet.CooldownActive.selector, availableAt));
        _claimAs(visitor);

        assertEq(weth.balanceOf(visitor), WETH_PER_CLAIM);
        assertEq(usdc.balanceOf(visitor), USDC_PER_CLAIM);
    }

    function test_Claim_SucceedsAgainOnceCooldownHasPassed() public {
        _claimAs(visitor);
        vm.warp(START_TIME + COOLDOWN);
        _claimAs(visitor);

        assertEq(weth.balanceOf(visitor), 2 * WETH_PER_CLAIM);
        assertEq(usdc.balanceOf(visitor), 2 * USDC_PER_CLAIM);
    }

    function test_Claim_CooldownIsTrackedPerAccount() public {
        _claimAs(visitor);
        _claimAs(otherVisitor);

        assertEq(weth.balanceOf(otherVisitor), WETH_PER_CLAIM);
        assertEq(usdc.balanceOf(otherVisitor), USDC_PER_CLAIM);
    }

    function test_Claim_RevertsWhenWethIsInsufficient() public {
        faucet.withdraw(IERC20(address(weth)), address(this), (FUNDED_CLAIMS - 1) * WETH_PER_CLAIM + 1);

        vm.expectRevert(TestFaucet.FaucetEmpty.selector);
        _claimAs(visitor);
        assertEq(faucet.nextClaimAt(visitor), 0);
    }

    function test_Claim_RevertsWhenUsdcIsInsufficient() public {
        faucet.withdraw(IERC20(address(usdc)), address(this), (FUNDED_CLAIMS - 1) * USDC_PER_CLAIM + 1);

        vm.expectRevert(TestFaucet.FaucetEmpty.selector);
        _claimAs(visitor);
        assertEq(usdc.balanceOf(visitor), 0);
        assertEq(weth.balanceOf(visitor), 0);
    }

    function test_Claim_RevertsOnceInventoryIsDrained() public {
        for (uint256 i = 0; i < FUNDED_CLAIMS; i++) {
            _claimAs(makeAddr(string.concat("claimer-", vm.toString(i))));
        }
        assertEq(weth.balanceOf(address(faucet)), 0);
        assertEq(usdc.balanceOf(address(faucet)), 0);

        vm.expectRevert(TestFaucet.FaucetEmpty.selector);
        _claimAs(visitor);
    }

    // --- nextClaimAt ---

    function test_NextClaimAt_IsZeroBeforeFirstClaim() public view {
        assertEq(faucet.nextClaimAt(visitor), 0);
    }

    function test_NextClaimAt_IsClaimTimePlusCooldown() public {
        _claimAs(visitor);
        assertEq(faucet.nextClaimAt(visitor), START_TIME + COOLDOWN);
        assertEq(faucet.nextClaimAt(otherVisitor), 0);

        vm.warp(START_TIME + COOLDOWN + 7);
        _claimAs(visitor);
        assertEq(faucet.nextClaimAt(visitor), START_TIME + 2 * COOLDOWN + 7);
    }

    // --- withdraw ---

    function test_Withdraw_SendsTokensToRecipientWhenCalledByOwner() public {
        faucet.withdraw(IERC20(address(usdc)), otherVisitor, USDC_PER_CLAIM);

        assertEq(usdc.balanceOf(otherVisitor), USDC_PER_CLAIM);
        assertEq(usdc.balanceOf(address(faucet)), (FUNDED_CLAIMS - 1) * USDC_PER_CLAIM);
    }

    function test_Withdraw_RevertsWhenCallerIsNotOwner() public {
        vm.prank(visitor);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, visitor));
        faucet.withdraw(IERC20(address(weth)), visitor, 1);
    }
}
