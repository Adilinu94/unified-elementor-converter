/**
 * Adaptive scroll-trajectory (V2 Pre-Flight, replaces fixed 200px step scroll).
 *
 * V1 used `stepPx: 200` across the entire page, which meant a 10.000px page
 * produced only ~50 steps (833px apart). Animations triggered over a 200px
 * range were routinely missed, especially ScrollTrigger pin/scrub animations.
 *
 * V2 strategy:
 *   - Step = max(stepPx, minStepPx), so we never go smaller than minStepPx
 *     (default 50px) or larger than stepPx (default 600px)
 *   - BUT for each known "trigger region" (IntersectionObserver targets,
 *     [data-framer-name], [data-scroll-trigger], .gsap-marker, .lenis-target),
 *     we add extra samples around the trigger (entry, mid, exit)
 *   - Optional: sample on rAF to catch entrance animations
 *
 * The function does not mutate the DOM — it just scrolls and lets Playwright's
 * `page.evaluate` do the heavy lifting. Caller decides whether to take
 * screenshots at each sample or just trigger lazy-loads.
 */

import type { Page } from 'playwright';

export interface AdaptiveScrollOptions {
  /** Maximum step between samples (default 600). */
  stepPx?: number;
  /** Minimum step — never scroll smaller than this (default 50). */
  minStepPx?: number;
  /** Max ms per scroll step (default 1500). */
  maxStepMs?: number;
  /** Wait for network-idle after each step (default false — only at end). */
  waitPerStep?: boolean;
  /** Final waitForLoadState('networkidle') after scrolling (default true). */
  waitForNetworkIdle?: boolean;
  /** Network-idle timeout (default 30s). */
  networkIdleTimeoutMs?: number;
  /** Reset to top after scroll (default true). */
  resetToTop?: boolean;
  /** Number of extra samples around detected trigger regions (default 3 = entry/mid/exit). */
  triggerSamples?: number;
}

export interface AdaptiveScrollResult {
  scrolledPx: number;
  documentHeightPx: number;
  stepCount: number;
  triggerRegionCount: number;
  samples: Array<{ y: number; kind: 'uniform' | 'trigger' }>;
  elapsedMs: number;
}

const TRIGGER_SELECTORS = [
  '[data-framer-name]',
  '[data-framer-component]',
  '[data-scroll-trigger]',
  '.gsap-marker',
  '.lenis-target',
  '[data-aos]',
  '[data-animate]',
  '[data-parallax]',
  '[data-scroll]',
].join(', ');

/**
 * Compute the scroll y-coordinates to visit, given the page height and
 * detected trigger regions. Public for unit tests.
 *
 * @param documentHeight Page total scrollable height (px).
 * @param triggerYs Trigger-region y-coordinates (deduplicated, sorted asc).
 * @param options Step/limit settings.
 */
export function planAdaptiveSamples(
  documentHeight: number,
  triggerYs: number[],
  options: Pick<AdaptiveScrollOptions, 'stepPx' | 'minStepPx' | 'triggerSamples'> = {},
): number[] {
  const stepPx = Math.max(1, options.stepPx ?? 600);
  const minStepPx = Math.max(1, options.minStepPx ?? 50);
  const triggerSamples = Math.max(0, options.triggerSamples ?? 3);
  const effectiveStep = Math.max(stepPx, minStepPx);

  const ys: number[] = [];
  const visited = new Set<number>();
  const addSample = (y: number) => {
    const clamped = Math.max(0, Math.min(documentHeight, Math.round(y)));
    // Snap within 5px to avoid duplicates from arithmetic
    for (const existing of visited) {
      if (Math.abs(existing - clamped) < 5) return;
    }
    visited.add(clamped);
    ys.push(clamped);
  };

  // Uniform sweep
  for (let y = 0; y <= documentHeight; y += effectiveStep) {
    addSample(y);
  }

  // Extra trigger-region samples
  for (const triggerY of triggerYs) {
    const offset = effectiveStep / Math.max(triggerSamples, 1);
    if (triggerSamples === 3) {
      addSample(triggerY - offset); // entry
      addSample(triggerY); // mid
      addSample(triggerY + offset); // exit
    } else if (triggerSamples === 2) {
      addSample(triggerY - offset);
      addSample(triggerY + offset);
    } else if (triggerSamples === 1) {
      addSample(triggerY);
    }
  }

  return ys.sort((a, b) => a - b);
}

/** Detect trigger-region y-coordinates by querying the page. */
async function collectTriggerYs(page: Page): Promise<number[]> {
  return await page.evaluate((selector: string) => {
    const ys: number[] = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect();
      const scrollY = window.scrollY || window.pageYOffset;
      const top = Math.round(r.top + scrollY);
      const mid = Math.round(top + r.height / 2);
      ys.push(top, mid);
    }
    return ys;
  }, TRIGGER_SELECTORS);
}

/**
 * Run the adaptive scroll-trajectory.
 *
 * Sequence per sample:
 *   1. window.scrollTo(0, y)
 *   2. wait one animation frame
 *   3. optionally wait for networkidle
 */
export async function runAdaptiveScroll(
  page: Page,
  options: AdaptiveScrollOptions = {},
): Promise<AdaptiveScrollResult> {
  const start = Date.now();
  const waitForNetworkIdle = options.waitForNetworkIdle !== false;
  const resetToTop = options.resetToTop !== false;
  const networkIdleTimeoutMs = options.networkIdleTimeoutMs ?? 30_000;
  const maxStepMs = options.maxStepMs ?? 1500;

  const documentHeightPx = await page.evaluate(() => document.body.scrollHeight);
  const triggerYs = await collectTriggerYs(page);
  const yTargets = planAdaptiveSamples(documentHeightPx, triggerYs, options);

  // Mark which samples are trigger-samples for telemetry
  const triggerSet = new Set<number>();
  for (const y of triggerYs) {
    triggerSet.add(y);
    // Also: anything within 50px of a trigger counts as a trigger-sample
    for (const target of yTargets) {
      if (Math.abs(target - y) <= 50) triggerSet.add(target);
    }
  }
  const samples: AdaptiveScrollResult['samples'] = yTargets.map((y) => ({
    y,
    kind: triggerSet.has(y) ? 'trigger' : 'uniform',
  }));

  for (const y of yTargets) {
    await page.evaluate((target: number) => window.scrollTo(0, target), y);
    // One rAF to let transition/animation frames paint
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    if (options.waitPerStep === true) {
      await page.waitForLoadState('networkidle', { timeout: Math.min(maxStepMs, networkIdleTimeoutMs) });
    }
  }

  if (waitForNetworkIdle) {
    await page.waitForLoadState('networkidle', { timeout: networkIdleTimeoutMs });
  }

  if (resetToTop) {
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  // scrolledPx calculation is approximate; we report total vertical distance.
  const totalDistance = yTargets.reduce((acc, y, i) => (i === 0 ? 0 : acc + Math.abs(y - yTargets[i - 1])), 0);

  return {
    scrolledPx: totalDistance,
    documentHeightPx,
    stepCount: yTargets.length,
    triggerRegionCount: triggerYs.length,
    samples,
    elapsedMs: Date.now() - start,
  };
}