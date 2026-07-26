/**
 * Pure SPA-framework detection — no Playwright dependency.
 * Shared by recon-runner (browser signals) and unit tests.
 */

export interface SpaSignals {
  hasNextData?: boolean;
  hasNuxt?: boolean;
  hasAngular?: boolean;
  hasReact?: boolean;
  hasFramer?: boolean;
  hasAstro?: boolean;
}

export interface SpaDetection {
  isSpa: boolean;
  framework: string | null;
}

/**
 * Detect SPA framework from boolean presence signals.
 * Priority: Next.js → Nuxt → Angular → React → Framer → Astro.
 */
export function detectSpaFramework(signals: SpaSignals): SpaDetection {
  if (signals.hasNextData) return { isSpa: true, framework: 'next.js' };
  if (signals.hasNuxt) return { isSpa: true, framework: 'nuxt' };
  if (signals.hasAngular) return { isSpa: true, framework: 'angular' };
  if (signals.hasReact) return { isSpa: true, framework: 'react' };
  if (signals.hasFramer) return { isSpa: true, framework: 'framer' };
  if (signals.hasAstro) return { isSpa: true, framework: 'astro' };
  return { isSpa: false, framework: null };
}

/**
 * Collect SPA signals from a window-like object + querySelector.
 * Usable with real browser globals or plain test doubles.
 */
export function collectSpaSignals(
  globals: Record<string, unknown>,
  querySelector: (selector: string) => unknown,
): SpaSignals {
  return {
    hasNextData: Boolean(globals.__NEXT_DATA__),
    hasNuxt: Boolean(globals.__NUXT__),
    hasAngular: Boolean(querySelector('[ng-version]')),
    hasReact: Boolean(globals.__react),
    hasFramer: Boolean(querySelector('[data-framer-name]')),
    hasAstro: Boolean(globals.astro),
  };
}
