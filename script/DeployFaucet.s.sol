// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TestToken } from "../src/fixtures/TestToken.sol";
import { TestFaucet } from "../src/fixtures/TestFaucet.sol";

/// @notice Deploys the public faucet for the test tokens and funds its inventory by minting.
/// @dev Required env: WETH_ADDRESS, USDC_ADDRESS. Run by the owner of the test tokens (deployer),
///      because TestToken.mint is restricted to onlyOwner.
contract DeployFaucet is Script {
    uint256 private constant WETH_PER_CLAIM = 5e18;
    uint256 private constant USDC_PER_CLAIM = 10_000e6;
    uint256 private constant COOLDOWN = 1 days;
    uint256 private constant FUNDED_CLAIMS = 500;

    function run() external {
        address deployer = msg.sender;
        TestToken weth = TestToken(vm.envAddress("WETH_ADDRESS"));
        TestToken usdc = TestToken(vm.envAddress("USDC_ADDRESS"));
        require(address(weth).code.length > 0, "WETH_ADDRESS has no code on this chain");
        require(address(usdc).code.length > 0, "USDC_ADDRESS has no code on this chain");
        require(weth.owner() == deployer, "broadcaster is not the WETH owner");
        require(usdc.owner() == deployer, "broadcaster is not the USDC owner");

        vm.startBroadcast();
        TestFaucet faucet = new TestFaucet(
            IERC20(address(weth)), IERC20(address(usdc)), WETH_PER_CLAIM, USDC_PER_CLAIM, COOLDOWN, deployer
        );
        weth.mint(address(faucet), FUNDED_CLAIMS * WETH_PER_CLAIM);
        usdc.mint(address(faucet), FUNDED_CLAIMS * USDC_PER_CLAIM);
        vm.stopBroadcast();

        console.log("chainId", block.chainid);
        console.log("FAUCET ", address(faucet));
        console.log("WETH   ", weth.balanceOf(address(faucet)));
        console.log("USDC   ", usdc.balanceOf(address(faucet)));
    }
}
