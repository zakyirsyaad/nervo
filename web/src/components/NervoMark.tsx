const MARK_SIZE_PX = 20;

/**
 * The Nervo symbol: an N broken in its diagonal. Strokes in currentColor so it follows the text colour.
 * Decorative: the name is always written beside it. Source: docs/brand/nervo-symbol.svg.
 */
export function NervoMark() {
  return (
    <svg
      width={MARK_SIZE_PX}
      height={MARK_SIZE_PX}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 19V5l5.2 6" />
      <path d="M13.8 13L19 19V5" />
    </svg>
  );
}
