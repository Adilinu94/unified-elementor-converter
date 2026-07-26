/**
 * SPA-Hydration-Wait.
 * Wartet auf React/Next.js/Framer Hydration bevor Extraction startet.
 */
import type { Page } from 'playwright';

const HYDRATION_SELECTORS = [
  '[data-hydrated="true"]',
  '[data-react-helmet]',
  '#__next[data-hydrated]',
  '[data-framer-name][data-framer-appear-id]',
  'astro-island[ssr]',
  '[ng-version]',
];

export async function waitForHydration(
  page: Page,
  options: {
    selectorTimeoutMs?: number;
    idleStabilizationMs?: number;
    introAnimationSleepMs?: number;
  } = {},
): Promise<{ strategy: 'selector' | 'observer'; elapsedMs: number }> {
  const selectorTimeoutMs = options.selectorTimeoutMs ?? 10_000;
  const idleStabilizationMs = options.idleStabilizationMs ?? 1500;
  const introAnimationSleepMs = options.introAnimationSleepMs ?? 2000;
  const start = Date.now();

  // 1) Known hydration marker
  try {
    await page.waitForSelector(HYDRATION_SELECTORS.join(','), { timeout: selectorTimeoutMs });
    await sleep(introAnimationSleepMs);
    return { strategy: 'selector', elapsedMs: Date.now() - start };
  } catch { /* fall through */ }

  // 2) MutationObserver-based idle detector
  await page.evaluate(
    `new Promise((resolve) => {
      let stable = 0;
      const stableMs = ${idleStabilizationMs};
      const obs = new MutationObserver(() => { stable = 0; });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      const tick = setInterval(() => {
        stable += 100;
        if (stable >= stableMs) { clearInterval(tick); obs.disconnect(); resolve(); }
      }, 100);
    })`,
  );
  await sleep(introAnimationSleepMs);
  return { strategy: 'observer', elapsedMs: Date.now() - start };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
