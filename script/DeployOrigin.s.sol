// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { TestToken } from "../src/fixtures/TestToken.sol";
import { ConstantProductPool } from "../src/fixtures/ConstantProductPool.sol";
import { ArbExecutor } from "../src/ArbExecutor.sol";

/// @notice Deploys the test tokens, two pools and the executor on the origin/destination chain (Base Sepolia).
/// @dev The Reactive contract address is predicted from the deployer nonce on Lasna (env LASNA_NONCE),
///      because the executor stores it as an immutable.
contract DeployOrigin is Script {
    address private constant BASE_SEPOLIA_CALLBACK_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
    uint256 private constant FEE_BPS = 30;
    uint256 private constant MAX_INPUT = 5_000e6;
    uint256 private constant EXECUTOR_INVENTORY = 10_000e6;
    uint256 private constant DEPLOYER_WETH = 10_000e18;
    uint256 private constant DEPLOYER_USDC = 30_000_000e6;

    function run() external {
        address deployer = msg.sender;
        address callbackProxy = vm.envOr("CALLBACK_PROXY", BASE_SEPOLIA_CALLBACK_PROXY);
        uint256 lasnaNonce = vm.envOr("LASNA_NONCE", uint256(0));
        uint256 executorFunding = vm.envOr("EXECUTOR_FUNDING_WEI", uint256(0));
        address predictedReactive = vm.computeCreateAddress(deployer, lasnaNonce);
        require(callbackProxy.code.length > 0, "callback proxy has no code on this chain");

        vm.startBroadcast();
        TestToken weth = new TestToken("Test Wrapped Ether", "tWETH", 18, deployer);
        TestToken usdc = new TestToken("Test USD Coin", "tUSDC", 6, deployer);
        ConstantProductPool poolA = new ConstantProductPool(address(weth), address(usdc), FEE_BPS, deployer);
        ConstantProductPool poolB = new ConstantProductPool(address(weth), address(usdc), FEE_BPS, deployer);
        ArbExecutor executor = new ArbExecutor{ value: executorFunding }(
            IPayable(payable(callbackProxy)), predictedReactive, poolA, poolB, MAX_INPUT, deployer
        );
        usdc.mint(address(executor), EXECUTOR_INVENTORY);
        weth.mint(deployer, DEPLOYER_WETH);
        usdc.mint(deployer, DEPLOYER_USDC);
        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("WETH             ", address(weth));
        console.log("USDC             ", address(usdc));
        console.log("POOL_A           ", address(poolA));
        console.log("POOL_B           ", address(poolB));
        console.log("EXECUTOR         ", address(executor));
        console.log("EXPECTED_REACTIVE", predictedReactive);
    }
}
