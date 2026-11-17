import { BaseError, ContractFunctionRevertedError, SwitchChainError, UserRejectedRequestError } from "viem";

const SWITCH_BY_HAND = "Your wallet did not switch networks. Switch networks in your wallet, then try again.";

const REVERT_MESSAGES: Record<string, string> = {
  InsufficientOutput: "The price changed while you were confirming. Try again.",
  ZeroAmount: "Enter an amount above zero.",
  CooldownActive: "This wallet already got tokens today. Come back tomorrow.",
  FaucetEmpty: "We ran out of test tokens. Please tell the team.",
  ERC20InsufficientBalance: "Your balance is too low for this amount.",
  ERC20InsufficientAllowance: "The permission did not cover this amount. Try again.",
  // OrderBook (src/orders/OrderBook.sol)
  UnsupportedToken: "This token is not supported here.",
  OrderTooSmall: "This order is smaller than the minimum order size.",
  ZeroTriggerPrice: "Enter a trigger price above zero.",
  ZeroMinAmountOut: "Enter how much you want to receive at least, above zero.",
  WrongOrderFee: "The trigger fee sent did not match the fee the order book asks for. Reload the page and try again.",
  ExpiryNotInFuture: "The expiry is already in the past. Pick an expiry and try again.",
  ExpiryTooFar: "An order can last at most 7 days. Pick a shorter expiry.",
  NotOrderOwner: "Only the wallet that placed this order can cancel it.",
  OrderNotOpen: "This order is no longer open, so there is nothing to cancel.",
};

/** wagmi's own errors are not viem errors, so they are recognised by name. */
const WAGMI_MESSAGES: Record<string, string> = {
  SwitchChainNotSupportedError: SWITCH_BY_HAND,
  ConnectorChainMismatchError: "Your wallet is on a different network. Switch networks in your wallet, then try again.",
};

/** Turns a wallet or RPC error into one sentence a visitor can act on. */
export function describeTxError(error: unknown): string {
  if (error instanceof Error && Object.hasOwn(WAGMI_MESSAGES, error.name)) return WAGMI_MESSAGES[error.name];
  if (!(error instanceof BaseError)) return "Something went wrong. Try again.";
  if (error.walk((cause) => cause instanceof UserRejectedRequestError)) return "You cancelled the request in your wallet.";
  if (error.walk((cause) => cause instanceof SwitchChainError)) return SWITCH_BY_HAND;

  const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    const name = revert.data?.errorName ?? "";
    if (Object.hasOwn(REVERT_MESSAGES, name)) return REVERT_MESSAGES[name];
    return `The contract rejected the transaction${name ? ` (${name})` : ""}.`;
  }
  return error.shortMessage;
}
