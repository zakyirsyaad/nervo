import { parseAbi } from "viem";

export const poolAbi = parseAbi([
  "function getReserves() view returns (uint256 reserveWeth, uint256 reserveUsdc)",
  "function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, address recipient) returns (uint256 amountOut)",
  "event ReserveUpdate(address indexed initiator, uint256 reserveWeth, uint256 reserveUsdc, uint256 sequence, uint256 timestamp)",
  "event Swap(address indexed sender, address indexed tokenIn, address indexed recipient, uint256 amountIn, uint256 amountOut)",
  "error UnsupportedToken(address token)",
  "error ZeroAmount()",
  "error InsufficientOutput(uint256 amountOut, uint256 minAmountOut)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

export const faucetAbi = parseAbi([
  "function claim()",
  "function nextClaimAt(address account) view returns (uint256)",
  "error CooldownActive(uint256 availableAt)",
  "error FaucetEmpty()",
]);

export const reactiveAbi = parseAbi([
  "event DecisionRecorded(bytes32 indexed opportunityId, address indexed pool, uint8 decision, uint256 originTxHash, uint256 originLogIndex, uint256 sequence, uint8 route, uint256 quotedOut, uint256 sourceTimestamp)",
]);

export const executorAbi = parseAbi([
  "event ArbOutcome(bytes32 indexed opportunityId, uint8 outcome, uint8 route, uint256 amountIn, uint256 minSurplus, uint256 quotedOut, uint256 actualOut, uint256 timestamp)",
]);

// Order matches the Solidity enums in src/ArbReactive.sol and src/ArbExecutor.sol.
export const DECISIONS = [
  "CallbackRequested",
  "UnknownSource",
  "StaleOrDuplicateLog",
  "SnapshotIncomplete",
  "SnapshotStale",
  "ExecutorSwap",
  "MarginBelowThreshold",
] as const;

export const OUTCOMES = [
  "Executed",
  "SkippedAlreadyExecuted",
  "SkippedExpired",
  "SkippedInvalidRoute",
  "SkippedInputOutOfBounds",
  "SkippedMarginGone",
  "SkippedInsufficientInventory",
  "SwapReverted",
] as const;

export type Decision = (typeof DECISIONS)[number];
export type Outcome = (typeof OUTCOMES)[number];
