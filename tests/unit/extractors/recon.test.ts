import { describe, it, expect, vi } from 'vitest';
import {
  detectSpaFramework,
  collectSpaSignals,
  runRecon,
  type ReconResult,
  type ReconOptions,
} from '@elconv/extractors';

describe('detectSpaFramework (pure shipped logic)', () => {
  it('detects next.js from __NEXT_DATA__', () => {
    expect(detectSpaFramework({ hasNextData: true })).toEqual({
      isSpa: true,
      framework: 'next.js',
    });
  });

  it('detects nuxt, angular, react, framer, astro in priority order', () => {
    expect(detectSpaFramework({ hasNuxt: true }).framework).toBe('nuxt');
    expect(detectSpaFramework({ hasAngular: true }).framework).toBe('angular');
    expect(detectSpaFramework({ hasReact: true }).framework).toBe('react');
    expect(detectSpaFramework({ hasFramer: true }).framework).toBe('framer');
    expect(detectSpaFramework({ hasAstro: true }).framework).toBe('astro');
  });

  it('prefers next.js over later signals', () => {
    const result = detectSpaFramework({
      hasNextData: true,
      hasReact: true,
      hasFramer: true,
    });
    expect(result.framework).toBe('next.js');
  });

  it('returns non-SPA when no signals present', () => {
    expect(detectSpaFramework({})).toEqual({ isSpa: false, framework: null });
  });
});

describe('collectSpaSignals (pure shipped logic)', () => {
  it('maps globals and selectors into SpaSignals', () => {
    const signals = collectSpaSignals(
      { __NEXT_DATA__: { page: '/' }, __react: true },
      (sel) => (sel === '[data-framer-name]' ? {} : null),
    );
    expect(signals.hasNextData).toBe(true);
    expect(signals.hasReact).toBe(true);
    expect(signals.hasFramer).toBe(true);
    expect(signals.hasAngular).toBe(false);
    expect(detectSpaFramework(signals).framework).toBe('next.js');
  });

  it('detects angular via querySelector', () => {
    const signals = collectSpaSignals({}, (sel) => (sel === '[ng-version]' ? true : null));
    expect(detectSpaFramework(signals)).toEqual({ isSpa: true, framework: 'angular' });
  });
});

describe('runRecon (page boundary double)', () => {
  it('calls detectSpaFramework path via collectPageSpaSignals + observes events', async () => {
    const evaluate = vi.fn(async (fn: (arg: unknown) => unknown, arg?: unknown) => {
      // First call: SPA signals from browser
      if (arg === undefined) {
        return {
          hasNextData: true,
          hasNuxt: false,
          hasAngular: false,
          hasReact: false,
          hasFramer: false,
          hasAstro: false,
        };
      }
      // Second call: mutation window — execute callback is not needed; return fixture
      return {
        mutationCount: 2,
        animationCount: 1,
        events: [
          { type: 'mutation' as const, selector: 'div', mutationType: 'childList', timestamp: 10 },
        ],
        durationMs: 50,
      };
    });

    const page = { evaluate } as unknown as import('playwright').Page;
    const result = await runRecon(page, { windowMs: 100, maxEvents: 10 });

    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe('next.js');
    expect(result.mutationCount).toBe(2);
    expect(result.animationCount).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('returns non-SPA when browser signals are empty', async () => {
    const evaluate = vi.fn(async (fn: (arg: unknown) => unknown, arg?: unknown) => {
      if (arg === undefined) {
        return {
          hasNextData: false,
          hasNuxt: false,
          hasAngular: false,
          hasReact: false,
          hasFramer: false,
          hasAstro: false,
        };
      }
      return { mutationCount: 0, animationCount: 0, events: [], durationMs: 5 };
    });

    const page = { evaluate } as unknown as import('playwright').Page;
    const result: ReconResult = await runRecon(page, {} as ReconOptions);
    expect(result.isSpa).toBe(false);
    expect(result.framework).toBeNull();
    expect(result.mutationCount).toBe(0);
  });
});
