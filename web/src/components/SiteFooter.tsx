import Link from "next/link";
import { GITHUB_URL } from "@/config/contracts";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="bar">
        <span>Arb Loop · Built for the Reactive Omni Buildathon · Testnet only, no real funds.</span>
        <nav aria-label="Footer">
          <Link href="/trade">Trade</Link>
          <Link href="/evidence">Evidence</Link>
          {GITHUB_URL ? (
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
