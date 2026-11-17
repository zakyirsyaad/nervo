import { addressUrl, txUrl, type ChainKey } from "@/config/chains";
import { shortHex } from "@/lib/format";

interface HashLinkProps {
  chain: ChainKey;
  hash: string;
  /** "tx" shortens the hash; "address" shows it in full. */
  kind?: "tx" | "address";
}

export function HashLink({ chain, hash, kind = "tx" }: HashLinkProps) {
  const href = kind === "tx" ? txUrl(chain, hash) : addressUrl(chain, hash);

  return (
    <a className="hash" href={href} target="_blank" rel="noreferrer">
      {kind === "tx" ? shortHex(hash) : hash} ↗
    </a>
  );
}
