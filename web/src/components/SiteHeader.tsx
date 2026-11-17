"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GITHUB_URL } from "@/config/contracts";
import { WalletButton } from "./WalletButton";

const NAV_LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/evidence", label: "Evidence" },
  { href: "/#contracts", label: "Contracts" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="bar">
        <Link href="/" className="wordmark">
          Arb Loop
        </Link>
        <nav className="site-nav" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
          {GITHUB_URL ? (
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          ) : null}
        </nav>
        <div className="chain-badge">
          <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="Base">
            <rect width="16" height="16" rx="1.5" fill="var(--base-brand)" />
          </svg>
          <span>BASE SEPOLIA</span>
        </div>
        <WalletButton />
      </div>
    </header>
  );
}
