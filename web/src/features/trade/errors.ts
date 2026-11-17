import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const REVERT_MESSAGES: Record<string, string> = {
  InsufficientOutput: "The price changed while you were confirming. Try again.",
  ZeroAmount: "Enter an amount above zero.",
  CooldownActive: "This wallet already got tokens today. Come back tomorrow.",
  FaucetEmpty: "We ran out of test tokens. Please tell the team.",
  ERC20InsufficientBalance: "Your balance is too low for this swap.",
  ERC20InsufficientAllowance: "The permission did not cover this amount. Try again.",
};

/** Turns a wallet or RPC error into one sentence a visitor can act on. */
export function describeTxError(error: unknown): string {
  if (!(error instanceof BaseError)) return "Something went wrong. Try again.";
  if (error.walk((cause) => cause instanceof UserRejectedRequestError)) return "You cancelled the request in your wallet.";

  const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    const name = revert.data?.errorName ?? "";
    return REVERT_MESSAGES[name] ?? `The contract rejected the transaction${name ? ` (${name})` : ""}.`;
  }
  return error.shortMessage;
}
