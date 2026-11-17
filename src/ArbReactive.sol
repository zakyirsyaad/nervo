// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractReactive } from "@reactive/src/base/AbstractReactive.sol";
import { ArbMath } from "./libraries/ArbMath.sol";

/// @title Reactive contract on Lasna: tracks snapshots of two pools and decides whether to send a callback.
/// @notice Every received log ends with exactly one DecisionRecorded event.
contract ArbReactive is AbstractReactive {
    enum Decision {
        CallbackRequested,
        UnknownSource,
        StaleOrDuplicateLog,
        SnapshotIncomplete,
        SnapshotStale,
        ExecutorSwap,
        MarginBelowThreshold
    }

    struct Config {
        uint256 originChainId;
        address poolA;
        address poolB;
        address executor;
        uint256 inputAmount; // USDC traded per opportunity
        uint256 minSurplus; // minimum surplus, also enforced by the executor
        uint256 costBuffer; // extra margin on Lasna for the callback cost
        uint256 feeBps; // swap fee of both pools
        uint256 maxSnapshotAge; // max source-time gap to the other pool's snapshot, in seconds
        uint256 callbackTtl; // callback lifetime from the source time, in seconds
        uint64 callbackGasLimit;
        bool requestEveryCandidate; // true = baseline without the economic filter
    }

    struct Snapshot {
        uint256 reserveWeth;
        uint256 reserveUsdc;
        uint256 sequence;
        uint256 sourceTimestamp;
        uint256 blockNumber;
        uint256 logIndex;
    }

    /// @dev keccak256("ReserveUpdate(address,uint256,uint256,uint256,uint256)")
    uint256 public constant RESERVE_UPDATE_TOPIC0 =
        uint256(keccak256("ReserveUpdate(address,uint256,uint256,uint256,uint256)"));
    string private constant CALLBACK_SIGNATURE = "executeArb(address,bytes32,uint8,uint256,uint256,uint256)";
    uint8 private constant ROUTE_BUY_A_SELL_B = 0;
    uint8 private constant ROUTE_BUY_B_SELL_A = 1;
    /// @dev The executor's two swaps use about 150k gas; below this floor the callback risks running out of gas.
    uint64 private constant MIN_CALLBACK_GAS = 300_000;
    uint256 private constant MAX_AMOUNT = 1e30;
    uint256 private constant MAX_DURATION = 365 days;

    uint256 public immutable ORIGIN_CHAIN_ID;
    address public immutable POOL_A;
    address public immutable POOL_B;
    address public immutable EXECUTOR;
    uint256 public immutable INPUT_AMOUNT;
    uint256 public immutable MIN_SURPLUS;
    uint256 public immutable COST_BUFFER;
    uint256 public immutable FEE_BPS;
    uint256 public immutable MAX_SNAPSHOT_AGE;
    uint256 public immutable CALLBACK_TTL;
    uint64 public immutable CALLBACK_GAS_LIMIT;
    bool public immutable REQUEST_EVERY_CANDIDATE;

    mapping(address => Snapshot) public snapshots;
    mapping(Decision => uint256) public decisionCounts;

    /// @param opportunityId keccak256(chainId, pool, txHash, logIndex) of the triggering log.
    /// @param quotedOut Estimated USDC for the best route (0 if not evaluated).
    event DecisionRecorded(
        bytes32 indexed opportunityId,
        address indexed pool,
        Decision decision,
        uint256 originTxHash,
        uint256 originLogIndex,
        uint256 sequence,
        uint8 route,
        uint256 quotedOut,
        uint256 sourceTimestamp
    );

    error InvalidConfig();

    constructor(Config memory config_) payable {
        if (
            config_.poolA == address(0) || config_.poolB == address(0) || config_.poolA == config_.poolB
                || config_.executor == address(0) || config_.inputAmount == 0 || config_.feeBps >= ArbMath.BPS
                || config_.callbackGasLimit < MIN_CALLBACK_GAS || config_.inputAmount > MAX_AMOUNT
                || config_.minSurplus > MAX_AMOUNT || config_.costBuffer > MAX_AMOUNT
                || config_.maxSnapshotAge > MAX_DURATION || config_.callbackTtl > MAX_DURATION
        ) revert InvalidConfig();

        ORIGIN_CHAIN_ID = config_.originChainId;
        POOL_A = config_.poolA;
        POOL_B = config_.poolB;
        EXECUTOR = config_.executor;
        INPUT_AMOUNT = config_.inputAmount;
        MIN_SURPLUS = config_.minSurplus;
        COST_BUFFER = config_.costBuffer;
        FEE_BPS = config_.feeBps;
        MAX_SNAPSHOT_AGE = config_.maxSnapshotAge;
        CALLBACK_TTL = config_.callbackTtl;
        CALLBACK_GAS_LIMIT = config_.callbackGasLimit;
        REQUEST_EVERY_CANDIDATE = config_.requestEveryCandidate;

        _subscribe(config_.originChainId, config_.poolA);
        _subscribe(config_.originChainId, config_.poolB);
    }

    /// @notice Called by the system contract for every log that matches a subscription.
    function react(LogRecord calldata log_) external onlySystem {
        bytes32 opportunityId = keccak256(abi.encode(log_.chainId, log_.contractAddress, log_.txHash, log_.logIndex));

        if (!_isKnownSource(log_)) {
            _record(opportunityId, log_, Decision.UnknownSource, 0, 0, 0, 0);
            return;
        }

        (uint256 reserveWeth, uint256 reserveUsdc, uint256 sequence, uint256 sourceTimestamp) =
            abi.decode(log_.data, (uint256, uint256, uint256, uint256));

        if (sequence <= snapshots[log_.contractAddress].sequence) {
            _record(opportunityId, log_, Decision.StaleOrDuplicateLog, sequence, 0, 0, sourceTimestamp);
            return;
        }
        snapshots[log_.contractAddress] =
            Snapshot(reserveWeth, reserveUsdc, sequence, sourceTimestamp, log_.blockNumber, log_.logIndex);

        Decision decision;
        uint8 route;
        uint256 quotedOut;
        (decision, route, quotedOut) = _evaluate(log_, sourceTimestamp);
        if (decision == Decision.CallbackRequested) {
            _requestCallback(opportunityId, route, sourceTimestamp + CALLBACK_TTL);
        }
        _record(opportunityId, log_, decision, sequence, route, quotedOut, sourceTimestamp);
    }

    /// @notice Estimated USDC for both routes from the stored snapshots.
    function quoteRoutes() public view returns (uint256 buyASellB, uint256 buyBSellA) {
        Snapshot storage a = snapshots[POOL_A];
        Snapshot storage b = snapshots[POOL_B];
        buyASellB = ArbMath.roundTrip(INPUT_AMOUNT, a.reserveWeth, a.reserveUsdc, b.reserveWeth, b.reserveUsdc, FEE_BPS);
        buyBSellA = ArbMath.roundTrip(INPUT_AMOUNT, b.reserveWeth, b.reserveUsdc, a.reserveWeth, a.reserveUsdc, FEE_BPS);
    }

    /// @notice Pays off the debt to the system contract from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    function _evaluate(LogRecord calldata log_, uint256 sourceTimestamp)
        private
        view
        returns (Decision, uint8 route, uint256 quotedOut)
    {
        Snapshot storage other = snapshots[log_.contractAddress == POOL_A ? POOL_B : POOL_A];
        if (other.sequence == 0) return (Decision.SnapshotIncomplete, 0, 0);
        if (sourceTimestamp > other.sourceTimestamp + MAX_SNAPSHOT_AGE) return (Decision.SnapshotStale, 0, 0);
        if (address(uint160(log_.topic1)) == EXECUTOR) return (Decision.ExecutorSwap, 0, 0);

        (uint256 buyASellB, uint256 buyBSellA) = quoteRoutes();
        (route, quotedOut) = buyASellB >= buyBSellA ? (ROUTE_BUY_A_SELL_B, buyASellB) : (ROUTE_BUY_B_SELL_A, buyBSellA);

        bool isProfitable = quotedOut >= INPUT_AMOUNT + MIN_SURPLUS + COST_BUFFER;
        if (!isProfitable && !REQUEST_EVERY_CANDIDATE) return (Decision.MarginBelowThreshold, route, quotedOut);
        return (Decision.CallbackRequested, route, quotedOut);
    }

    function _requestCallback(bytes32 opportunityId, uint8 route, uint256 deadline) private {
        bytes memory payload = abi.encodeWithSignature(
            CALLBACK_SIGNATURE, address(0), opportunityId, route, INPUT_AMOUNT, MIN_SURPLUS, deadline
        );
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: ORIGIN_CHAIN_ID, recipient: EXECUTOR, gasLimit: CALLBACK_GAS_LIMIT, payload: payload
            })
        );
    }

    function _isKnownSource(LogRecord calldata log_) private view returns (bool) {
        return log_.chainId == ORIGIN_CHAIN_ID && (log_.contractAddress == POOL_A || log_.contractAddress == POOL_B)
            && log_.topic0 == RESERVE_UPDATE_TOPIC0;
    }

    function _record(
        bytes32 opportunityId,
        LogRecord calldata log_,
        Decision decision,
        uint256 sequence,
        uint8 route,
        uint256 quotedOut,
        uint256 sourceTimestamp
    ) private {
        decisionCounts[decision] += 1;
        emit DecisionRecorded(
            opportunityId,
            log_.contractAddress,
            decision,
            log_.txHash,
            log_.logIndex,
            sequence,
            route,
            quotedOut,
            sourceTimestamp
        );
    }

    function _subscribe(uint256 chainId, address pool) private {
        SYSTEM.subscribe(chainId, pool, RESERVE_UPDATE_TOPIC0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }
}
