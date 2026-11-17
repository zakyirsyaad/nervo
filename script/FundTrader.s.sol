// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Funds the benchmark trader with a little ETH for gas and test tokens for the trigger swaps.
/// @dev Required env: TRADER, WETH, USDC. Run by the holder of the test tokens (deployer).
contract FundTrader is Script {
    uint256 private constant GAS_FUNDING = 0.0003 ether;
    uint256 private constant WETH_FUNDING = 100e18;
    uint256 private constant USDC_FUNDING = 2_000_000e6;

    function run() external {
        address payable trader = payable(vm.envAddress("TRADER"));
        IERC20 weth = IERC20(vm.envAddress("WETH"));
        IERC20 usdc = IERC20(vm.envAddress("USDC"));

        vm.startBroadcast();
        (bool sent,) = trader.call{ value: GAS_FUNDING }("");
        require(sent, "ETH transfer failed");
        require(weth.transfer(trader, WETH_FUNDING), "WETH transfer failed");
        require(usdc.transfer(trader, USDC_FUNDING), "USDC transfer failed");
        vm.stopBroadcast();

        console.log("TRADER", trader);
        console.log("ETH   ", trader.balance);
        console.log("WETH  ", weth.balanceOf(trader));
        console.log("USDC  ", usdc.balanceOf(trader));
    }
}
