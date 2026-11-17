import Image from "next/image";
import type { ChainKey } from "@/config/chains";

/**
 * Official logos, served from public/chains. Base and Unichain are the chain icons RainbowKit ships (MIT,
 * chainIcons/base.svg and unichain.svg; base.svg gained a viewBox so it scales). Reactive is the "symbol,
 * colour on dark" from reactive.network/press. Shown as-is, never recoloured.
 */
const LOGO_SRC: Record<ChainKey, string> = {
  base: "/chains/base.svg",
  lasna: "/chains/reactive.svg",
  unichain: "/chains/unichain.svg",
};

const LOGO_SIZE_PX = 14;

interface ChainMarkProps {
  chain: ChainKey;
}

/** The chain's logo. Empty alt: the chain is always named in the text beside it. */
export function ChainMark({ chain }: ChainMarkProps) {
  return <Image className="chain-mark" src={LOGO_SRC[chain]} alt="" width={LOGO_SIZE_PX} height={LOGO_SIZE_PX} />;
}
