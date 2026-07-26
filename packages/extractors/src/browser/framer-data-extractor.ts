/**
 * framer-data-extractor.ts — Modul A1 (UMBAUPLAN.md §6), revised.
 *
 * UMBAUPLAN.md assumed Framer sites expose `<script id="__NEXT_DATA__">`
 * (Next.js) and/or `window.__FRAMER__`/`window.__FRAMER_DATA__`. Verified
 * against two live Framer-hosted sites (2026-07-05, via Firecrawl) before
 * writing this: neither exists on real Framer output. What's actually
 * there:
 *   - `data-framer-name` / `data-framer-component` DOM attributes — the
 *     real, always-present primary signal (461 / 267 occurrences on the
 *     test page), not a "weakest signal" fallback as the plan assumed.
 *   - `<script type="framer/appear" id="__framer__breakpoints">` — clean,
 *     directly JSON.parse-able array of `{hash, mediaQuery}`.
 *   - `<script type="framer/handover" id="__framer__handoverData">` —
 *     present, but its serialization is a proprietary non-JSON format
 *     (references like `["Map", 2, 3, ...]`). Preserved as a raw string
 *     for debugging only; not parsed here.
 *   - `framerusercontent.com` images appear as plain `<img src>` — already
 *     picked up by the existing generic `collectAssets()`, so this module
 *     doesn't duplicate that; it only flags the site's own JS bundle
 *     (`script[data-framer-bundle]`).
 *
 * This intentionally does NOT include a `styleMap`/`pages` field from the
 * original plan — there is no observed source for those on real output;
 * adding speculative fields with no way to populate them would be worse
 * than omitting them.
 */

import type { Page } from 'playwright';

export interface FramerComponent {
  id: string;
  name: string;
  type: string;
  className?: string;
}

export interface FramerBreakpoint {
  hash: string;
  mediaQuery: string;
}

export interface FramerAsset {
  url: string;
  type: 'script';
}

export interface FramerProjectData {
  source: 'dom-attributes' | 'breakpoints-script' | 'none';
  detected: boolean;
  components?: FramerComponent[];
  breakpoints?: FramerBreakpoint[];
  assets?: FramerAsset[];
  /** Raw `framer/handover` script content, if present — see module docstring. */
  rawHandoverData?: string;
}

export async function extractFramerData(page: Page): Promise<FramerProjectData> {
  const { components } = await extractFromDomAttributes(page);
  const { breakpoints, assets, rawHandoverData } = await extractFramerScripts(page);

  const detected = components.length > 0 || breakpoints.length > 0 || rawHandoverData != null;
  if (!detected) {
    return { source: 'none', detected: false };
  }

  return {
    source: components.length > 0 ? 'dom-attributes' : 'breakpoints-script',
    detected: true,
    components: components.length > 0 ? components : undefined,
    breakpoints: breakpoints.length > 0 ? breakpoints : undefined,
    assets: assets.length > 0 ? assets : undefined,
    rawHandoverData,
  };
}

async function extractFromDomAttributes(page: Page): Promise<{ components: FramerComponent[] }> {
  return page.evaluate(() => {
    const components: Array<{ id: string; name: string; type: string; className?: string }> = [];
    document.querySelectorAll('[data-framer-name], [data-framer-component]').forEach((el, i) => {
      const name = el.getAttribute('data-framer-name');
      const type = el.getAttribute('data-framer-component');
      if (!name && !type) return;
      components.push({
        id: el.id || `framer-el-${i}`,
        name: name || '',
        type: type || el.tagName.toLowerCase(),
        className: el.className || undefined,
      });
    });
    return { components };
  });
}

async function extractFramerScripts(page: Page): Promise<{
  breakpoints: FramerBreakpoint[];
  assets: FramerAsset[];
  rawHandoverData?: string;
}> {
  return page.evaluate(() => {
    const readScriptText = (id: string): string | null => document.getElementById(id)?.textContent ?? null;

    let breakpoints: Array<{ hash: string; mediaQuery: string }> = [];
    const breakpointsRaw = readScriptText('__framer__breakpoints');
    if (breakpointsRaw) {
      try {
        const parsed = JSON.parse(breakpointsRaw);
        if (Array.isArray(parsed)) breakpoints = parsed;
      } catch {
        // Malformed/unexpected script content — leave breakpoints empty rather than throw.
      }
    }

    const rawHandoverData = readScriptText('__framer__handoverData') ?? undefined;

    const assets: Array<{ url: string; type: 'script' }> = [];
    document.querySelectorAll('script[data-framer-bundle]').forEach((el) => {
      const src = el.getAttribute('src');
      if (src) assets.push({ url: src, type: 'script' });
    });

    return { breakpoints, assets, rawHandoverData };
  });
}
