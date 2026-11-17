"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GITHUB_URL } from "@/config/contracts";
import { ChainMark } from "./ChainMark";
import { WalletButton } from "./WalletButton";

const NAV_LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/orders", label: "Protect" },
  { href: "/evidence", label: "Evidence" },
  { href: "/#contracts", label: "Contracts" },
] as const;

/** Network the current page asks the wallet to use. */
const PAGE_CHAIN = {
  base: { key: "base", brand: "Base" },
  unichain: { key: "unichain", brand: "Unichain" },
} as const;

export function SiteHeader() {
  const pathname = usePathname();
  const chain = pathname === "/orders" ? PAGE_CHAIN.unichain : PAGE_CHAIN.base;

  return (
    <header className="site-header">
      <div className="bar">
        <Link href="/" className="wordmark">
          Nervo
        </Link>
        <nav className="site-nav" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
          {GITHUB_URL ? (
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="nav-external">
              GitHub ↗
            </a>
          ) : null}
        </nav>
        <div className="chain-badge">
          <ChainMark chain={chain.key} />
          <span>
            {chain.brand}
            <span className="chain-network"> Sepolia</span>
          </span>
        </div>
        <div className="header-wallet">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
