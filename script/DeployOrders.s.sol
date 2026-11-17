// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { TestToken } from "../src/fixtures/TestToken.sol";
import { TestFaucet } from "../src/fixtures/TestFaucet.sol";
import { ConstantProductPool } from "../src/fixtures/ConstantProductPool.sol";
import { OrderBook } from "../src/orders/OrderBook.sol";

/// @notice Deploys the protective-order stack on the order chain (Unichain Sepolia): two test tokens, the
///         execution pool, a faucet and the OrderBook.
/// @dev The OrderReactive address is predicted from the deployer nonce on Lasna, because the OrderBook stores
///      it as an immutable. Required env: LASNA_NONCE, ORDERBOOK_FUNDING_WEI (> 0, the starting balance that
///      pays the callback proxy until order fees accumulate). Optional env: ORDER_CALLBACK_PROXY,
///      ORDER_POOL_WETH and ORDER_POOL_USDC (seed reserves in base units).
contract DeployOrders is Script {
    uint256 private constant UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
    /// @dev Callback proxy on Unichain Sepolia, from the Reactive docs.
    address private constant UNICHAIN_SEPOLIA_CALLBACK_PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
    uint256 private constant FEE_BPS = 30;
    uint256 private constant DEFAULT_POOL_WETH = 100e18;
    uint256 private constant DEFAULT_POOL_USDC = 300_000e6;
    uint256 private constant WETH_PER_CLAIM = 5e18;
    uint256 private constant USDC_PER_CLAIM = 10_000e6;
    uint256 private constant COOLDOWN = 1 days;
    uint256 private constant FUNDED_CLAIMS = 500;

    function run() external {
        require(block.chainid == UNICHAIN_SEPOLIA_CHAIN_ID, "DeployOrders must run on Unichain Sepolia (chain 1301)");
        address deployer = msg.sender;
        address callbackProxy = vm.envOr("ORDER_CALLBACK_PROXY", UNICHAIN_SEPOLIA_CALLBACK_PROXY);
        uint256 lasnaNonce = vm.envUint("LASNA_NONCE");
        uint256 poolWeth = vm.envOr("ORDER_POOL_WETH", DEFAULT_POOL_WETH);
        uint256 poolUsdc = vm.envOr("ORDER_POOL_USDC", DEFAULT_POOL_USDC);
        uint256 orderBookFunding = vm.envOr("ORDERBOOK_FUNDING_WEI", uint256(0));
        address predictedReactive = vm.computeCreateAddress(deployer, lasnaNonce);
        require(callbackProxy.code.length > 0, "callback proxy has no code on this chain");
        require(poolWeth > 0 && poolUsdc > 0, "pool seed reserves must be positive");
        require(orderBookFunding > 0, "set ORDERBOOK_FUNDING_WEI > 0: the OrderBook pays the callback proxy");

        vm.startBroadcast();
        TestToken weth = new TestToken("Test Wrapped Ether", "tWETH", 18, deployer);
        TestToken usdc = new TestToken("Test USD Coin", "tUSDC", 6, deployer);
        ConstantProductPool pool = new ConstantProductPool(address(weth), address(usdc), FEE_BPS, deployer);
        weth.mint(deployer, poolWeth);
        usdc.mint(deployer, poolUsdc);
        weth.approve(address(pool), poolWeth);
        usdc.approve(address(pool), poolUsdc);
        pool.addLiquidity(poolWeth, poolUsdc);

        TestFaucet faucet = new TestFaucet(
            IERC20(address(weth)), IERC20(address(usdc)), WETH_PER_CLAIM, USDC_PER_CLAIM, COOLDOWN, deployer
        );
        weth.mint(address(faucet), FUNDED_CLAIMS * WETH_PER_CLAIM);
        usdc.mint(address(faucet), FUNDED_CLAIMS * USDC_PER_CLAIM);

        OrderBook orderBook = new OrderBook{ value: orderBookFunding }(
            IPayable(payable(callbackProxy)), predictedReactive, pool, deployer
        );
        vm.stopBroadcast();

        console.log("chainId                ", block.chainid);
        console.log("ORDER_WETH             ", address(weth));
        console.log("ORDER_USDC             ", address(usdc));
        console.log("ORDER_POOL             ", address(pool));
        console.log("ORDER_FAUCET           ", address(faucet));
        console.log("ORDER_BOOK             ", address(orderBook));
        console.log("ORDER_CALLBACK_PROXY   ", callbackProxy);
        console.log("EXPECTED_ORDER_REACTIVE", predictedReactive);
    }
}
