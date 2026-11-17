import { parseAbi } from "viem";

// ABIs of src/orders/OrderBook.sol (Unichain Sepolia) and src/orders/OrderReactive.sol (Lasna).
// Solidity enums encode as uint8; the arrays below list their members in declaration order.

export const orderBookAbi = parseAbi([
  "function placeOrder(address tokenIn, uint256 amountIn, uint8 condition, uint256 triggerPrice, uint256 minAmountOut, uint64 expiry) payable returns (uint256 orderId)",
  "function cancelOrder(uint256 orderId)",
  "function getOrder(uint256 orderId) view returns ((address owner, uint64 expiry, uint8 condition, uint8 status, address tokenIn, uint256 amountIn, uint256 triggerPrice, uint256 minAmountOut) order)",
  "function nextOrderId() view returns (uint256)",
  "function ORDER_FEE() view returns (uint256)",
  "function MIN_WETH_IN() view returns (uint256)",
  "function MIN_USDC_IN() view returns (uint256)",
  "function MAX_ORDER_LIFETIME() view returns (uint256)",
  "event OrderPlaced(uint256 indexed orderId, address indexed owner, address tokenIn, uint256 amountIn, uint8 condition, uint256 triggerPrice, uint256 minAmountOut, uint64 expiry)",
  "event OrderCancelled(uint256 indexed orderId)",
  "event OrderOutcome(uint256 indexed orderId, uint8 outcome, uint256 amountOut, uint256 observedPrice, uint256 sourceTimestamp, uint256 timestamp)",
  "error UnsupportedToken(address token)",
  "error ZeroAmount()",
  "error OrderTooSmall(uint256 amountIn, uint256 minimum)",
  "error ZeroTriggerPrice()",
  "error ZeroMinAmountOut()",
  "error WrongOrderFee(uint256 sent, uint256 required)",
  "error ExpiryNotInFuture(uint64 expiry)",
  "error ExpiryTooFar(uint64 expiry, uint256 latest)",
  "error NotOrderOwner(uint256 orderId, address caller)",
  "error OrderNotOpen(uint256 orderId, uint8 status)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

export const orderReactiveAbi = parseAbi([
  "function trackedPerOwner(address owner) view returns (uint256)",
  "event OrderTriggered(uint256 indexed orderId, uint256 price, uint256 sourceTimestamp, bool afterTimeout)",
  "event OrderMirrored(uint256 indexed orderId, uint8 state, uint8 reason)",
]);

export const ORDER_CONDITIONS = ["PriceAtOrBelow", "PriceAtOrAbove"] as const;
export const ORDER_STATUSES = ["None", "Open", "Filled", "Cancelled", "Expired"] as const;
export const ORDER_OUTCOMES = ["Filled", "SkippedNotOpen", "SkippedExpired", "SkippedSlippage"] as const;
export const MIRROR_STATES = ["None", "Open", "Pending", "Closed"] as const;
export const MIRROR_REASONS = [
  "Placed",
  "PlacedUntracked",
  "Cancelled",
  "Filled",
  "Expired",
  "NotOpen",
  "Rearmed",
  "NoChange",
  "OwnerLimit",
  "RetryLimit",
  "AttemptLimit",
] as const;

export type Condition = (typeof ORDER_CONDITIONS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderOutcome = (typeof ORDER_OUTCOMES)[number];
export type MirrorState = (typeof MIRROR_STATES)[number];
export type MirrorReason = (typeof MIRROR_REASONS)[number];
