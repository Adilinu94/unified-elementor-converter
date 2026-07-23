/**
 * Recon-Runner — Detects SPA frameworks and dynamic DOM changes.
 */
import type { Page } from 'playwright';
import type { ReconOptions, ReconResult, ReconEvent } from './types.js';
import { collectSpaSignals, detectSpaFramework } from './detect-spa.js';

/**
 * Collect SPA presence flags inside the browser page.
 */
export async function collectPageSpaSignals(page: Page): Promise<ReturnType<typeof collectSpaSignals>> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      hasNextData: Boolean(w.__NEXT_DATA__),
      hasNuxt: Boolean(w.__NUXT__),
      hasAngular: Boolean(document.querySelector('[ng-version]')),
      hasReact: Boolean(w.__react),
      hasFramer: Boolean(document.querySelector('[data-framer-name]')),
      hasAstro: Boolean(w.astro),
    };
  });
}

/**
 * Observe mutations/animations for a window of time.
 */
export async function observeDynamicEvents(
  page: Page,
  options: { windowMs?: number; maxEvents?: number; targetSelector?: string } = {},
): Promise<{
  mutationCount: number;
  animationCount: number;
  events: ReconEvent[];
  durationMs: number;
}> {
  const windowMs = options.windowMs ?? 5000;
  const maxEvents = options.maxEvents ?? 500;
  const targetSelector = options.targetSelector ?? 'body';

  const result = await page.evaluate(
    ({ windowMs, maxEvents, targetSelector }) => {
      return new Promise<{
        mutationCount: number;
        animationCount: number;
        events: Array<{
          type: 'mutation' | 'animation';
          selector: string;
          mutationType?: string;
          animationType?: string;
          timestamp: number;
        }>;
        durationMs: number;
      }>((resolve) => {
        const start = performance.now();
        const events: Array<{
          type: 'mutation' | 'animation';
          selector: string;
          mutationType?: string;
          animationType?: string;
          timestamp: number;
        }> = [];
        let mutationCount = 0;
        let animationCount = 0;

        const target = document.querySelector(targetSelector) ?? document.body;

        const obs = new MutationObserver((records) => {
          for (const record of records) {
            if (events.length >= maxEvents) break;
            mutationCount++;
            const t = record.target as Element;
            events.push({
              type: 'mutation',
              selector: t.tagName?.toLowerCase() ?? 'unknown',
              mutationType: record.type,
              timestamp: performance.now() - start,
            });
          }
        });
        obs.observe(target, { childList: true, subtree: true, attributes: true });

        const animHandler = (ev: Event) => {
          if (events.length >= maxEvents) return;
          animationCount++;
          events.push({
            type: 'animation',
            selector: (ev.target as Element)?.tagName?.toLowerCase() ?? 'unknown',
            animationType: ev.type,
            timestamp: performance.now() - start,
          });
        };
        document.addEventListener('animationstart', animHandler);
        document.addEventListener('transitionrun', animHandler);

        setTimeout(() => {
          obs.disconnect();
          document.removeEventListener('animationstart', animHandler);
          document.removeEventListener('transitionrun', animHandler);
          resolve({
            mutationCount,
            animationCount,
            events: events.slice(0, maxEvents),
            durationMs: Math.round(performance.now() - start),
          });
        }, windowMs);
      });
    },
    { windowMs, maxEvents, targetSelector },
  );

  return result;
}

/**
 * Full recon: SPA detection (pure) + optional live mutation window.
 */
export async function runRecon(page: Page, options: ReconOptions = {}): Promise<ReconResult> {
  const signals = await collectPageSpaSignals(page);
  const spa = detectSpaFramework(signals);

  const dynamic = await observeDynamicEvents(page, {
    windowMs: options.windowMs,
    maxEvents: options.maxEvents,
    targetSelector: options.targetSelector,
  });

  return {
    isSpa: spa.isSpa,
    framework: spa.framework,
    mutationCount: dynamic.mutationCount,
    animationCount: dynamic.animationCount,
    events: dynamic.events,
    durationMs: dynamic.durationMs,
  };
}

/** Re-export pure helpers for consumers who only need SPA detection. */
export { detectSpaFramework, collectSpaSignals };
