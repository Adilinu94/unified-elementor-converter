/**
 * @keyframes Discovery (Sprint 2C).
 *
 * Two strategies combined for maximum coverage:
 *   1. Same-origin: walk `document.styleSheets` (works only for own origin)
 *   2. Cross-origin: parse the CSS bodies that were intercepted via
 *      `page.route()` (works for any CDN-hosted CSS).
 *
 * The Page-level intercept is registered by the caller BEFORE `page.goto()`
 * — we just consume the buffered bodies here. This solves the CORS problem
 * (cross-origin `cssRules` throws SecurityError silently).
 *
 * Also captures CSS `transition` properties for hover/click animations.
 *
 * Based on BAUPLAN §2 Schritt 7 + 8 (combined for Sprint 2C).
 */

import type { Page } from 'playwright';

export interface KeyframeDefinition {
  name: string;
  source: string;
  cross_origin: boolean;
  durations?: string[];
}

export interface TransitionUsage {
  selector: string;
  property: string;
  duration: string;
  easing: string;
  delay: string;
}

export interface AnimationDiscovery {
  keyframes: KeyframeDefinition[];
  same_origin_count: number;
  cross_origin_count: number;
  transitions: TransitionUsage[];
  gsap: { hasGSAP: boolean; hasScrollTrigger: boolean };
}

export interface CrossOriginStylesheet {
  url: string;
  body: string;
}

function buildSameOriginScript(maxTrans: number): string {
  return `(() => {
  const localKeyframes = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const r = rule;
      if (r.type === 7 && r.name) {
        localKeyframes.push({ name: r.name, source: sheet.href || 'inline' });
      }
    }
  }

  const transitions = [];
  const all = document.querySelectorAll('*');
  const limit = Math.min(all.length, ${maxTrans});
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    const cs = getComputedStyle(el);
    const trans = cs.transition;
    if (!trans || trans === 'all 0s ease 0s' || trans === 'none 0s ease 0s' || trans === 'none') continue;
    const parts = trans.split(/,(?![^()]*\\))/);
    for (const part of parts) {
      const tokens = part.trim().split(/\\s+/);
      const durMatch = tokens.find((t) => /^\\d+(\\.\\d+)?(m?s)$/.test(t));
      if (!durMatch) continue;
      transitions.push({
        selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + ((el.className && typeof el.className === 'string') ? '.' + el.className.split(/\\s+/)[0] : ''),
        property: tokens[0],
        duration: durMatch,
        easing: tokens.find((t) => /^(ease|linear|cubic-bezier|step)/.test(t)) || 'ease',
        delay: tokens.find((t, idx) => idx > 0 && /^\\d+(\\.\\d+)?(m?s)$/.test(t) && t !== durMatch) || '0s',
      });
    }
  }

  const w = globalThis;
  return {
    localKeyframes,
    transitions,
    hasGSAP: typeof w.gsap === 'object' && w.gsap !== null,
    hasScrollTrigger: typeof w.ScrollTrigger === 'object' && w.ScrollTrigger !== null,
  };
})()`;
}

interface SameOriginResult {
  localKeyframes: Array<{ name: string; source: string }>;
  transitions: TransitionUsage[];
  hasGSAP: boolean;
  hasScrollTrigger: boolean;
}

export async function discoverAnimations(
  page: Page,
  crossOriginCss: CrossOriginStylesheet[] = [],
  options: { maxTransitionNodes?: number } = {},
): Promise<AnimationDiscovery> {
  const maxTransitionNodes = options.maxTransitionNodes ?? 500;

  const script = buildSameOriginScript(maxTransitionNodes);
  const sameOrigin = ((await page.evaluate(script).catch(() => null)) ?? null) as SameOriginResult | null;

  const safeSameOrigin: SameOriginResult = sameOrigin ?? {
    localKeyframes: [],
    transitions: [],
    hasGSAP: false,
    hasScrollTrigger: false,
  };

  const crossOriginKeyframes: KeyframeDefinition[] = [];
  for (const sheet of crossOriginCss) {
    try {
      const re = /@(?<type>keyframes|[-a-z]+keyframes)\s+(?<name>[\w-]+)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sheet.body)) !== null) {
        const name = m.groups?.name;
        const type = m.groups?.type;
        if (!name || !type) continue;
        if (!type.endsWith('keyframes')) continue;
        if (sameOrigin?.localKeyframes.some((k) => k.name === name)) continue;
        crossOriginKeyframes.push({
          name,
          source: sheet.url,
          cross_origin: true,
        });
      }
    } catch {
      // ignore malformed CSS body
    }
  }

  return {
    keyframes: [
      ...safeSameOrigin.localKeyframes.map((k) => ({
        name: k.name,
        source: k.source,
        cross_origin: false,
      })),
      ...crossOriginKeyframes,
    ],
    same_origin_count: safeSameOrigin.localKeyframes.length,
    cross_origin_count: crossOriginKeyframes.length,
    transitions: safeSameOrigin.transitions,
    gsap: {
      hasGSAP: safeSameOrigin.hasGSAP,
      hasScrollTrigger: safeSameOrigin.hasScrollTrigger,
    },
  };
}

export function buildCssBodyCollector(): {
  list: () => CrossOriginStylesheet[];
  handler: (route: import('playwright').Route) => Promise<void>;
} {
  const collected: CrossOriginStylesheet[] = [];
  const handler = async (route: import('playwright').Route) => {
    const req = route.request();
    const res = await route.fetch();
    const ct = (res.headers()['content-type'] ?? '').toLowerCase();
    if (ct.includes('text/css')) {
      try {
        const body = await res.text();
        collected.push({ url: req.url(), body });
      } catch {
        // ignore body read errors
      }
    }
    await route.fulfill({ response: res });
  };
  return { list: () => [...collected], handler };
}
