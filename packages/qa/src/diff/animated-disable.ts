/**
 * animated-disable.ts — Modul V1.5 (UMBAUPLAN.md §6).
 *
 * Injects CSS that kills all animations/transitions before a screenshot,
 * so a diff never fails just because the original and clone happened to
 * be captured at different points mid-animation.
 */

import type { Page } from 'playwright';

const KILL_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }
`;

/** Injects CSS that kills all animations/transitions. Call before every `page.screenshot()`. */
export async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({ content: KILL_ANIMATIONS_CSS });
  await page.waitForTimeout(200);
}
