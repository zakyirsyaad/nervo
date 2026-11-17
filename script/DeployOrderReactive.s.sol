// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { OrderReactive } from "../src/orders/OrderReactive.sol";

/// @notice Deploys OrderReactive on Lasna. Run it after DeployOrders.
/// @dev Required env: ORDER_BOOK, EXPECTED_ORDER_REACTIVE, REACTIVE_FUNDING_WEI (> 0). Optional env:
///      PRICE_POOL (default: the main stack's Pool A on Base Sepolia), ORDER_CALLBACK_GAS_LIMIT,
///      MAX_TRIGGERS_PER_LOG. The deploy aborts if the resulting address differs from the one already locked
///      into the OrderBook.
contract DeployOrderReactive is Script {
    uint256 private constant LASNA_CHAIN_ID = 5318007;
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint256 private constant UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
    address private constant MAIN_POOL_A = 0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F;
    uint256 private constant DEFAULT_CALLBACK_GAS_LIMIT = 400_000;
    uint256 private constant DEFAULT_MAX_TRIGGERS_PER_LOG = 5;

    function run() external {
        require(block.chainid == LASNA_CHAIN_ID, "DeployOrderReactive must run on Lasna (chain 5318007)");
        address expectedReactive = vm.envAddress("EXPECTED_ORDER_REACTIVE");
        OrderReactive.Config memory config = OrderReactive.Config({
            priceChainId: BASE_SEPOLIA_CHAIN_ID,
            pricePool: vm.envOr("PRICE_POOL", MAIN_POOL_A),
            orderChainId: UNICHAIN_SEPOLIA_CHAIN_ID,
            orderBook: vm.envAddress("ORDER_BOOK"),
            callbackGasLimit: SafeCast.toUint64(vm.envOr("ORDER_CALLBACK_GAS_LIMIT", DEFAULT_CALLBACK_GAS_LIMIT)),
            maxTriggersPerLog: vm.envOr("MAX_TRIGGERS_PER_LOG", DEFAULT_MAX_TRIGGERS_PER_LOG)
        });
        uint256 funding = vm.envOr("REACTIVE_FUNDING_WEI", uint256(0));
        require(funding > 0, "set REACTIVE_FUNDING_WEI > 0: OrderReactive pays for its reactive transactions");
        address predicted = vm.computeCreateAddress(msg.sender, vm.getNonce(msg.sender));
        require(predicted == expectedReactive, "deployer nonce changed: address does not match the OrderBook");

        vm.startBroadcast();
        OrderReactive reactive = new OrderReactive{ value: funding }(config);
        vm.stopBroadcast();

        console.log("chainId       ", block.chainid);
        console.log("ORDER_REACTIVE", address(reactive));
        console.log("PRICE_POOL    ", config.pricePool);
        console.log("ORDER_BOOK    ", config.orderBook);
    }
}
