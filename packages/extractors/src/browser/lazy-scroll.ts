/**
 * Lazy-Scroll — Triggers IntersectionObserver-based lazy-loads.
 */
import type { Page } from 'playwright';

export async function triggerLazyLoad(
  page: Page,
  options: { stepPx?: number; maxScrolls?: number; delayMs?: number } = {},
): Promise<{ scrollsPerformed: number; totalHeight: number }> {
  const stepPx = options.stepPx ?? 400;
  const maxScrolls = options.maxScrolls ?? 50;
  const delayMs = options.delayMs ?? 100;

  const totalHeight = await page.evaluate(() => document.body.scrollHeight);
  let scrollsPerformed = 0;

  for (let y = 0; y < totalHeight && scrollsPerformed < maxScrolls; y += stepPx) {
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await new Promise((r) => setTimeout(r, delayMs));
    scrollsPerformed++;
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 200));

  return { scrollsPerformed, totalHeight };
}
