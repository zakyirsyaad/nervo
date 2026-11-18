import type { Metadata } from "next";
import { LATENCIES_MS } from "@/data/evidence";
import { percentile } from "@/lib/latency";

/** The production address. Canonical URLs, Open Graph URLs, robots and the sitemap all point here. */
export const SITE_URL = "https://nervo.zorvolabs.xyz";
export const SITE_NAME = "Nervo";
export const SITE_TITLE = "Nervo: Cross-Chain Arbitrage and Stop-Losses on Reactive";
export const SITE_DESCRIPTION =
  "A Reactive contract on Lasna trades Base Sepolia price gaps and fills Unichain stop-losses in about two seconds, with no bot or keeper. Try it on testnet.";

const MEDIAN_SECONDS = ((percentile(LATENCIES_MS, 50) ?? 0) / 1000).toFixed(1);
/** The home page's h1, reused on the social preview image so a shared link shows what the page says. */
export const SITE_HEADLINE = `Spots a price gap and trades it in ${MEDIAN_SECONDS} seconds.`;
export const SITE_CHAINS = ["Base Sepolia", "Reactive Lasna", "Unichain Sepolia"] as const;

/**
 * The preview image from app/opengraph-image.tsx. Next attaches that file to the home page by itself, but a
 * page that sets its own `openGraph` loses it, so every page lists it explicitly.
 */
export const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${SITE_NAME}. ${SITE_HEADLINE} Across ${SITE_CHAINS.join(", ")}.`,
} as const;

/** Every route the sitemap lists, in navigation order. */
export const SITE_PATHS = ["/", "/trade", "/orders", "/evidence"] as const;
export type SitePath = (typeof SITE_PATHS)[number];

interface PageMetadataInput {
  /** Page title before the " · Nervo" suffix. Left out for the home page, which uses the site title. */
  readonly title?: string;
  readonly description: string;
  readonly path: SitePath;
}

/**
 * Title, description, canonical URL, Open Graph and Twitter tags for one page. Next.js merges metadata
 * shallowly, so a page that sets `openGraph` replaces the layout's whole object: building every page's tags
 * here keeps them complete.
 */
export function pageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_TITLE;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
  };
}
