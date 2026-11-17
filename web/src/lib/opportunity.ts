import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export interface TriggerLog {
  readonly chainId: number;
  readonly pool: Address;
  readonly txHash: Hex;
  readonly logIndex: number;
}

/** keccak256(abi.encode(chainId, pool, txHash, logIndex)), as computed in ArbReactive.react. */
export function opportunityId(log: TriggerLog): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [BigInt(log.chainId), log.pool, BigInt(log.txHash), BigInt(log.logIndex)],
    ),
  );
}
