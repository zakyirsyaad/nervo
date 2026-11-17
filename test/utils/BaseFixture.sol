// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { TestToken } from "../../src/fixtures/TestToken.sol";
import { ConstantProductPool } from "../../src/fixtures/ConstantProductPool.sol";
import { IArbPool } from "../../src/interfaces/IArbPool.sol";
import { ArbExecutor } from "../../src/ArbExecutor.sol";
import { ArbReactive } from "../../src/ArbReactive.sol";
import { MockSystemContract } from "../mocks/MockSystemContract.sol";
import { MockCallbackProxy } from "../mocks/MockCallbackProxy.sol";

/// @dev Brief fixture: Pool A 100 WETH / 300,000 USDC, fee 0.30%, input 1,000 USDC, threshold 2 USDC.
abstract contract BaseFixture is Test {
    address internal constant SYSTEM_ADDRESS = 0x8888888888888888888888888888888888888888;
    uint256 internal constant ORIGIN_CHAIN_ID = 84532;
    uint256 internal constant ONE_WETH = 1e18;
    uint256 internal constant ONE_USDC = 1e6;
    uint256 internal constant POOL_WETH = 100 * ONE_WETH;
    uint256 internal constant POOL_A_USDC = 300_000 * ONE_USDC;
    uint256 internal constant POOL_B_USDC_3060 = 306_000 * ONE_USDC;
    uint256 internal constant POOL_B_USDC_3030 = 303_000 * ONE_USDC;
    uint256 internal constant FEE_BPS = 30;
    uint256 internal constant INPUT = 1_000 * ONE_USDC;
    uint256 internal constant MIN_SURPLUS = 2 * ONE_USDC;
    uint256 internal constant MAX_INPUT = 5_000 * ONE_USDC;
    uint256 internal constant INVENTORY = 10_000 * ONE_USDC;
    uint256 internal constant MAX_SNAPSHOT_AGE = 1 hours;
    uint256 internal constant CALLBACK_TTL = 60;
    uint64 internal constant CALLBACK_GAS = 600_000;
    uint256 internal constant START_TIME = 1_800_000_000;

    TestToken internal weth;
    TestToken internal usdc;
    ConstantProductPool internal poolA;
    ConstantProductPool internal poolB;
    MockSystemContract internal system;
    MockCallbackProxy internal proxy;
    ArbExecutor internal executor;
    ArbReactive internal reactive;
    address internal trader = makeAddr("trader");

    function _deployCore(bool requestEveryCandidate, uint256 costBuffer) internal {
        vm.warp(START_TIME);
        vm.etch(SYSTEM_ADDRESS, address(new MockSystemContract()).code);
        system = MockSystemContract(payable(SYSTEM_ADDRESS));
        proxy = new MockCallbackProxy();

        weth = new TestToken("Test Wrapped Ether", "tWETH", 18, address(this));
        usdc = new TestToken("Test USD Coin", "tUSDC", 6, address(this));
        poolA = new ConstantProductPool(address(weth), address(usdc), FEE_BPS, address(this));
        poolB = new ConstantProductPool(address(weth), address(usdc), FEE_BPS, address(this));

        address predictedReactive = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        executor = new ArbExecutor(proxy, predictedReactive, poolA, poolB, MAX_INPUT, address(this));
        reactive = new ArbReactive(_config(requestEveryCandidate, costBuffer));
        assertEq(address(reactive), predictedReactive, "reactive address prediction");

        usdc.mint(address(executor), INVENTORY);
        weth.mint(trader, 1_000 * ONE_WETH);
        usdc.mint(trader, 10_000_000 * ONE_USDC);
        vm.startPrank(trader);
        weth.approve(address(poolA), type(uint256).max);
        weth.approve(address(poolB), type(uint256).max);
        usdc.approve(address(poolA), type(uint256).max);
        usdc.approve(address(poolB), type(uint256).max);
        vm.stopPrank();
    }

    function _config(bool requestEveryCandidate, uint256 costBuffer) internal view returns (ArbReactive.Config memory) {
        return ArbReactive.Config({
            originChainId: ORIGIN_CHAIN_ID,
            poolA: address(poolA),
            poolB: address(poolB),
            executor: address(executor),
            inputAmount: INPUT,
            minSurplus: MIN_SURPLUS,
            costBuffer: costBuffer,
            feeBps: FEE_BPS,
            maxSnapshotAge: MAX_SNAPSHOT_AGE,
            callbackTtl: CALLBACK_TTL,
            callbackGasLimit: CALLBACK_GAS,
            requestEveryCandidate: requestEveryCandidate
        });
    }

    function _addLiquidity(ConstantProductPool pool, uint256 wethAmount, uint256 usdcAmount) internal {
        weth.mint(address(this), wethAmount);
        usdc.mint(address(this), usdcAmount);
        weth.approve(address(pool), wethAmount);
        usdc.approve(address(pool), usdcAmount);
        pool.addLiquidity(wethAmount, usdcAmount);
    }

    function _logRecord(
        address pool,
        address initiator,
        uint256 reserveWeth,
        uint256 reserveUsdc,
        uint256 sequence,
        uint256 timestamp,
        uint256 txHash
    ) internal view returns (IReactive.LogRecord memory) {
        return IReactive.LogRecord({
            chainId: ORIGIN_CHAIN_ID,
            contractAddress: pool,
            topic0: reactive.RESERVE_UPDATE_TOPIC0(),
            topic1: uint256(uint160(initiator)),
            topic2: 0,
            topic3: 0,
            data: abi.encode(reserveWeth, reserveUsdc, sequence, timestamp),
            blockNumber: 1_000 + sequence,
            opCode: 2,
            blockHash: 0,
            txHash: txHash,
            logIndex: 0
        });
    }

    function _react(IReactive.LogRecord memory record) internal {
        vm.prank(SYSTEM_ADDRESS);
        reactive.react(record);
    }

    function _opportunityId(IReactive.LogRecord memory record) internal pure returns (bytes32) {
        return keccak256(abi.encode(record.chainId, record.contractAddress, record.txHash, record.logIndex));
    }

    function _callbackPayload(bytes32 id, uint8 route, uint256 amountIn, uint256 minSurplus, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(executor.executeArb, (address(0), id, route, amountIn, minSurplus, deadline));
    }
}
