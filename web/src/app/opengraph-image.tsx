import { ImageResponse } from "next/og";
import { OG_IMAGE, SITE_CHAINS, SITE_HEADLINE } from "@/config/site";

// Colours from the dark theme in globals.css: --ground, --fg, --fg-muted, --fg-subtle, --accent, --surface-3.
const GROUND = "#0a0a0b";
const FG = "#fafafa";
const FG_MUTED = "#a1a1aa";
const FG_SUBTLE = "#8b8b94";
const ACCENT = "#a78bfa";
const RULE = "#1f1f23";

export const alt = OG_IMAGE.alt;
export const size = { width: OG_IMAGE.width, height: OG_IMAGE.height };
export const contentType = "image/png";

/** The social preview for every page: the Nervo symbol, the measured headline and the three chains. */
export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: GROUND,
          color: FG,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* The Nervo symbol from components/NervoMark.tsx, drawn larger in the accent colour. */}
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 19V5l5.2 6" />
            <path d="M13.8 13L19 19V5" />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>Nervo</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 78, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>{SITE_HEADLINE}</div>
          <div style={{ fontSize: 32, lineHeight: 1.35, color: FG_MUTED, maxWidth: 940 }}>
            Cross-chain arbitrage and stop-losses, decided by a contract on Reactive Lasna with no bot or keeper.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 28,
            borderTop: `2px solid ${RULE}`,
            fontSize: 26,
          }}
        >
          <div style={{ display: "flex", color: FG_SUBTLE }}>{SITE_CHAINS.join("  ·  ")}</div>
          <div style={{ display: "flex", color: ACCENT }}>nervo.zorvolabs.xyz</div>
        </div>
      </div>
    ),
    size,
  );
}
