// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IArbPool } from "../src/interfaces/IArbPool.sol";
import { TestFaucet } from "../src/fixtures/TestFaucet.sol";
import { OrderBook } from "../src/orders/OrderBook.sol";

/// @notice Runs one protective order end to end on testnet, in two broadcasts on two chains.
/// @dev place() on Unichain Sepolia: claims test WETH from the faucet if needed and places a stop-loss.
///      Env: ORDER_BOOK, ORDER_FAUCET, TRIGGER_PRICE (USDC base units per WETH), MIN_OUT (USDC base units),
///      optional SMOKE_WETH (default 0.1 WETH).
///      drop() on Base Sepolia: sells WETH on the price pool so its price falls through the trigger.
///      Env: optional PRICE_POOL (default the main stack's Pool A), SELL_WETH (default 0.8 WETH).
contract OrderScenario is Script {
    address private constant MAIN_POOL_A = 0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F;
    uint256 private constant UNICHAIN_SEPOLIA = 1301;
    uint256 private constant BASE_SEPOLIA = 84532;

    function place() external {
        require(block.chainid == UNICHAIN_SEPOLIA, "place() runs on Unichain Sepolia");
        OrderBook book = OrderBook(payable(vm.envAddress("ORDER_BOOK")));
        TestFaucet faucet = TestFaucet(vm.envAddress("ORDER_FAUCET"));
        IERC20 weth = book.WETH();
        uint256 amount = vm.envOr("SMOKE_WETH", uint256(0.1 ether));
        uint256 triggerPrice = vm.envUint("TRIGGER_PRICE");
        uint256 minOut = vm.envUint("MIN_OUT");

        vm.startBroadcast();
        if (weth.balanceOf(msg.sender) < amount) faucet.claim();
        weth.approve(address(book), amount);
        uint256 orderId = book.placeOrder{ value: book.ORDER_FEE() }(
            address(weth),
            amount,
            OrderBook.Condition.PriceAtOrBelow,
            triggerPrice,
            minOut,
            uint64(block.timestamp + 1 days)
        );
        vm.stopBroadcast();

        console.log("ORDER_ID", orderId);
    }

    function drop() external {
        require(block.chainid == BASE_SEPOLIA, "drop() runs on Base Sepolia");
        IArbPool pool = IArbPool(vm.envOr("PRICE_POOL", MAIN_POOL_A));
        IERC20 weth = IERC20(pool.weth());
        uint256 amount = vm.envOr("SELL_WETH", uint256(0.8 ether));
        (uint256 reserveWeth, uint256 reserveUsdc) = pool.getReserves();
        console.log("price before", reserveUsdc * 1e18 / reserveWeth);

        vm.startBroadcast();
        weth.approve(address(pool), amount);
        pool.swap(address(weth), amount, 0, msg.sender);
        vm.stopBroadcast();

        (reserveWeth, reserveUsdc) = pool.getReserves();
        console.log("price after ", reserveUsdc * 1e18 / reserveWeth);
    }
}
