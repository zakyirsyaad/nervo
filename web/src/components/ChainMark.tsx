import type { ChainKey } from "@/config/chains";

interface ChainMarkProps {
  chain: ChainKey;
}

/** Square in the chain's colour. Hidden from screen readers: the chain is always named in the text beside it. */
export function ChainMark({ chain }: ChainMarkProps) {
  return <span className="chain-mark" data-chain={chain} aria-hidden="true" />;
}
