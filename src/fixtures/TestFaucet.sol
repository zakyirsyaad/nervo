// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Public faucet for the WETH and USDC test tokens.
/// @notice The faucet cannot mint tokens; it hands out a balance that was funded in advance,
///         with a fixed amount per claim and a cooldown per address.
contract TestFaucet is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable WETH;
    IERC20 public immutable USDC;
    uint256 public immutable WETH_PER_CLAIM;
    uint256 public immutable USDC_PER_CLAIM;
    uint256 public immutable COOLDOWN;

    /// @notice Timestamp from which an address may claim again (0 if it has never claimed).
    mapping(address => uint256) public nextClaimAt;

    event Claimed(address indexed account, uint256 wethAmount, uint256 usdcAmount);

    /// @param availableAt Timestamp from which the caller may claim again.
    error CooldownActive(uint256 availableAt);
    error FaucetEmpty();

    constructor(
        IERC20 weth_,
        IERC20 usdc_,
        uint256 wethPerClaim_,
        uint256 usdcPerClaim_,
        uint256 cooldown_,
        address owner_
    ) Ownable(owner_) {
        WETH = weth_;
        USDC = usdc_;
        WETH_PER_CLAIM = wethPerClaim_;
        USDC_PER_CLAIM = usdcPerClaim_;
        COOLDOWN = cooldown_;
    }

    /// @notice Sends the per-claim WETH and USDC amounts to the caller. One claim per address per cooldown period.
    function claim() external {
        uint256 availableAt = nextClaimAt[msg.sender];
        // forge-lint: disable-next-line(block-timestamp) -- a one-day cooldown
        if (block.timestamp < availableAt) revert CooldownActive(availableAt);
        if (WETH.balanceOf(address(this)) < WETH_PER_CLAIM || USDC.balanceOf(address(this)) < USDC_PER_CLAIM) {
            revert FaucetEmpty();
        }

        nextClaimAt[msg.sender] = block.timestamp + COOLDOWN;
        emit Claimed(msg.sender, WETH_PER_CLAIM, USDC_PER_CLAIM);

        WETH.safeTransfer(msg.sender, WETH_PER_CLAIM);
        USDC.safeTransfer(msg.sender, USDC_PER_CLAIM);
    }

    /// @notice Withdraws remaining tokens from the faucet. Owner only.
    function withdraw(IERC20 token, address recipient, uint256 amount) external onlyOwner {
        token.safeTransfer(recipient, amount);
    }
}
