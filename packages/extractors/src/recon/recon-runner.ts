/**
 * Recon-Runner — Detects SPA frameworks and dynamic DOM changes.
 */
import type { Page } from 'playwright';
import type { ReconOptions, ReconResult } from './types.js';

export async function runRecon(page: Page, options: ReconOptions = {}): Promise<ReconResult> {
  const windowMs = options.windowMs ?? 5000;
  const maxEvents = options.maxEvents ?? 500;
  const targetSelector = options.targetSelector ?? 'body';

  const result = await page.evaluate(
    ({ windowMs, maxEvents, targetSelector }) => {
      return new Promise<{
        isSpa: boolean;
        framework: string | null;
        mutationCount: number;
        animationCount: number;
        events: Array<{ type: string; selector: string; mutationType?: string; timestamp: number }>;
        durationMs: number;
      }>((resolve) => {
        const start = performance.now();
        const events: Array<Record<string, unknown>> = [];
        let mutationCount = 0;
        let animationCount = 0;

        let framework: string | null = null;
        let isSpa = false;
        const w = window as unknown as Record<string, unknown>;
        if (w.__NEXT_DATA__) {
          framework = 'next.js';
          isSpa = true;
        } else if (w.__NUXT__) {
          framework = 'nuxt';
          isSpa = true;
        } else if (document.querySelector('[ng-version]')) {
          framework = 'angular';
          isSpa = true;
        } else if (w.__react) {
          framework = 'react';
          isSpa = true;
        } else if (document.querySelector('[data-framer-name]')) {
          framework = 'framer';
          isSpa = true;
        } else if (w.astro) {
          framework = 'astro';
          isSpa = true;
        }

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
            isSpa,
            framework,
            mutationCount,
            animationCount,
            events: events.slice(0, maxEvents) as Array<{
              type: string;
              selector: string;
              mutationType?: string;
              timestamp: number;
            }>,
            durationMs: Math.round(performance.now() - start),
          });
        }, windowMs);
      });
    },
    { windowMs, maxEvents, targetSelector },
  );

  return result as ReconResult;
}
