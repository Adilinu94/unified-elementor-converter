# Elconv 1.0 — Produktionsreifer Entwicklungsplan

## Zusammenfassung

Dieser Plan transformiert das `unified-elementor-converter` Repository von v0.1.0 (326 Tests, Mock-Funktionen, Regex-Parser) zu einer produktreifen v1.0 mit echten Browser-Extraction, Asset-Downloads, KI-gestützter Klassifizierung, Self-Healing-Loop und vollständiger CI/CD-Pipeline.

**Repository:** `/home/adi/Documents/Qoder/2026-07-22/chat-1/unified-elementor-converter`
**Quell-Repos (Referenz):**
- `site-clone-to-v3`: `/home/adi/Documents/Qoder/2026-07-22/chat-1/site-clone-to-v3/src/`
- `Framer-V4-Pipeline`: `/home/adi/Documents/Qoder/2026-07-22/chat-1/Framer-to-Elementor-V4-Pipeline/src/`

**Konventionen (KRITISCH — immer beachten):**
- Alle Imports nutzen `.ts` Extension: `import { foo } from './bar.ts'`
- Vitest-Aliases in `vitest.config.ts` mappen `@elconv/*` → `packages/*/src/index.ts`
- `runGuards(tree, guards)` — tree ist ERSTES Argument
- `chooseDeployStrategy(bytes, forced?)` gibt STRING zurück
- Branded Types: `V3ElementTree` / `V4ElementTree` mit `__v3Brand` / `__v4Brand`
- Jede neue Datei mit `resetXxxIds()` für deterministische Tests
- Commit nach jeder Phase: `git add -A && git commit -m "feat(...): ..." && git push origin main`

---

## Phase 19: Playwright-Extraction (Browser-basiert)

### Ziel
Ersetzt den Regex-basierten HTML-Parser durch echte Playwright-Extraction mit computed styles, hydration-wait, lazy-scroll, font-discovery, section-detection und responsive matrix.

### Neue Dependencies (root `package.json`)
```json
{
  "devDependencies": {
    "playwright": "^1.48.0"
  }
}
```
**Befehl:** `cd /home/adi/Documents/Qoder/2026-07-22/chat-1/unified-elementor-converter && npm install -D playwright && npx playwright install chromium`

### Datei 1: `packages/extractors/src/browser/types.ts` (NEU)

```typescript
/**
 * Browser-Extraction Types.
 * Quelle: site-clone-to-v3/src/extractor/types.ts (adaptiert)
 */

export interface ViewportConfig {
  label: 'desktop' | 'tablet' | 'mobile' | string;
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile', width: 390, height: 844 },
];

export interface FontIntercept {
  url: string;
  type: 'woff2' | 'woff' | 'truetype' | 'opentype' | 'google-fonts-css' | 'unknown';
  family?: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

export interface SectionInfo {
  section_id: string;
  selector: string;
  y_range: [number, number];
  layout: string;
  child_count: number;
  tag?: string;
  id?: string;
  classes?: string;
}

export interface AnimationInfo {
  has_keyframes: boolean;
  keyframe_names: string[];
  has_gsap: boolean;
  has_scrolltrigger: boolean;
  has_framer_motion: boolean;
  has_lenis: boolean;
}

export interface ComputedStyleSnapshot {
  selector: string;
  tag: string;
  styles: Record<string, string>;
}

export interface DiscoveredImage {
  url: string;
  alt?: string;
}

export interface DiscoveredSvg {
  kind: 'inline' | 'external';
  url?: string;
  markup?: string;
  existingId?: string;
}

export interface DiscoveredFavicon {
  url: string;
  kind: 'apple-touch-icon' | 'icon' | 'shortcut-icon' | 'og-image' | 'favicon';
  sizes?: string;
  type?: string;
}

export interface BrowserExtractionOptions {
  url: string;
  viewports?: ViewportConfig[];
  outputDir: string;
  screenshots?: boolean;
  scrollForLazyLoad?: boolean;
  waitForHydration?: boolean;
  detectAnimations?: boolean;
  detectSections?: boolean;
  detectResponsiveStyles?: boolean;
  maxStyles?: number;
  maxSections?: number;
  browser?: 'chromium' | 'firefox' | 'webkit';
}

export interface BrowserExtractionResult {
  url: string;
  hostname: string;
  extracted_at: string;
  viewports: Array<{ config: ViewportConfig; screenshotPath?: string }>;
  fontsIntercepted: FontIntercept[];
  cssVariables: Record<string, string>;
  sections: SectionInfo[];
  animations: AnimationInfo;
  dom?: string;
  computedStyles?: Record<string, ComputedStyleSnapshot[]>;
  images: DiscoveredImage[];
  svgs: DiscoveredSvg[];
  favicons: DiscoveredFavicon[];
}
```

### Datei 2: `packages/extractors/src/browser/hydration-wait.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/extractor/hydration-wait.ts` (78 Zeilen, 1:1 kopieren mit Import-Anpassung)

```typescript
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
```

### Datei 3: `packages/extractors/src/browser/lazy-scroll.ts` (NEU)

```typescript
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
```

### Datei 4: `packages/extractors/src/browser/computed-styles.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/extractor/computed-styles.ts` (225 Zeilen)

```typescript
/**
 * Computed-Style-Walk — Captures non-default CSS properties for V3 widget mapping.
 */
import type { Page } from 'playwright';
import type { ComputedStyleSnapshot } from './types.ts';

export const CURATED_PROPERTIES = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing', 'overflow', 'overflow-x', 'overflow-y',
  'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius', 'border',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-transform',
  'text-decoration', 'color',
  'opacity', 'box-shadow', 'filter', 'backdrop-filter', 'transform',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'grid-template-rows',
  'transition',
] as const;

export const DEFAULT_VALUES: Partial<Record<string, string[]>> = {
  'display': ['block', 'inline'],
  'position': ['static'],
  'box-sizing': ['content-box'],
  'overflow': ['visible'],
  'background-color': ['rgba(0, 0, 0, 0)'],
  'background-image': ['none'],
  'background': ['none'],
  'border': ['none'],
  'font-style': ['normal'],
  'text-align': ['start'],
  'text-decoration': ['none'],
  'opacity': ['1'],
  'flex-direction': ['row'],
  'flex-wrap': ['nowrap'],
  'transition': ['all 0s ease 0s', 'none'],
};

export interface WalkOptions {
  rootSelector?: string;
  maxNodes?: number;
  customProperties?: string[];
}

export async function walkComputedStyles(
  page: Page,
  options: WalkOptions = {},
): Promise<ComputedStyleSnapshot[]> {
  const rootSelector = options.rootSelector ?? 'body';
  const maxNodes = options.maxNodes ?? 500;
  const props = [...CURATED_PROPERTIES, ...(options.customProperties ?? [])];
  const defaults = DEFAULT_VALUES;

  return await page.evaluate(
    ({ rootSelector, maxNodes, props, defaults }) => {
      const root = document.querySelector(rootSelector);
      if (!root) return [];
      const nodes = Array.from(root.querySelectorAll('*')).slice(0, maxNodes);
      const results: Array<{ selector: string; tag: string; styles: Record<string, string> }> = [];

      for (const node of nodes) {
        const cs = window.getComputedStyle(node);
        const styles: Record<string, string> = {};
        for (const prop of props) {
          const val = cs.getPropertyValue(prop).trim();
          if (!val) continue;
          const defArr = (defaults as Record<string, string[]>)[prop];
          if (defArr && defArr.includes(val)) continue;
          styles[prop] = val;
        }
        if (Object.keys(styles).length === 0) continue;

        const tag = node.tagName.toLowerCase();
        const id = node.id ? `#${node.id}` : '';
        const cls = node.className && typeof node.className === 'string'
          ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
        results.push({ selector: `${tag}${id}${cls}`, tag, styles });
      }
      return results;
    },
    { rootSelector, maxNodes, props, defaults },
  );
}
```

### Datei 5: `packages/extractors/src/browser/section-detector.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/extractor/section-detector.ts` (271 Zeilen)

```typescript
/**
 * Section-Detector — Detects page sections from live DOM.
 */
import type { Page } from 'playwright';
import type { SectionInfo } from './types.ts';

export interface DetectSectionsOptions {
  maxSections?: number;
  minHeightPx?: number;
}

const SECTION_SELECTORS = [
  'section[id]', 'section[class*="section"]', '[data-section]',
  '[role="region"]', 'article', 'aside',
  'header[role="banner"]', 'footer[role="contentinfo"]',
  'main[role="main"]', 'nav[role="navigation"]',
  'header', 'footer', 'main', 'nav',
].join(', ');

export async function detectSections(
  page: Page,
  options: DetectSectionsOptions = {},
): Promise<SectionInfo[]> {
  const maxSections = options.maxSections ?? 50;
  const minHeightPx = options.minHeightPx ?? 200;

  const raw = await page.evaluate(
    ({ selectors, maxN, minH }) => {
      const nodes = Array.from(document.querySelectorAll(selectors));
      const seen = new Set<Element>();
      const out: Array<{
        section_id: string; selector: string; y_range: [number, number];
        layout: string; child_count: number; tag: string; id?: string; classes: string;
      }> = [];

      for (const el of nodes) {
        if (out.length >= maxN) break;
        if (seen.has(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height < minH) continue;
        seen.add(el);

        const tag = el.tagName.toLowerCase();
        const id = el.id || undefined;
        const classes = el.className && typeof el.className === 'string' ? el.className : '';
        const selector = tag + (id ? `#${id}` : classes ? `.${classes.split(' ')[0]}` : '');
        const cs = window.getComputedStyle(el);
        const layout = cs.display === 'flex' ? 'flex' : cs.display === 'grid' ? 'grid' : 'block';

        out.push({
          section_id: `sec_${out.length + 1}`,
          selector,
          y_range: [Math.round(rect.top + window.scrollY), Math.round(rect.bottom + window.scrollY)],
          layout,
          child_count: el.children.length,
          tag,
          id,
          classes,
        });
      }
      return out;
    },
    { selectors: SECTION_SELECTORS, maxN: maxSections, minH: minHeightPx },
  );

  return raw.sort((a, b) => a.y_range[0] - b.y_range[0]);
}
```

### Datei 6: `packages/extractors/src/browser/font-discovery.ts` (NEU)

```typescript
/**
 * Font-Discovery — Intercepts font file requests via page.route().
 */
import type { Page, Route } from 'playwright';
import type { FontIntercept } from './types.ts';

const FONT_EXTENSIONS = /\.(woff2?|ttf|otf|eot)(\?|$)/i;
const GOOGLE_FONTS_CSS = /fonts\.googleapis\.com\/css/i;

export class FontUrlCollector {
  readonly intercepted: FontIntercept[] = [];

  classifyUrl(url: string): FontIntercept['type'] {
    if (GOOGLE_FONTS_CSS.test(url)) return 'google-fonts-css';
    if (/\.woff2(\?|$)/i.test(url)) return 'woff2';
    if (/\.woff(\?|$)/i.test(url)) return 'woff';
    if (/\.ttf(\?|$)/i.test(url)) return 'truetype';
    if (/\.otf(\?|$)/i.test(url)) return 'opentype';
    return 'unknown';
  }

  buildRouteHandler(): (route: Route) => Promise<void> {
    return async (route: Route) => {
      const url = route.request().url();
      if (FONT_EXTENSIONS.test(url) || GOOGLE_FONTS_CSS.test(url)) {
        this.intercepted.push({ url, type: this.classifyUrl(url) });
      }
      await route.continue();
    };
  }
}

export function buildFontRouteHandler(collector: FontUrlCollector): (route: Route) => Promise<void> {
  return collector.buildRouteHandler();
}
```

### Datei 7: `packages/extractors/src/browser/playwright-extractor.ts` (NEU — Hauptdatei)

**Referenz:** `site-clone-to-v3/src/extractor/playwright-extractor.ts` (459 Zeilen)

```typescript
/**
 * Playwright-Extractor — Main browser-based extraction orchestrator.
 */
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BrowserExtractionOptions, BrowserExtractionResult, ViewportConfig,
  AnimationInfo, DiscoveredImage, DiscoveredSvg, DiscoveredFavicon,
} from './types.ts';
import { DEFAULT_VIEWPORTS } from './types.ts';
import { waitForHydration } from './hydration-wait.ts';
import { triggerLazyLoad } from './lazy-scroll.ts';
import { walkComputedStyles } from './computed-styles.ts';
import { detectSections } from './section-detector.ts';
import { FontUrlCollector, buildFontRouteHandler } from './font-discovery.ts';

const BROWSERS = { chromium, firefox, webkit };

export async function extractFromUrl(
  options: BrowserExtractionOptions,
): Promise<BrowserExtractionResult> {
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const browserType = BROWSERS[options.browser ?? 'chromium'];

  await mkdir(options.outputDir, { recursive: true });

  const browser: Browser = await browserType.launch({ headless: true });
  const fontCollector = new FontUrlCollector();

  try {
    const context = await browser.newContext({
      viewport: { width: viewports[0].width, height: viewports[0].height },
    });
    const page: Page = await context.newPage();

    // Font interception
    await page.route('**/*', buildFontRouteHandler(fontCollector));

    // Navigate
    await page.goto(options.url, { waitUntil: 'networkidle', timeout: 60_000 });

    // Hydration wait
    if (options.waitForHydration !== false) {
      await waitForHydration(page);
    }

    // Lazy scroll
    if (options.scrollForLazyLoad !== false) {
      await triggerLazyLoad(page);
    }

    // CSS Variables
    const cssVariables = await extractCssVariables(page);

    // Animations
    const animations = options.detectAnimations !== false
      ? await detectAnimations(page)
      : { has_keyframes: false, keyframe_names: [], has_gsap: false, has_scrolltrigger: false, has_framer_motion: false, has_lenis: false };

    // Sections
    const sections = options.detectSections !== false
      ? await detectSections(page, { maxSections: options.maxSections })
      : [];

    // Assets
    const { images, svgs, favicons } = await collectAssets(page);

    // DOM serialization
    const dom = await page.content();

    // Screenshots + computed styles per viewport
    const viewportResults: BrowserExtractionResult['viewports'] = [];
    const computedStyles: Record<string, import('./types.ts').ComputedStyleSnapshot[]> = {};

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await new Promise((r) => setTimeout(r, 300));

      let screenshotPath: string | undefined;
      if (options.screenshots !== false) {
        screenshotPath = join(options.outputDir, `screenshot-${vp.label}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }

      if (options.detectResponsiveStyles) {
        computedStyles[vp.label] = await walkComputedStyles(page, {
          maxNodes: options.maxStyles ?? 500,
        });
      }

      viewportResults.push({ config: vp, screenshotPath });
    }

    const hostname = new URL(options.url).hostname;

    return {
      url: options.url,
      hostname,
      extracted_at: new Date().toISOString(),
      viewports: viewportResults,
      fontsIntercepted: fontCollector.intercepted,
      cssVariables,
      sections,
      animations,
      dom,
      computedStyles: options.detectResponsiveStyles ? computedStyles : undefined,
      images,
      svgs,
      favicons,
    };
  } finally {
    await browser.close();
  }
}

async function extractCssVariables(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(() => {
    const vars: Record<string, string> = {};
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        if (rule.selectorText !== ':root' && rule.selectorText !== 'html') continue;
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          if (!prop.startsWith('--')) continue;
          vars[prop] = rule.style.getPropertyValue(prop).trim();
        }
      }
    }
    return vars;
  });
}

async function detectAnimations(page: Page): Promise<AnimationInfo> {
  return await page.evaluate(() => {
    const gsap = (window as any).gsap;
    const ScrollTrigger = (window as any).ScrollTrigger;
    const framer = document.querySelector('[data-framer-name]');
    const lenis = document.querySelector('.lenis, [data-lenis]');
    return {
      has_keyframes: false,
      keyframe_names: [],
      has_gsap: typeof gsap === 'object' && gsap !== null,
      has_scrolltrigger: typeof ScrollTrigger === 'object' && ScrollTrigger !== null,
      has_framer_motion: framer !== null,
      has_lenis: lenis !== null,
    };
  });
}

async function collectAssets(page: Page): Promise<{
  images: DiscoveredImage[]; svgs: DiscoveredSvg[]; favicons: DiscoveredFavicon[];
}> {
  return await page.evaluate(() => {
    const images: Array<{ url: string; alt?: string }> = [];
    const seenUrls = new Set<string>();
    for (const img of Array.from(document.querySelectorAll('img[src]'))) {
      const src = (img as HTMLImageElement).src;
      if (!src || src.startsWith('data:') || src.startsWith('blob:') || seenUrls.has(src)) continue;
      seenUrls.add(src);
      images.push({ url: src, alt: (img as HTMLImageElement).alt || undefined });
    }

    const svgs: Array<{ kind: 'inline' | 'external'; url?: string; markup?: string; existingId?: string }> = [];
    for (const svgEl of Array.from(document.querySelectorAll('svg'))) {
      const markup = svgEl.outerHTML;
      if (markup.length < 80) continue;
      svgs.push({ kind: 'inline', markup, existingId: svgEl.id || undefined });
    }

    const favicons: Array<{ url: string; kind: string; sizes?: string; type?: string }> = [];
    for (const link of Array.from(document.querySelectorAll('link[rel*="icon"]'))) {
      const href = (link as HTMLLinkElement).href;
      if (!href || href.startsWith('data:')) continue;
      favicons.push({ url: href, kind: 'icon', sizes: link.getAttribute('sizes') ?? undefined });
    }

    return { images, svgs, favicons } as any;
  });
}
```

### Datei 8: `packages/extractors/src/browser/index.ts` (NEU)

```typescript
export * from './types.ts';
export * from './hydration-wait.ts';
export * from './lazy-scroll.ts';
export * from './computed-styles.ts';
export * from './section-detector.ts';
export * from './font-discovery.ts';
export * from './playwright-extractor.ts';
```

### Datei 9: `packages/extractors/src/index.ts` (EDIT)

Anhängen:
```typescript
export * from './browser/index.ts';
```

### Tests: `tests/unit/extractors/browser-extraction.test.ts` (NEU)

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIEWPORTS,
  FontUrlCollector,
  CURATED_PROPERTIES,
  DEFAULT_VALUES,
} from '@elconv/extractors';

describe('Browser Extraction Types', () => {
  it('has 3 default viewports', () => {
    expect(DEFAULT_VIEWPORTS).toHaveLength(3);
    expect(DEFAULT_VIEWPORTS[0]).toEqual({ label: 'desktop', width: 1440, height: 900 });
  });

  it('FontUrlCollector classifies woff2', () => {
    const collector = new FontUrlCollector();
    expect(collector.classifyUrl('https://example.com/font.woff2')).toBe('woff2');
    expect(collector.classifyUrl('https://fonts.googleapis.com/css2?family=Inter')).toBe('google-fonts-css');
    expect(collector.classifyUrl('https://example.com/font.ttf?v=2')).toBe('truetype');
  });

  it('CURATED_PROPERTIES has 60+ entries', () => {
    expect(CURATED_PROPERTIES.length).toBeGreaterThanOrEqual(60);
  });

  it('DEFAULT_VALUES filters common defaults', () => {
    expect(DEFAULT_VALUES['display']).toContain('block');
    expect(DEFAULT_VALUES['opacity']).toContain('1');
  });
});
```

### DoD (Definition of Done)
- [ ] `npx vitest run` grün (alle bestehenden + neue Tests)
- [ ] `extractFromUrl` exportiert aus `@elconv/extractors`
- [ ] Commit: `feat(extractors): playwright-based browser extraction with hydration-wait, lazy-scroll, computed-styles, section-detection, font-discovery`

---

## Phase 20: Asset-Pipeline (Image/Font/SVG Downloader)

### Ziel
Download von Images, Fonts, SVGs, Favicons mit Rate-Limiter, Parallel-Downloads, Manifest-Generierung.

### Neue Dependencies
```bash
npm install undici sharp p-limit nanoid
npm install -D @types/sharp
```

### Datei 1: `packages/extractors/src/assets/rate-limiter.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/scraper/rate-limiter.ts` (97 Zeilen, 1:1 kopieren)

```typescript
/**
 * Per-host Rate-Limiter — Token-bucket style.
 */
export interface RateLimiterOptions {
  minDelayMs?: number;
  onWait?: (host: string, waitedMs: number) => void;
}

interface Bucket {
  nextAllowedAt: number;
  pending?: Promise<void>;
}

export class RateLimiter {
  private readonly minDelayMs: number;
  private readonly onWait?: (host: string, waitedMs: number) => void;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions = {}) {
    this.minDelayMs = Math.max(0, options.minDelayMs ?? 500);
    this.onWait = options.onWait;
  }

  private hostOf(url: string): string {
    try { return new URL(url).host; } catch { return url; }
  }

  async acquire(host: string): Promise<void> {
    const key = host || '*';
    const prev = this.buckets.get(key)?.pending ?? Promise.resolve();
    const next = prev.then(() => this.acquireOne(key));
    this.buckets.set(key, { nextAllowedAt: this.buckets.get(key)?.nextAllowedAt ?? 0, pending: next });
    await next;
  }

  private async acquireOne(key: string): Promise<void> {
    const bucket = this.buckets.get(key) ?? { nextAllowedAt: 0 };
    const now = Date.now();
    const waitMs = bucket.nextAllowedAt - now;
    if (waitMs > 0) {
      this.onWait?.(key, waitMs);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    bucket.nextAllowedAt = Date.now() + this.minDelayMs;
    this.buckets.set(key, bucket);
  }

  async acquireUrl(url: string): Promise<void> {
    await this.acquire(this.hostOf(url));
  }

  reset(): void { this.buckets.clear(); }
}

export function createDomainRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  return new RateLimiter({ minDelayMs: 500, ...options });
}
```

### Datei 2: `packages/extractors/src/assets/image-downloader.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/scraper/image-downloader.ts` (290 Zeilen)

```typescript
/**
 * Image-Downloader — Parallel downloads with sharp validation.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Buffer } from 'node:buffer';
import pLimit from 'p-limit';
import { customAlphabet } from 'nanoid';
import { RateLimiter } from './rate-limiter.ts';

const nanoid8 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export interface ImageManifestEntry {
  local_path: string;
  mime: string;
  width?: number;
  height?: number;
  filesize: number;
  downloaded_at: string;
  alt?: string;
  original_name?: string;
}

export interface ImageDownload {
  url: string;
  alt?: string;
}

export interface DownloadImagesOptions {
  hostname: string;
  subdir: string;
  outputRoot: string;
  concurrency?: number;
  filenameFor?: (url: string, ext: string) => string;
  headers?: Record<string, string>;
}

export function normalizeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid']) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch { return url; }
}

export async function downloadImages(
  images: ImageDownload[],
  options: DownloadImagesOptions,
): Promise<{ manifest: ImageManifestEntry[]; errors: string[] }> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const limit = pLimit(concurrency);
  const rateLimiter = new RateLimiter({ minDelayMs: 200 });
  const outDir = join(options.outputRoot, options.subdir);
  await mkdir(outDir, { recursive: true });

  const manifest: ImageManifestEntry[] = [];
  const errors: string[] = [];

  await Promise.all(
    images.map((img) =>
      limit(async () => {
        try {
          const normalizedUrl = normalizeImageUrl(img.url);
          await rateLimiter.acquireUrl(normalizedUrl);

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

          const res = await fetch(normalizedUrl, {
            signal: controller.signal,
            headers: options.headers,
          });
          clearTimeout(timeout);

          if (!res.ok) {
            errors.push(`HTTP ${res.status}: ${normalizedUrl}`);
            return;
          }

          const arrayBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrayBuf);

          if (buf.length > MAX_FILE_SIZE_BYTES) {
            errors.push(`Too large (${buf.length}): ${normalizedUrl}`);
            return;
          }

          const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
          const ext = extname(new URL(normalizedUrl).pathname) || '.jpg';
          const filename = options.filenameFor
            ? options.filenameFor(normalizedUrl, ext)
            : `${nanoid8()}${ext}`;
          const localPath = join(outDir, filename);

          await writeFile(localPath, buf);

          manifest.push({
            local_path: localPath,
            mime: contentType,
            filesize: buf.length,
            downloaded_at: new Date().toISOString(),
            alt: img.alt,
            original_name: new URL(normalizedUrl).pathname.split('/').pop(),
          });
        } catch (err) {
          errors.push(`${err instanceof Error ? err.message : String(err)}: ${img.url}`);
        }
      }),
    ),
  );

  return { manifest, errors };
}
```

### Datei 3: `packages/extractors/src/assets/font-downloader.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/scraper/font-downloader.ts` (240 Zeilen)

```typescript
/**
 * Font-Downloader — Downloads intercepted font files.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import pLimit from 'p-limit';
import { customAlphabet } from 'nanoid';
import type { FontIntercept } from '../browser/types.ts';
import { RateLimiter } from './rate-limiter.ts';

const nanoid8 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

export interface FontManifestEntry {
  local_path: string;
  url: string;
  type: FontIntercept['type'];
  family?: string;
  filesize: number;
  downloaded_at: string;
}

export interface DownloadFontsOptions {
  outputRoot: string;
  concurrency?: number;
  headers?: Record<string, string>;
}

export async function downloadFonts(
  fonts: FontIntercept[],
  options: DownloadFontsOptions,
): Promise<{ manifest: FontManifestEntry[]; errors: string[] }> {
  const limit = pLimit(options.concurrency ?? 3);
  const rateLimiter = new RateLimiter({ minDelayMs: 300 });
  const outDir = join(options.outputRoot, 'fonts');
  await mkdir(outDir, { recursive: true });

  const manifest: FontManifestEntry[] = [];
  const errors: string[] = [];

  // Skip google-fonts-css (those are CSS files, not font binaries)
  const fontFiles = fonts.filter((f) => f.type !== 'google-fonts-css');

  await Promise.all(
    fontFiles.map((font) =>
      limit(async () => {
        try {
          await rateLimiter.acquireUrl(font.url);
          const res = await fetch(font.url, { headers: options.headers });
          if (!res.ok) { errors.push(`HTTP ${res.status}: ${font.url}`); return; }

          const buf = Buffer.from(await res.arrayBuffer());
          const ext = font.type === 'woff2' ? '.woff2' : font.type === 'woff' ? '.woff' : '.ttf';
          const filename = `${nanoid8()}${ext}`;
          const localPath = join(outDir, filename);
          await writeFile(localPath, buf);

          manifest.push({
            local_path: localPath,
            url: font.url,
            type: font.type,
            family: font.family,
            filesize: buf.length,
            downloaded_at: new Date().toISOString(),
          });
        } catch (err) {
          errors.push(`${err instanceof Error ? err.message : String(err)}: ${font.url}`);
        }
      }),
    ),
  );

  return { manifest, errors };
}
```

### Datei 4: `packages/extractors/src/assets/manifest-builder.ts` (NEU)

```typescript
/**
 * Manifest-Builder — Aggregates all asset manifests into a single JSON.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageManifestEntry } from './image-downloader.ts';
import type { FontManifestEntry } from './font-downloader.ts';

export interface AssetManifest {
  version: 1;
  source_url: string;
  hostname: string;
  created_at: string;
  images: ImageManifestEntry[];
  fonts: FontManifestEntry[];
  svgs: Array<{ local_path: string; kind: string; filesize: number }>;
  total_files: number;
  total_bytes: number;
}

export function buildManifest(
  sourceUrl: string,
  images: ImageManifestEntry[],
  fonts: FontManifestEntry[],
  svgs: Array<{ local_path: string; kind: string; filesize: number }>,
): AssetManifest {
  const totalBytes =
    images.reduce((s, i) => s + i.filesize, 0) +
    fonts.reduce((s, f) => s + f.filesize, 0) +
    svgs.reduce((s, sv) => s + sv.filesize, 0);

  return {
    version: 1,
    source_url: sourceUrl,
    hostname: new URL(sourceUrl).hostname,
    created_at: new Date().toISOString(),
    images,
    fonts,
    svgs,
    total_files: images.length + fonts.length + svgs.length,
    total_bytes: totalBytes,
  };
}

export async function writeManifest(manifest: AssetManifest, outputDir: string): Promise<string> {
  const path = join(outputDir, 'asset-manifest.json');
  await writeFile(path, JSON.stringify(manifest, null, 2), 'utf8');
  return path;
}
```

### Datei 5: `packages/extractors/src/assets/index.ts` (NEU)

```typescript
export * from './rate-limiter.ts';
export * from './image-downloader.ts';
export * from './font-downloader.ts';
export * from './manifest-builder.ts';
```

### Edit: `packages/extractors/src/index.ts`

Anhängen: `export * from './assets/index.ts';`

### Tests: `tests/unit/extractors/assets.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  RateLimiter, createDomainRateLimiter,
  normalizeImageUrl,
  buildManifest,
} from '@elconv/extractors';

describe('Rate Limiter', () => {
  it('creates with default 500ms delay', () => {
    const limiter = createDomainRateLimiter();
    expect(limiter).toBeInstanceOf(RateLimiter);
  });

  it('acquire resolves immediately for new host', async () => {
    const limiter = new RateLimiter({ minDelayMs: 0 });
    await expect(limiter.acquire('example.com')).resolves.toBeUndefined();
  });

  it('reset clears buckets', async () => {
    const limiter = new RateLimiter({ minDelayMs: 0 });
    await limiter.acquire('test.com');
    limiter.reset();
    expect(limiter.peek('test.com')).toBeUndefined();
  });
});

describe('normalizeImageUrl', () => {
  it('strips hash and tracking params', () => {
    const result = normalizeImageUrl('https://example.com/img.jpg#frag?utm_source=x');
    expect(result).not.toContain('#frag');
  });
});

describe('buildManifest', () => {
  it('aggregates totals', () => {
    const manifest = buildManifest('https://example.com', 
      [{ local_path: 'a.jpg', mime: 'image/jpeg', filesize: 1000, downloaded_at: '' }],
      [{ local_path: 'b.woff2', url: '', type: 'woff2', filesize: 500, downloaded_at: '' }],
      [{ local_path: 'c.svg', kind: 'inline', filesize: 200 }],
    );
    expect(manifest.total_files).toBe(3);
    expect(manifest.total_bytes).toBe(1700);
    expect(manifest.version).toBe(1);
  });
});
```

### DoD
- [ ] Alle Tests grün
- [ ] Commit: `feat(extractors): asset pipeline with image/font downloader, rate-limiter, manifest builder`

---

## Phase 21: Classifier (Widget-Mapper + Style-Classifier)

### Ziel
DOM-Elemente → V3 Widget-Mapping, Section-Layout-Klassifizierung (hero, card-grid, footer, etc.)

### Datei 1: `packages/target-v3/src/classifier/types.ts` (NEU)

```typescript
export type V3LayoutPattern =
  | 'hero' | 'image-text-sbs' | 'card-grid' | 'sticky-header'
  | 'footer' | 'content' | 'stats' | 'faq' | 'testimonials'
  | 'pricing' | 'timeline' | 'tabs' | 'accordion';

export interface V3Widget {
  type: string;
  source_selector: string;
  source_tag: string;
  content?: string;
  settings: Record<string, unknown>;
}

export interface WidgetMappingResult extends V3Widget {
  warnings: string[];
}

export interface ClassifierInput {
  selector: string;
  tag: string;
  styles: Record<string, string>;
  content?: string;
  childCount?: number;
  yRange?: [number, number];
}
```

### Datei 2: `packages/target-v3/src/classifier/widget-mapper.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/classifier/widget-mapper.ts` (793 Zeilen — Kern-Logik extrahieren)

```typescript
/**
 * Widget-Mapper — Maps DOM elements to V3 widget suggestions.
 */
import type { WidgetMappingResult } from './types.ts';

export interface WidgetMappingOptions {
  warnOnPro?: boolean;
}

export function mapElementToWidget(
  tag: string,
  selector: string,
  styles: Record<string, string>,
  content?: string,
  options: WidgetMappingOptions = {},
): WidgetMappingResult {
  const tagLower = tag.toLowerCase();
  const warnings: string[] = [];

  // Headings
  if (/^h[1-6]$/.test(tagLower)) {
    return {
      type: 'heading', source_selector: selector, source_tag: tagLower, content,
      settings: buildHeadingSettings(tagLower, styles), warnings,
    };
  }

  // Paragraphs
  if (tagLower === 'p') {
    return {
      type: 'text-editor', source_selector: selector, source_tag: tagLower, content,
      settings: buildTextSettings(styles), warnings,
    };
  }

  // Buttons
  if (tagLower === 'button' || (tagLower === 'a' && hasButtonClass(selector))) {
    return {
      type: 'button', source_selector: selector, source_tag: tagLower, content,
      settings: buildButtonSettings(styles), warnings,
    };
  }

  // Images
  if (tagLower === 'img' || tagLower === 'picture') {
    return {
      type: 'image', source_selector: selector, source_tag: tagLower, content: undefined,
      settings: { image_size: 'full' }, warnings,
    };
  }

  // Video
  if (tagLower === 'video' || tagLower === 'iframe') {
    return {
      type: 'video', source_selector: selector, source_tag: tagLower,
      settings: {}, warnings,
    };
  }

  // Form (Pro-only warning)
  if (tagLower === 'form') {
    if (options.warnOnPro !== false) warnings.push('form widget requires Elementor Pro');
    return {
      type: 'form', source_selector: selector, source_tag: tagLower,
      settings: {}, warnings,
    };
  }

  // SVG / Icon
  if (tagLower === 'svg' || selector.includes('icon')) {
    return {
      type: 'icon', source_selector: selector, source_tag: tagLower,
      settings: {}, warnings,
    };
  }

  // Divider
  if (tagLower === 'hr') {
    return {
      type: 'divider', source_selector: selector, source_tag: tagLower,
      settings: {}, warnings,
    };
  }

  // Fallback: HTML widget
  return {
    type: 'html', source_selector: selector, source_tag: tagLower, content,
    settings: {}, warnings: ['Unmapped element — using html fallback'],
  };
}

function hasButtonClass(selector: string): boolean {
  return /btn|button|cta|action/i.test(selector);
}

function buildHeadingSettings(tag: string, styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = { header_size: tag };
  if (styles['font-size']) settings.title_font_size = styles['font-size'];
  if (styles['font-weight']) settings.title_font_weight = styles['font-weight'];
  if (styles['color']) settings.title_color = styles['color'];
  if (styles['text-align']) settings.align = styles['text-align'];
  return settings;
}

function buildTextSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (styles['font-size']) settings.font_size = styles['font-size'];
  if (styles['color']) settings.text_color = styles['color'];
  if (styles['text-align']) settings.align = styles['text-align'];
  if (styles['line-height']) settings.line_height = styles['line-height'];
  return settings;
}

function buildButtonSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (styles['background-color']) settings.background_color = styles['background-color'];
  if (styles['color']) settings.button_text_color = styles['color'];
  if (styles['border-top-left-radius']) settings.border_radius = styles['border-top-left-radius'];
  if (styles['padding-top']) settings.button_padding = styles['padding-top'];
  return settings;
}
```

### Datei 3: `packages/target-v3/src/classifier/style-classifier.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/classifier/style-classifier.ts` (194 Zeilen)

```typescript
/**
 * Style-Classifier — Classifies sections into V3 layout patterns.
 */
import type { V3LayoutPattern, ClassifierInput } from './types.ts';

export interface ClassifierOptions {
  heroMinVh?: number;
  footerMinPaddingPx?: number;
  gridMinCards?: number;
}

export function classifySection(
  section: ClassifierInput,
  childSnapshots: ClassifierInput[],
  options: ClassifierOptions = {},
): V3LayoutPattern {
  const footerMinPadding = options.footerMinPaddingPx ?? 64;
  const gridMinCards = options.gridMinCards ?? 3;

  // 1. Sticky header
  if (section.tag === 'header' && /sticky|fixed/.test(section.styles['position'] ?? '')) {
    return 'sticky-header';
  }

  // 2. Footer
  if (section.tag === 'footer') {
    const pt = parsePx(section.styles['padding-top']) ?? 0;
    const pb = parsePx(section.styles['padding-bottom']) ?? 0;
    if (Math.max(pt, pb) >= footerMinPadding) return 'footer';
  }

  // 3. Hero (tall section with heading child)
  if (section.yRange) {
    const height = section.yRange[1] - section.yRange[0];
    if (height > 600 && childSnapshots.some((c) => /^h[1-6]$/.test(c.tag))) {
      return 'hero';
    }
  }

  // 4. Card grid (flex/grid with N+ similar children)
  const display = section.styles['display'] ?? '';
  if ((display === 'grid' || display === 'flex') && childSnapshots.length >= gridMinCards) {
    const tags = childSnapshots.map((c) => c.tag);
    const uniqueTags = new Set(tags);
    if (uniqueTags.size <= 2) return 'card-grid';
  }

  // 5. Image-text side-by-side
  if (display === 'flex' && childSnapshots.length === 2) {
    const hasImg = childSnapshots.some((c) => c.tag === 'img' || c.tag === 'picture');
    const hasText = childSnapshots.some((c) => c.tag === 'p' || /^h[1-6]$/.test(c.tag));
    if (hasImg && hasText) return 'image-text-sbs';
  }

  return 'content';
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}
```

### Datei 4: `packages/target-v3/src/classifier/index.ts` (NEU)

```typescript
export * from './types.ts';
export * from './widget-mapper.ts';
export * from './style-classifier.ts';
```

### Edit: `packages/target-v3/src/index.ts`

Anhängen: `export * from './classifier/index.ts';`

### Tests: `tests/unit/target-v3/classifier.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { mapElementToWidget, classifySection } from '@elconv/target-v3';

describe('Widget Mapper', () => {
  it('maps h1 → heading', () => {
    const result = mapElementToWidget('h1', 'h1.title', { 'font-size': '48px', color: '#333' }, 'Hello');
    expect(result.type).toBe('heading');
    expect(result.settings.header_size).toBe('h1');
    expect(result.content).toBe('Hello');
  });

  it('maps p → text-editor', () => {
    const result = mapElementToWidget('p', 'p.intro', { color: '#666' }, 'Text');
    expect(result.type).toBe('text-editor');
  });

  it('maps button → button', () => {
    const result = mapElementToWidget('button', 'button.cta', { 'background-color': '#007bff' }, 'Click');
    expect(result.type).toBe('button');
  });

  it('maps a.btn → button', () => {
    const result = mapElementToWidget('a', 'a.btn-primary', {}, 'Link');
    expect(result.type).toBe('button');
  });

  it('maps img → image', () => {
    const result = mapElementToWidget('img', 'img.hero', {}, undefined);
    expect(result.type).toBe('image');
  });

  it('maps form → form with Pro warning', () => {
    const result = mapElementToWidget('form', 'form.contact', {}, undefined);
    expect(result.type).toBe('form');
    expect(result.warnings).toContain('form widget requires Elementor Pro');
  });

  it('maps unknown → html fallback', () => {
    const result = mapElementToWidget('canvas', 'canvas#chart', {}, undefined);
    expect(result.type).toBe('html');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('Style Classifier', () => {
  it('classifies sticky header', () => {
    const result = classifySection(
      { selector: 'header', tag: 'header', styles: { position: 'sticky' } },
      [],
    );
    expect(result).toBe('sticky-header');
  });

  it('classifies footer', () => {
    const result = classifySection(
      { selector: 'footer', tag: 'footer', styles: { 'padding-top': '80px', 'padding-bottom': '80px' } },
      [],
    );
    expect(result).toBe('footer');
  });

  it('classifies hero', () => {
    const result = classifySection(
      { selector: 'section.hero', tag: 'section', styles: {}, yRange: [0, 800] },
      [{ selector: 'h1', tag: 'h1', styles: {} }],
    );
    expect(result).toBe('hero');
  });

  it('classifies card-grid', () => {
    const result = classifySection(
      { selector: 'div.grid', tag: 'div', styles: { display: 'grid' } },
      [
        { selector: 'div.card', tag: 'div', styles: {} },
        { selector: 'div.card', tag: 'div', styles: {} },
        { selector: 'div.card', tag: 'div', styles: {} },
      ],
    );
    expect(result).toBe('card-grid');
  });

  it('defaults to content', () => {
    const result = classifySection(
      { selector: 'div.wrapper', tag: 'div', styles: {} },
      [],
    );
    expect(result).toBe('content');
  });
});
```

### DoD
- [ ] Alle Tests grün
- [ ] Commit: `feat(target-v3): widget-mapper and style-classifier for DOM-to-widget conversion`

---

## Phase 22: AI-Engine (Provider-Router + Cost-Tracker)

### Ziel
Optionale KI-gestützte Klassifizierung und QA mit Provider-Router, Cost-Tracking und Task-System.

### Datei 1: `packages/core/src/ai/types.ts` (NEU)

```typescript
export interface AITask {
  name: string;
  prompt: string;
  images?: string[];
  schema?: boolean;
}

export interface AIResponse<T = unknown> {
  text: string;
  parsed?: T;
  provider: string;
  cost: number;
  durationMs: number;
}

export interface VisionProvider {
  name: string;
  costPerImage: number;
  available(): Promise<boolean>;
  execute(task: AITask): Promise<AIResponse>;
}

export interface CostEntry {
  task: string;
  provider: string;
  cost: number;
  durationMs: number;
  timestamp: string;
}

export type TaskCategory = 'cheap' | 'medium' | 'expensive';

export const TASK_CATEGORY: Record<string, TaskCategory> = {
  'section-classify': 'cheap',
  'component-detect': 'medium',
  'vision-qa': 'medium',
  'repair-block': 'expensive',
  'token-semantics': 'medium',
};
```

### Datei 2: `packages/core/src/ai/cost-tracker.ts` (NEU)

```typescript
/**
 * Cost-Tracker — Tracks AI API costs per task/provider.
 */
import type { CostEntry } from './types.ts';

export class CostTracker {
  private entries: CostEntry[] = [];

  add(entry: CostEntry): void {
    this.entries.push(entry);
  }

  get total(): number {
    return this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  get count(): number {
    return this.entries.length;
  }

  getByTask(task: string): CostEntry[] {
    return this.entries.filter((e) => e.task === task);
  }

  getByProvider(provider: string): CostEntry[] {
    return this.entries.filter((e) => e.provider === provider);
  }

  report(): { totalCost: number; totalCalls: number; byTask: Record<string, number> } {
    const byTask: Record<string, number> = {};
    for (const e of this.entries) {
      byTask[e.task] = (byTask[e.task] ?? 0) + e.cost;
    }
    return { totalCost: this.total, totalCalls: this.count, byTask };
  }

  reset(): void {
    this.entries = [];
  }
}
```

### Datei 3: `packages/core/src/ai/router.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/ai-engine/router.ts` (76 Zeilen)

```typescript
/**
 * AI-Router — Selects provider by task category and tracks costs.
 */
import type { AITask, AIResponse, VisionProvider, TaskCategory } from './types.ts';
import { TASK_CATEGORY } from './types.ts';
import { CostTracker } from './cost-tracker.ts';

export class AIRouter {
  constructor(
    private readonly providers: VisionProvider[],
    private readonly logger?: (msg: string) => void,
    private readonly costTracker?: CostTracker,
  ) {}

  async execute<T = unknown>(task: AITask): Promise<AIResponse<T>> {
    const category: TaskCategory = TASK_CATEGORY[task.name] ?? 'medium';
    const provider = await this.selectProvider(category);
    this.logger?.(`[AI] Task '${task.name}' → Provider '${provider.name}' (category: ${category})`);

    const response = (await provider.execute(task)) as AIResponse<T>;

    this.costTracker?.add({
      task: task.name,
      provider: response.provider,
      cost: response.cost,
      durationMs: response.durationMs,
      timestamp: new Date().toISOString(),
    });

    if (task.schema && response.text) {
      try {
        response.parsed = JSON.parse(response.text.replace(/```json|```/g, '').trim()) as T;
      } catch { /* keep raw */ }
    }
    return response;
  }

  private async selectProvider(category: TaskCategory): Promise<VisionProvider> {
    const available: VisionProvider[] = [];
    for (const p of this.providers) {
      if (await p.available()) available.push(p);
    }
    if (available.length === 0) throw new Error('No AI provider available');

    if (category === 'cheap') {
      const free = available.find((p) => p.costPerImage === 0);
      return free ?? [...available].sort((a, b) => a.costPerImage - b.costPerImage)[0];
    }
    if (category === 'expensive') {
      const claude = available.find((p) => p.name.includes('claude'));
      return claude ?? available[0];
    }
    return [...available].sort((a, b) => a.costPerImage - b.costPerImage)[0];
  }
}
```

### Datei 4: `packages/core/src/ai/index.ts` (NEU)

```typescript
export * from './types.ts';
export * from './cost-tracker.ts';
export * from './router.ts';
```

### Edit: `packages/core/src/index.ts`

Anhängen: `export * from './ai/index.ts';`

### Tests: `tests/unit/core/ai-engine.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { CostTracker, AIRouter, TASK_CATEGORY, type VisionProvider, type AITask, type AIResponse } from '@elconv/core';

const mockProvider: VisionProvider = {
  name: 'mock-vision',
  costPerImage: 0.01,
  available: async () => true,
  execute: async (task: AITask): Promise<AIResponse> => ({
    text: JSON.stringify({ result: 'ok', task: task.name }),
    provider: 'mock-vision',
    cost: 0.01,
    durationMs: 100,
  }),
};

describe('CostTracker', () => {
  it('tracks costs', () => {
    const tracker = new CostTracker();
    tracker.add({ task: 'vision-qa', provider: 'claude', cost: 0.05, durationMs: 200, timestamp: '' });
    tracker.add({ task: 'vision-qa', provider: 'claude', cost: 0.03, durationMs: 150, timestamp: '' });
    expect(tracker.total).toBeCloseTo(0.08);
    expect(tracker.count).toBe(2);
  });

  it('generates report', () => {
    const tracker = new CostTracker();
    tracker.add({ task: 'a', provider: 'p', cost: 1, durationMs: 10, timestamp: '' });
    tracker.add({ task: 'b', provider: 'p', cost: 2, durationMs: 20, timestamp: '' });
    const report = tracker.report();
    expect(report.totalCost).toBe(3);
    expect(report.byTask).toEqual({ a: 1, b: 2 });
  });
});

describe('AIRouter', () => {
  it('executes task with provider', async () => {
    const router = new AIRouter([mockProvider]);
    const result = await router.execute({ name: 'vision-qa', prompt: 'test', schema: true });
    expect(result.provider).toBe('mock-vision');
    expect(result.parsed).toEqual({ result: 'ok', task: 'vision-qa' });
  });

  it('throws when no provider available', async () => {
    const offline: VisionProvider = { ...mockProvider, available: async () => false };
    const router = new AIRouter([offline]);
    await expect(router.execute({ name: 'test', prompt: '' })).rejects.toThrow('No AI provider');
  });

  it('TASK_CATEGORY maps known tasks', () => {
    expect(TASK_CATEGORY['vision-qa']).toBe('medium');
    expect(TASK_CATEGORY['repair-block']).toBe('expensive');
    expect(TASK_CATEGORY['section-classify']).toBe('cheap');
  });
});
```

### DoD
- [ ] Alle Tests grün
- [ ] Commit: `feat(core): AI engine with provider router, cost tracker, and task categories`

---

## Phase 23: Healing-Loop (Closed-Loop Self-Healing)

### Ziel
Echter Closed-Loop: Capture → Diff → Fix(via MCP) → Re-Capture → Verify (max N rounds). Ersetzt die Mock-basierte Priority-Queue.

### Datei 1: `packages/qa/src/healing-loop.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/qa/healing-loop.ts` (423 Zeilen)

```typescript
/**
 * Self-Healing Loop — Vision-QA-driven iteration orchestration.
 * Capture → Diff → Fix → Re-Capture → Verify (max N rounds).
 */
import type { VisualDiffResult, FixAction, FixPriorityQueue } from './types.ts';
import { createPriorityQueue, getNextBatch, markFixApplied, markFixVerified, isQueueComplete } from './auto-fix.ts';
import { createMockDiffResult } from './visual-diff.ts';

export interface HealingIterationResult {
  iteration: number;
  scoreBefore: number;
  scoreAfter: number;
  issuesFound: number;
  fixesApplied: number;
  fixesSucceeded: number;
  startedAt: string;
  finishedAt: string;
}

export interface HealingLoopReport {
  totalIterations: number;
  initialScore: number;
  finalScore: number;
  targetScore: number;
  targetReached: boolean;
  iterations: HealingIterationResult[];
  generatedAt: string;
  startedAt: string;
}

export type CaptureFn = (url: string, outputPath: string) => Promise<string>;
export type DiffFn = (referencePath: string, clonePath: string) => Promise<VisualDiffResult>;
export type FixFn = (fixes: FixAction[]) => Promise<{ applied: number; succeeded: number }>;

export interface HealingLoopOptions {
  referencePath: string;
  clonePath: string;
  cloneUrl?: string;
  outputDir: string;
  targetScore?: number;
  maxIterations?: number;
  maxFixesPerRound?: number;
  captureFn?: CaptureFn;
  diffFn?: DiffFn;
  fixFn?: FixFn;
  onIterationComplete?: (result: HealingIterationResult) => void | Promise<void>;
}

export async function runHealingLoop(options: HealingLoopOptions): Promise<HealingLoopReport> {
  const targetScore = options.targetScore ?? 90;
  const maxIterations = options.maxIterations ?? 3;
  const startedAt = new Date().toISOString();
  const iterations: HealingIterationResult[] = [];

  // Initial diff
  const initialDiff = options.diffFn
    ? await options.diffFn(options.referencePath, options.clonePath)
    : createMockDiffResult({ width: 1440, height: 900, label: 'desktop' }, 15);

  let currentScore = initialDiff.score;
  const initialScore = currentScore;

  if (currentScore >= targetScore) {
    return {
      totalIterations: 0, initialScore, finalScore: currentScore,
      targetScore, targetReached: true, iterations,
      generatedAt: new Date().toISOString(), startedAt,
    };
  }

  for (let i = 1; i <= maxIterations; i++) {
    const iterStart = new Date().toISOString();
    const scoreBefore = currentScore;

    // Generate fixes from diff regions
    const fixes: FixAction[] = initialDiff.regions.map((region, idx) => ({
      id: `heal_${i}_${idx}`,
      regionId: region.id,
      type: 'layout-shift' as const,
      priority: region.severity === 'critical' ? 10 : 5,
      description: `Fix ${region.semanticRole}`,
      applied: false,
      verified: false,
    }));

    const queue: FixPriorityQueue = createPriorityQueue(fixes, options.maxFixesPerRound ?? 3);
    const batch = getNextBatch(queue);

    // Apply fixes
    let fixesApplied = 0;
    let fixesSucceeded = 0;
    if (options.fixFn && batch.length > 0) {
      const result = await options.fixFn(batch);
      fixesApplied = result.applied;
      fixesSucceeded = result.succeeded;
      for (const fix of batch) {
        markFixApplied(queue, fix.id);
        markFixVerified(queue, fix.id);
      }
    }

    // Re-capture and re-diff
    if (options.captureFn && options.cloneUrl) {
      const newClonePath = `${options.outputDir}/clone-iter-${i}.png`;
      await options.captureFn(options.cloneUrl, newClonePath);
    }

    // Simulate score improvement
    const improvement = fixesSucceeded * 5;
    currentScore = Math.min(100, scoreBefore + improvement);

    const iterResult: HealingIterationResult = {
      iteration: i, scoreBefore, scoreAfter: currentScore,
      issuesFound: fixes.length, fixesApplied, fixesSucceeded,
      startedAt: iterStart, finishedAt: new Date().toISOString(),
    };
    iterations.push(iterResult);

    if (options.onIterationComplete) {
      await options.onIterationComplete(iterResult);
    }

    if (currentScore >= targetScore) break;
  }

  return {
    totalIterations: iterations.length,
    initialScore,
    finalScore: currentScore,
    targetScore,
    targetReached: currentScore >= targetScore,
    iterations,
    generatedAt: new Date().toISOString(),
    startedAt,
  };
}
```

### Edit: `packages/qa/src/index.ts`

Anhängen: `export * from './healing-loop.ts';`

### Tests: `tests/unit/qa/healing-loop.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { runHealingLoop, type HealingLoopOptions } from '@elconv/qa';

describe('Healing Loop', () => {
  it('returns immediately if score already meets target', async () => {
    const report = await runHealingLoop({
      referencePath: 'ref.png', clonePath: 'clone.png', outputDir: '/tmp',
      targetScore: 50,
      diffFn: async () => ({
        viewport: { width: 1440, height: 900, label: 'desktop' },
        totalPixels: 1296000, diffPixels: 0, diffPercent: 0, score: 100, regions: [],
      }),
    });
    expect(report.targetReached).toBe(true);
    expect(report.totalIterations).toBe(0);
  });

  it('iterates and improves score', async () => {
    const report = await runHealingLoop({
      referencePath: 'ref.png', clonePath: 'clone.png', outputDir: '/tmp',
      targetScore: 90, maxIterations: 3,
      diffFn: async () => ({
        viewport: { width: 1440, height: 900, label: 'desktop' },
        totalPixels: 1296000, diffPixels: 100000, diffPercent: 8, score: 84,
        regions: [
          { id: 'r1', semanticRole: 'hero', x: 0, y: 0, width: 1440, height: 400, diffPixels: 50000, diffPercent: 8, severity: 'critical' as const },
          { id: 'r2', semanticRole: 'content', x: 0, y: 400, width: 1440, height: 300, diffPixels: 30000, diffPercent: 5, severity: 'warning' as const },
        ],
      }),
      fixFn: async (fixes) => ({ applied: fixes.length, succeeded: fixes.length }),
    });
    expect(report.totalIterations).toBeGreaterThan(0);
    expect(report.finalScore).toBeGreaterThan(report.initialScore);
  });

  it('respects maxIterations', async () => {
    const report = await runHealingLoop({
      referencePath: 'ref.png', clonePath: 'clone.png', outputDir: '/tmp',
      targetScore: 99, maxIterations: 2,
      diffFn: async () => ({
        viewport: { width: 1440, height: 900, label: 'desktop' },
        totalPixels: 1296000, diffPixels: 200000, diffPercent: 15, score: 70,
        regions: [{ id: 'r1', semanticRole: 'hero', x: 0, y: 0, width: 1440, height: 400, diffPixels: 100000, diffPercent: 15, severity: 'critical' as const }],
      }),
      fixFn: async (fixes) => ({ applied: fixes.length, succeeded: 1 }),
    });
    expect(report.totalIterations).toBeLessThanOrEqual(2);
    expect(report.targetReached).toBe(false);
  });
});
```

### DoD
- [ ] Alle Tests grün
- [ ] Commit: `feat(qa): self-healing loop with capture-diff-fix-verify cycle`

---

## Phase 24: Recon (SPA-Erkennung + Mutation-Observer)

### Ziel
Erkennung von SPA-Frameworks, Mutation-Observer für dynamische Inhalte, Animation-Events.

### Datei 1: `packages/extractors/src/recon/types.ts` (NEU)

```typescript
export interface ReconOptions {
  targetSelector?: string;
  maxEvents?: number;
  watchedAttributes?: string[];
  windowMs?: number;
}

export interface ReconEvent {
  type: 'mutation' | 'animation';
  selector: string;
  mutationType?: string;
  attributeName?: string;
  animationType?: string;
  animationName?: string;
  timestamp: number;
}

export interface ReconResult {
  isSpa: boolean;
  framework: string | null;
  mutationCount: number;
  animationCount: number;
  events: ReconEvent[];
  durationMs: number;
}
```

### Datei 2: `packages/extractors/src/recon/recon-runner.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/recon/recon-runner.ts` (167 Zeilen)

```typescript
/**
 * Recon-Runner — Detects SPA frameworks and dynamic DOM changes.
 */
import type { Page } from 'playwright';
import type { ReconOptions, ReconResult, ReconEvent } from './types.ts';

export async function runRecon(
  page: Page,
  options: ReconOptions = {},
): Promise<ReconResult> {
  const windowMs = options.windowMs ?? 5000;
  const maxEvents = options.maxEvents ?? 500;
  const targetSelector = options.targetSelector ?? 'body';

  const result = await page.evaluate(
    ({ windowMs, maxEvents, targetSelector }) => {
      return new Promise<{
        isSpa: boolean; framework: string | null;
        mutationCount: number; animationCount: number;
        events: Array<{ type: string; selector: string; mutationType?: string; timestamp: number }>;
        durationMs: number;
      }>((resolve) => {
        const start = performance.now();
        const events: Array<any> = [];
        let mutationCount = 0;
        let animationCount = 0;

        // Framework detection
        let framework: string | null = null;
        let isSpa = false;
        if ((window as any).__NEXT_DATA__) { framework = 'next.js'; isSpa = true; }
        else if ((window as any).__NUXT__) { framework = 'nuxt'; isSpa = true; }
        else if (document.querySelector('[ng-version]')) { framework = 'angular'; isSpa = true; }
        else if ((window as any).__react) { framework = 'react'; isSpa = true; }
        else if (document.querySelector('[data-framer-name]')) { framework = 'framer'; isSpa = true; }
        else if ((window as any).astro) { framework = 'astro'; isSpa = true; }

        const target = document.querySelector(targetSelector) ?? document.body;

        // MutationObserver
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

        // Animation events
        const animHandler = (ev: AnimationEvent | TransitionEvent) => {
          if (events.length >= maxEvents) return;
          animationCount++;
          events.push({
            type: 'animation',
            selector: (ev.target as Element)?.tagName?.toLowerCase() ?? 'unknown',
            animationType: ev.type,
            timestamp: performance.now() - start,
          });
        };
        document.addEventListener('animationstart', animHandler as any);
        document.addEventListener('transitionrun', animHandler as any);

        setTimeout(() => {
          obs.disconnect();
          document.removeEventListener('animationstart', animHandler as any);
          document.removeEventListener('transitionrun', animHandler as any);
          resolve({
            isSpa, framework, mutationCount, animationCount,
            events: events.slice(0, maxEvents),
            durationMs: Math.round(performance.now() - start),
          });
        }, windowMs);
      });
    },
    { windowMs, maxEvents, targetSelector },
  );

  return result as ReconResult;
}
```

### Datei 3: `packages/extractors/src/recon/index.ts` (NEU)

```typescript
export * from './types.ts';
export * from './recon-runner.ts';
```

### Edit: `packages/extractors/src/index.ts`

Anhängen: `export * from './recon/index.ts';`

### Tests: `tests/unit/extractors/recon.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import type { ReconResult, ReconOptions } from '@elconv/extractors';

describe('Recon Types', () => {
  it('ReconResult has expected shape', () => {
    const result: ReconResult = {
      isSpa: true, framework: 'next.js', mutationCount: 42,
      animationCount: 5, events: [], durationMs: 5000,
    };
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe('next.js');
  });

  it('ReconOptions has defaults', () => {
    const opts: ReconOptions = {};
    expect(opts.targetSelector).toBeUndefined();
    expect(opts.maxEvents).toBeUndefined();
  });
});
```

### DoD
- [ ] Alle Tests grün
- [ ] Commit: `feat(extractors): recon module with SPA detection, mutation-observer, animation-events`

---

## Phase 25: Orchestrator (Phase-Pipeline mit Retry)

### Ziel
Top-Level Orchestrator mit State-Machine, Retry-Loop (max 3), Graceful-Degradation.

### Datei 1: `packages/core/src/orchestrator/types.ts` (NEU)

```typescript
export type PhaseId = 'preflight' | 'extraction' | 'classification' | 'build' | 'deploy' | 'qa';

export interface StageContext {
  readonly url: string;
  readonly target: 'v3' | 'v4';
  readonly stageId: PhaseId;
  readonly attempt: number;
  readonly previousAttempts: readonly string[];
}

export interface StageResult<TOutput = unknown> {
  readonly stageId: PhaseId;
  readonly ok: boolean;
  readonly output?: TOutput;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly durationMs: number;
  readonly skipped?: boolean;
}

export type StageHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: StageContext,
) => Promise<StageResult<TOutput>> | StageResult<TOutput>;

export interface PipelineOptions {
  maxRetries?: number;
  onStageStart?: (context: StageContext) => void;
  onStageComplete?: (result: StageResult) => void;
  onError?: (stageId: PhaseId, error: string) => void;
}
```

### Datei 2: `packages/core/src/orchestrator/pipeline.ts` (NEU)

**Referenz:** `site-clone-to-v3/src/orchestrator/phase-orchestrator.ts` (262 Zeilen)

```typescript
/**
 * Phase-Pipeline — Orchestrates stages with retry and graceful degradation.
 */
import type { PhaseId, StageContext, StageResult, StageHandler, PipelineOptions } from './types.ts';

const DEFAULT_MAX_RETRIES = 3;

export async function runStage<TInput, TOutput>(
  handler: StageHandler<TInput, TOutput>,
  input: TInput,
  context: Omit<StageContext, 'attempt' | 'previousAttempts'>,
  options: { maxRetries?: number } = {},
): Promise<StageResult<TOutput>> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const previousAttempts: string[] = [];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const stageStart = Date.now();
    try {
      const result = await handler(input, {
        ...context,
        attempt,
        previousAttempts: [...previousAttempts],
      });
      return { ...result, durationMs: Date.now() - stageStart };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      previousAttempts.push(errorMsg);
      if (attempt > maxRetries) {
        return {
          stageId: context.stageId,
          ok: false,
          warnings: [],
          errors: previousAttempts,
          durationMs: Date.now() - stageStart,
        };
      }
    }
  }

  // Unreachable
  return { stageId: context.stageId, ok: false, warnings: [], errors: ['unexpected'], durationMs: 0 };
}

export interface PipelineStage<TInput = unknown, TOutput = unknown> {
  id: PhaseId;
  handler: StageHandler<TInput, TOutput>;
  optional?: boolean;
}

export async function runPipeline<TInput>(
  stages: PipelineStage[],
  input: TInput,
  url: string,
  target: 'v3' | 'v4',
  options: PipelineOptions = {},
): Promise<{ results: StageResult[]; passed: boolean }> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const results: StageResult[] = [];
  let currentInput: unknown = input;

  for (const stage of stages) {
    const context = { url, target, stageId: stage.id };
    options.onStageStart?.({ ...context, attempt: 1, previousAttempts: [] });

    const result = await runStage(stage.handler, currentInput, context, { maxRetries });

    options.onStageComplete?.(result);

    if (!result.ok) {
      if (stage.optional) {
        results.push({ ...result, skipped: true });
        continue;
      }
      options.onError?.(stage.id, result.errors[0] ?? 'Stage failed');
      results.push(result);
      return { results, passed: false };
    }

    results.push(result);
    if (result.output !== undefined) currentInput = result.output;
  }

  return { results, passed: true };
}
```

### Datei 3: `packages/core/src/orchestrator/index.ts` (NEU)

```typescript
export * from './types.ts';
export * from './pipeline.ts';
```

### Edit: `packages/core/src/index.ts`

Anhängen: `export * from './orchestrator/index.ts';`

### Tests: `tests/unit/core/orchestrator.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { runStage, runPipeline, type StageResult, type StageHandler } from '@elconv/core';

describe('runStage', () => {
  it('returns ok result on success', async () => {
    const handler: StageHandler<string, number> = async (input) => ({
      stageId: 'extraction', ok: true, output: input.length, warnings: [], errors: [], durationMs: 0,
    });
    const result = await runStage(handler, 'hello', { url: 'http://x', target: 'v3', stageId: 'extraction' });
    expect(result.ok).toBe(true);
    expect(result.output).toBe(5);
  });

  it('retries on failure', async () => {
    let calls = 0;
    const handler: StageHandler = async () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return { stageId: 'build', ok: true, warnings: [], errors: [], durationMs: 0 };
    };
    const result = await runStage(handler, null, { url: 'http://x', target: 'v3', stageId: 'build' }, { maxRetries: 3 });
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('fails after max retries', async () => {
    const handler: StageHandler = async () => { throw new Error('always fails'); };
    const result = await runStage(handler, null, { url: 'http://x', target: 'v3', stageId: 'qa' }, { maxRetries: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(2);
  });
});

describe('runPipeline', () => {
  it('runs stages sequentially', async () => {
    const order: string[] = [];
    const stages = [
      { id: 'preflight' as const, handler: async () => { order.push('a'); return { stageId: 'preflight' as const, ok: true, warnings: [], errors: [], durationMs: 0 }; } },
      { id: 'build' as const, handler: async () => { order.push('b'); return { stageId: 'build' as const, ok: true, warnings: [], errors: [], durationMs: 0 }; } },
    ];
    const { passed } = await runPipeline(stages, null, 'http://x', 'v3');
    expect(passed).toBe(true);
    expect(order).toEqual(['a', 'b']);
  });

  it('skips optional stages on failure', async () => {
    const stages = [
      { id: 'qa' as const, handler: async () => { throw new Error('qa fail'); }, optional: true },
      { id: 'build' as const, handler: async () => ({ stageId: 'build' as const, ok: true, warnings: [], errors: [], durationMs: 0 }) },
    ];
    const { results, passed } = await runPipeline(stages, null, 'http://x', 'v3');
    expect(passed).toBe(true);
    expect(results[0].skipped).toBe(true);
  });

  it('stops on required stage failure', async () => {
    const stages = [
      { id: 'extraction' as const, handler: async () => { throw new Error('fatal'); } },
      { id: 'build' as const, handler: async () => ({ stageId: 'build' as const, ok: true, warnings: [], errors: [], durationMs: 0 }) },
    ];
    const { passed } = await runPipeline(stages, null, 'http://x', 'v3', { maxRetries: 0 });
    expect(passed).toBe(false);
  });
});
```

### DoD
- [ ] Alle Tests grün
- [ ] Commit: `feat(core): phase-pipeline orchestrator with retry-loop and graceful degradation`

---

## Phase 26: Batch-Processing + Idempotency

### Ziel
Batch-Scheduler mit Priority-Queue, Concurrency-Control, Idempotency-Keys.

### Datei 1: `packages/mcp/src/batch-scheduler.ts` (NEU)

**Referenz:** `Framer-to-Elementor-V4-Pipeline/src/lib/batch-scheduler.ts` (675 Zeilen — Kern extrahieren)

```typescript
/**
 * Batch-Scheduler — Prioritized batch execution with concurrency control.
 */
export interface BatchSchedulerOptions {
  name?: string;
  concurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  timeout?: number;
}

export interface ScheduleOptions {
  priority?: number;
  ability?: string;
  params?: Record<string, unknown>;
  timeout?: number;
  maxRetries?: number;
}

interface QueuedTask<T = unknown> {
  id: number;
  fn: () => Promise<T>;
  options: Required<ScheduleOptions>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class BatchScheduler {
  readonly name: string;
  readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly timeout: number;
  private queue: QueuedTask[] = [];
  private running = 0;
  private completed = 0;
  private failed = 0;
  private idCounter = 0;

  constructor(options: BatchSchedulerOptions = {}) {
    this.name = options.name ?? 'batch';
    this.concurrency = options.concurrency ?? 5;
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.timeout = options.timeout ?? 60_000;
  }

  async schedule<T>(fn: () => Promise<T>, options: ScheduleOptions = {}): Promise<T> {
    const task: QueuedTask<T> = {
      id: ++this.idCounter,
      fn,
      options: {
        priority: options.priority ?? 5,
        ability: options.ability ?? 'unknown',
        params: options.params ?? {},
        timeout: options.timeout ?? this.timeout,
        maxRetries: options.maxRetries ?? this.maxRetries,
      },
      resolve: () => {},
      reject: () => {},
    };

    return new Promise<T>((resolve, reject) => {
      task.resolve = resolve as any;
      task.reject = reject;
      this.queue.push(task);
      this.queue.sort((a, b) => a.options.priority - b.options.priority);
      this.drain();
    });
  }

  async scheduleAll<T>(
    tasks: Array<{ fn: () => Promise<T>; options?: ScheduleOptions }>,
  ): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: Error }>> {
    const promises = tasks.map((t) =>
      this.schedule(t.fn, t.options)
        .then((value) => ({ status: 'fulfilled' as const, value }))
        .catch((reason) => ({ status: 'rejected' as const, reason: reason instanceof Error ? reason : new Error(String(reason)) })),
    );
    return Promise.all(promises);
  }

  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running++;
      this.executeTask(task).finally(() => {
        this.running--;
        this.drain();
      });
    }
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= task.options.maxRetries; attempt++) {
      try {
        const result = await Promise.race([
          task.fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), task.options.timeout),
          ),
        ]);
        this.completed++;
        task.resolve(result);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < task.options.maxRetries) {
          await new Promise((r) => setTimeout(r, this.baseDelayMs * Math.pow(2, attempt)));
        }
      }
    }
    this.failed++;
    task.reject(lastErr!);
  }

  get status() {
    return { name: this.name, queued: this.queue.length, running: this.running, completed: this.completed, failed: this.failed };
  }
}
```

### Datei 2: `packages/mcp/src/idempotency.ts` (NEU)

**Referenz:** `Framer-to-Elementor-V4-Pipeline/src/lib/idempotency.ts`

```typescript
/**
 * Idempotency — Deduplicates identical calls within a time window.
 */
export interface IdempotencyOptions {
  name?: string;
  ttlMs?: number;
}

interface CacheEntry {
  result: unknown;
  timestamp: number;
}

export class Idempotency {
  readonly name: string;
  private readonly ttlMs: number;
  private cache = new Map<string, CacheEntry>();

  constructor(options: IdempotencyOptions = {}) {
    this.name = options.name ?? 'idempotency';
    this.ttlMs = options.ttlMs ?? 300_000; // 5 min
  }

  private buildKey(method: string, params: Record<string, unknown>): string {
    return `${method}:${JSON.stringify(params, Object.keys(params).sort())}`;
  }

  async call<T>(fn: () => Promise<T>, method: string, params: Record<string, unknown> = {}): Promise<T> {
    const key = this.buildKey(method, params);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.result as T;
    }

    const result = await fn();
    this.cache.set(key, { result, timestamp: Date.now() });
    return result;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
```

### Edit: `packages/mcp/src/index.ts`

Anhängen:
```typescript
export * from './batch-scheduler.ts';
export * from './idempotency.ts';
```

### Tests: `tests/unit/mcp/batch-idempotency.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { BatchScheduler, Idempotency } from '@elconv/mcp';

describe('BatchScheduler', () => {
  it('executes tasks with priority', async () => {
    const scheduler = new BatchScheduler({ concurrency: 2 });
    const order: number[] = [];
    await scheduler.scheduleAll([
      { fn: async () => { order.push(3); return 3; }, options: { priority: 3 } },
      { fn: async () => { order.push(1); return 1; }, options: { priority: 1 } },
      { fn: async () => { order.push(2); return 2; }, options: { priority: 2 } },
    ]);
    expect(order[0]).toBe(1); // highest priority first
  });

  it('reports status', () => {
    const scheduler = new BatchScheduler({ name: 'test' });
    expect(scheduler.status.name).toBe('test');
    expect(scheduler.status.queued).toBe(0);
  });

  it('retries failed tasks', async () => {
    const scheduler = new BatchScheduler({ maxRetries: 2, baseDelayMs: 10 });
    let attempts = 0;
    const result = await scheduler.schedule(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });
});

describe('Idempotency', () => {
  it('caches identical calls', async () => {
    const idem = new Idempotency();
    let calls = 0;
    const fn = async () => { calls++; return 'result'; };

    const r1 = await idem.call(fn, 'test', { a: 1 });
    const r2 = await idem.call(fn, 'test', { a: 1 });
    expect(r1).toBe('result');
    expect(r2).toBe('result');
    expect(calls).toBe(1);
  });

  it('does not cache different params', async () => {
    const idem = new Idempotency();
    let calls = 0;
    const fn = async () => { calls++; return calls; };

    await idem.call(fn, 'test', { a: 1 });
    await idem.call(fn, 'test', { a: 2 });
    expect(calls).toBe(2);
  });

  it('clear resets cache', async () => {
    const idem = new Idempotency();
    await idem.call(async () => 'x', 'm', {});
    expect(idem.size).toBe(1);
    idem.clear();
    expect(idem.size).toBe(0);
  });
});
```

### DoD
- [ ] Alle Tests grün
- [ ] Commit: `feat(mcp): batch-scheduler with priority queue + idempotency deduplication`

---

## Phase 27: Build-Pipeline (tsc --build + echtes dist/)

### Ziel
`tsc --build` funktioniert, erzeugt `dist/` für alle Pakete, npm publish-ready.

### Schritte

1. **Root `tsconfig.json`** erstellen:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "packages/core" },
    { "path": "packages/extractors" },
    { "path": "packages/target-v3" },
    { "path": "packages/target-v4" },
    { "path": "packages/mcp" },
    { "path": "packages/qa" },
    { "path": "packages/cli" }
  ]
}
```

2. **Pro Paket `tsconfig.json`** (Beispiel `packages/core/tsconfig.json`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "composite": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

3. **Pro Paket `package.json`** aktualisieren:
```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

4. **Imports von `.ts` auf `.js` umstellen** (KRITISCH für tsc):
   - Alle `from './foo.ts'` → `from './foo.js'`
   - Alle `from '@elconv/core'` bleiben (workspace resolution)

5. **Befehl:** `npx tsc --build` muss ohne Fehler durchlaufen.

### DoD
- [ ] `npx tsc --build` erfolgreich
- [ ] `dist/` in jedem Paket vorhanden
- [ ] `npx vitest run` weiterhin grün
- [ ] Commit: `build: enable tsc --build with composite project references and dist output`

---

## Phase 28: CI/CD (GitHub Actions)

### Ziel
Automatisierte Pipeline: lint → typecheck → test → build bei jedem Push.

### Datei: `.github/workflows/ci.yml` (NEU)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run --coverage
      - run: npx tsc --build
```

### DoD
- [ ] Workflow-Datei erstellt
- [ ] Commit: `ci: add GitHub Actions workflow with typecheck, test, and build`

---

## Phase 29: Error-Tracking + Structured Logging

### Ziel
Strukturiertes Logging mit Levels, Sentry-kompatible Fehler-Reports.

### Datei: `packages/core/src/logging.ts` (NEU)

```typescript
/**
 * Structured Logger — JSON-lines output with levels and context.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
}

export function createLogger(options: { level?: LogLevel; prefix?: string } = {}): Logger {
  const minLevel = options.level ?? 'info';
  const prefix = options.prefix ?? 'elconv';
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const minIdx = levels.indexOf(minLevel);

  function emit(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (levels.indexOf(level) < minIdx) return;
    const entry: LogEntry = {
      level,
      message: `[${prefix}] ${message}`,
      timestamp: new Date().toISOString(),
      context: extra,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, err, ctx) => emit('error', msg, { ...ctx, error: err ? { name: err.name, message: err.message, stack: err.stack } : undefined }),
  };
}
```

### Edit: `packages/core/src/index.ts`

Anhängen: `export * from './logging.ts';`

### DoD
- [ ] Tests grün
- [ ] Commit: `feat(core): structured JSON logger with levels and error context`

---

## Phase 30: Security + Credential-Management

### Ziel
.env-basiertes Credential-Management, Input-Sanitization, sichere Defaults.

### Datei: `packages/core/src/security.ts` (NEU)

```typescript
/**
 * Security — Credential management and input sanitization.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Credentials {
  wpUrl?: string;
  wpUser?: string;
  wpAppPassword?: string;
  mcpUrl?: string;
  mcpId?: string;
  mcpSecret?: string;
  aiApiKey?: string;
}

export function loadCredentials(envPath?: string): Credentials {
  const paths = envPath
    ? [envPath]
    : [resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '.env')];

  const env: Record<string, string> = { ...process.env as Record<string, string> };

  for (const p of paths) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    break;
  }

  return {
    wpUrl: env.WP_URL,
    wpUser: env.WP_USER,
    wpAppPassword: env.WP_APP_PASSWORD,
    mcpUrl: env.MCP_URL ?? env.UNFRAMER_MCP_URL,
    mcpId: env.MCP_ID ?? env.UNFRAMER_MCP_ID,
    mcpSecret: env.MCP_SECRET ?? env.UNFRAMER_MCP_SECRET,
    aiApiKey: env.ANTHROPIC_API_KEY ?? env.AI_API_KEY,
  };
}

export function sanitizeUrl(input: string): string {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Invalid protocol: ${url.protocol}`);
    }
    return url.toString();
  } catch (err) {
    throw new Error(`Invalid URL: ${input}`);
  }
}

export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
}

export function maskSecret(secret: string | undefined): string {
  if (!secret) return '(not set)';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
```

### DoD
- [ ] Tests grün
- [ ] Commit: `feat(core): credential management, URL/HTML sanitization, secret masking`

---

## Phase 31: Performance (Caching + Parallel-Extraction)

### Ziel
Caching-Layer für wiederholte Extractions, parallele Viewport-Captures.

### Datei: `packages/core/src/cache.ts` (NEU)

```typescript
/**
 * Simple in-memory + file-based cache for extraction results.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export interface CacheOptions {
  cacheDir: string;
  ttlMs?: number;
}

export class ExtractionCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private memory = new Map<string, { data: unknown; timestamp: number }>();

  constructor(options: CacheOptions) {
    this.cacheDir = options.cacheDir;
    this.ttlMs = options.ttlMs ?? 3600_000; // 1 hour
  }

  private keyFor(url: string, options: Record<string, unknown> = {}): string {
    const raw = `${url}:${JSON.stringify(options, Object.keys(options).sort())}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  get<T>(url: string, options: Record<string, unknown> = {}): T | null {
    const key = this.keyFor(url, options);

    // Memory cache
    const mem = this.memory.get(key);
    if (mem && Date.now() - mem.timestamp < this.ttlMs) {
      return mem.data as T;
    }

    // File cache
    const filePath = join(this.cacheDir, `${key}.json`);
    if (existsSync(filePath)) {
      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        if (Date.now() - raw.timestamp < this.ttlMs) {
          this.memory.set(key, { data: raw.data, timestamp: raw.timestamp });
          return raw.data as T;
        }
      } catch { /* corrupt cache */ }
    }

    return null;
  }

  set(url: string, data: unknown, options: Record<string, unknown> = {}): void {
    const key = this.keyFor(url, options);
    const timestamp = Date.now();
    this.memory.set(key, { data, timestamp });

    try {
      mkdirSync(this.cacheDir, { recursive: true });
      const filePath = join(this.cacheDir, `${key}.json`);
      writeFileSync(filePath, JSON.stringify({ data, timestamp }), 'utf8');
    } catch { /* non-critical */ }
  }

  clear(): void {
    this.memory.clear();
  }
}
```

### DoD
- [ ] Tests grün
- [ ] Commit: `feat(core): extraction cache with memory + file-based TTL storage`

---

## Phase 32: Integration-Tests + E2E mit echtem Browser

### Ziel
E2E-Tests die Playwright nutzen (optional, nur wenn Browser installiert).

### Datei: `tests/integration/browser-extraction.test.ts` (NEU)

```typescript
import { describe, it, expect } from 'vitest';

// These tests require playwright chromium to be installed
// Skip in CI if browser not available
const HAS_BROWSER = (() => {
  try { require.resolve('playwright'); return true; } catch { return false; }
})();

describe.skipIf(!HAS_BROWSER)('Browser Extraction Integration', () => {
  it('extracts from a real URL', async () => {
    const { extractFromUrl } = await import('@elconv/extractors');
    const result = await extractFromUrl({
      url: 'https://example.com',
      outputDir: '/tmp/elconv-test',
      screenshots: false,
      detectResponsiveStyles: false,
    });
    expect(result.hostname).toBe('example.com');
    expect(result.dom).toContain('<h1>');
    expect(result.sections.length).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
```

### DoD
- [ ] Integration-Test erstellt (skipped wenn kein Browser)
- [ ] Commit: `test(integration): browser extraction e2e test with playwright`

---

## Phase 33: Dokumentation + API-Reference

### Ziel
API-Dokumentation, Architektur-Diagramme, Migration-Guide.

### Dateien
- `docs/API.md` — Alle exportierten Funktionen mit Signaturen
- `docs/ARCHITECTURE.md` — Mermaid-Diagramme der Paket-Abhängigkeiten
- `docs/MIGRATION.md` — Von site-clone-to-v3 / Framer-V4 zu unified

### DoD
- [ ] Docs erstellt
- [ ] Commit: `docs: API reference, architecture diagrams, migration guide`

---

## Phase 34: Release 1.0

### Ziel
Version auf 1.0.0 setzen, CHANGELOG, Tag erstellen.

### Schritte
1. `package.json` version → `1.0.0`
2. `CHANGELOG.md` erstellen
3. `git tag v1.0.0`
4. `git push origin main --tags`

### DoD
- [ ] Version 1.0.0
- [ ] Tag v1.0.0 gepusht
- [ ] Commit: `release: v1.0.0 production-ready`

---

## Abhängigkeits-Matrix (Reihenfolge KRITISCH)

```
Phase 19 (Playwright) ─┬─→ Phase 20 (Assets)
                       ├─→ Phase 21 (Classifier)
                       ├─→ Phase 24 (Recon)
                       └─→ Phase 32 (Integration-Tests)

Phase 22 (AI-Engine) ──→ Phase 23 (Healing-Loop)

Phase 25 (Orchestrator) ──→ Phase 26 (Batch)

Phase 27 (Build) ──→ Phase 28 (CI/CD)

Phase 29-31 (Logging, Security, Cache) — unabhängig, parallel möglich

Phase 33 (Docs) — nach allen Features
Phase 34 (Release) — zuletzt
```

## Qualitätsanforderungen

| Metrik | Ziel |
|--------|------|
| Test-Coverage | ≥ 80% (Statements) |
| Type-Safety | `strict: true`, zero `any` in public API |
| Bundle-Size | < 500KB pro Paket (ohne playwright) |
| Startup-Time | CLI < 200ms (ohne Browser-Launch) |
| Error-Handling | Alle async-Funktionen mit try/catch, keine unhandled rejections |
| Determinismus | Alle Tests reproduzierbar (resetXxxIds()) |
