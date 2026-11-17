// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { TestToken } from "../src/fixtures/TestToken.sol";
import { ConstantProductPool } from "../src/fixtures/ConstantProductPool.sol";
import { ArbExecutor } from "../src/ArbExecutor.sol";

/// @notice Deploys the unfiltered baseline stack on Base Sepolia: two new pools and a new executor on top
///         of the existing test tokens. Its Reactive contract is deployed through DeployReactive with
///         REQUEST_EVERY_CANDIDATE=true.
/// @dev Required env: WETH, USDC. The caller must own the test USDC (to mint the executor inventory).
///      This stack is kept apart from the main stack on purpose, so the two executors do not compete for the same gap.
contract DeployBaseline is Script {
    struct Deployment {
        ConstantProductPool poolA;
        ConstantProductPool poolB;
        ArbExecutor executor;
        address expectedReactive;
    }

    address private constant BASE_SEPOLIA_CALLBACK_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
    uint256 private constant FEE_BPS = 30;
    uint256 private constant MAX_INPUT = 5_000e6;
    uint256 private constant EXECUTOR_INVENTORY = 10_000e6;

    function run() external returns (Deployment memory) {
        return deploy(
            msg.sender,
            vm.envAddress("WETH"),
            TestToken(vm.envAddress("USDC")),
            vm.envOr("CALLBACK_PROXY", BASE_SEPOLIA_CALLBACK_PROXY),
            vm.envOr("LASNA_NONCE", uint256(0)),
            vm.envOr("EXECUTOR_FUNDING_WEI", uint256(0))
        );
    }

    /// @param deployer Account that broadcasts; it becomes the owner of the pools and the executor.
    function deploy(
        address deployer,
        address weth,
        TestToken usdc,
        address callbackProxy,
        uint256 lasnaNonce,
        uint256 executorFunding
    ) public returns (Deployment memory d) {
        d.expectedReactive = vm.computeCreateAddress(deployer, lasnaNonce);
        require(weth.code.length > 0, "WETH has no code on this chain");
        require(address(usdc).code.length > 0, "USDC has no code on this chain");
        require(callbackProxy.code.length > 0, "callback proxy has no code on this chain");

        vm.startBroadcast();
        d.poolA = new ConstantProductPool(weth, address(usdc), FEE_BPS, deployer);
        d.poolB = new ConstantProductPool(weth, address(usdc), FEE_BPS, deployer);
        d.executor = new ArbExecutor{ value: executorFunding }(
            IPayable(payable(callbackProxy)), d.expectedReactive, d.poolA, d.poolB, MAX_INPUT, deployer
        );
        usdc.mint(address(d.executor), EXECUTOR_INVENTORY);
        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("POOL_A           ", address(d.poolA));
        console.log("POOL_B           ", address(d.poolB));
        console.log("EXECUTOR         ", address(d.executor));
        console.log("EXPECTED_REACTIVE", d.expectedReactive);
    }
}
