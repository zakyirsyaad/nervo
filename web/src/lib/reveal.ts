/** How much of the viewport height an element's top may sit below before it counts as out of view. */
const VISIBLE_TOP_FRACTION = 0.6;

/**
 * Scrolls an element to the top of the viewport when its top is off screen or low on it, for example the
 * swap timeline on a phone, where it sits below the long form the user just submitted. It does nothing
 * when the element is already in view, so a wide layout that shows it beside the form stays put.
 */
export function revealIfOffscreen(element: HTMLElement | null): void {
  if (!element) return;
  const { top } = element.getBoundingClientRect();
  if (top >= 0 && top <= window.innerHeight * VISIBLE_TOP_FRACTION) return;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
}
