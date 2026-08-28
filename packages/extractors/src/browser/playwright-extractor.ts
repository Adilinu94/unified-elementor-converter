/**
 * Playwright-Extractor — Main browser-based extraction orchestrator.
 */
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BrowserExtractionOptions, BrowserExtractionResult,
  AnimationInfo, DiscoveredImage, DiscoveredSvg, DiscoveredFavicon,
  ComputedStyleSnapshot,
} from './types.js';
import { DEFAULT_VIEWPORTS } from './types.js';
import { waitForHydration } from './hydration-wait.js';
import { triggerLazyLoad } from './lazy-scroll.js';
import { walkComputedStyles } from './computed-styles.js';
import { detectSections } from './section-detector.js';
import { FontUrlCollector, buildFontRouteHandler } from './font-discovery.js';
import { buildCssBodyCollector, discoverAnimations, type CrossOriginStylesheet } from './keyframes-discovery.js';

const BROWSERS = { chromium, firefox, webkit };

export async function extractFromUrl(
  options: BrowserExtractionOptions,
): Promise<BrowserExtractionResult> {
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const browserType = BROWSERS[options.browser ?? 'chromium'];

  const browser: Browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: viewports[0].width, height: viewports[0].height },
    });
    const page: Page = await context.newPage();
    return await extractFromPage(page, options);
  } finally {
    await browser.close();
  }
}

/**
 * Run the full extraction pipeline against an already-connected Playwright
 * page. `extractFromUrl` launches a local browser and delegates here; the
 * Browserbase cloud extractor connects a remote page over CDP and calls this
 * directly. The page is navigated to `options.url` inside this function.
 */
export async function extractFromPage(
  page: Page,
  options: BrowserExtractionOptions,
): Promise<BrowserExtractionResult> {
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const fontCollector = new FontUrlCollector();
  const cssCollector = buildCssBodyCollector();

  await mkdir(options.outputDir, { recursive: true });

  // Font + stylesheet interception.
  //
  // Both go through ONE handler on purpose. Playwright dispatches a request to
  // the most recently registered matching handler only — a second
  // `page.route('**/*', ...)` would shadow the font handler and silently empty
  // `fontsIntercepted`. Registration must also happen before `goto`, since a
  // stylesheet requested during navigation cannot be intercepted afterwards.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (isFontRequest(url)) {
      await buildFontRouteHandler(fontCollector)(route);
      return;
    }
    if (route.request().resourceType() === 'stylesheet' || /\.css(\?|$)/i.test(url)) {
      await cssCollector.handler(route);
      return;
    }
    await route.continue();
  });

  // Navigate
  await page.goto(options.url, { waitUntil: 'networkidle', timeout: options.timeoutMs ?? 60_000 });

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
    ? await detectAnimations(page, cssCollector.list())
    : emptyAnimationInfo();

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
  const computedStyles: Record<string, ComputedStyleSnapshot[]> = {};

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

/**
 * Detect what animation machinery the page uses.
 *
 * `has_keyframes` and `keyframe_names` used to be hardcoded `false` / `[]`
 * here. That single fact disabled the whole downstream keyframe path: the V3
 * snippet builder returns null when `has_keyframes` is false, so a page's
 * `@keyframes` were never carried over — even though `discoverAnimations()`
 * existed, worked, and was exported. It just had no caller.
 *
 * `crossOriginCss` matters because same-origin `cssRules` access throws a
 * SecurityError for a CDN-hosted stylesheet, and Framer serves its CSS from a
 * CDN. Without the intercepted bodies, a cross-origin keyframe is invisible.
 */
async function detectAnimations(
  page: Page,
  crossOriginCss: CrossOriginStylesheet[] = [],
): Promise<AnimationInfo> {
  const runtime = await page.evaluate(() => {
    const windowWithAnimationGlobals = window as Window & {
      gsap?: unknown;
      ScrollTrigger?: unknown;
    };
    const gsap = windowWithAnimationGlobals.gsap;
    const ScrollTrigger = windowWithAnimationGlobals.ScrollTrigger;
    const framer = document.querySelector('[data-framer-name]');
    const lenis = document.querySelector('.lenis, [data-lenis]');
    return {
      has_gsap: typeof gsap === 'object' && gsap !== null,
      has_scrolltrigger: typeof ScrollTrigger === 'object' && ScrollTrigger !== null,
      has_framer_motion: framer !== null,
      has_lenis: lenis !== null,
    };
  });

  const discovery = await discoverAnimations(page, crossOriginCss);

  return {
    has_keyframes: discovery.keyframes.length > 0,
    keyframe_names: discovery.keyframes.map((keyframe) => keyframe.name),
    has_gsap: runtime.has_gsap || discovery.gsap.hasGSAP,
    has_scrolltrigger: runtime.has_scrolltrigger || discovery.gsap.hasScrollTrigger,
    has_framer_motion: runtime.has_framer_motion,
    has_lenis: runtime.has_lenis,
    transitions: discovery.transitions,
    same_origin_keyframe_count: discovery.same_origin_count,
    cross_origin_keyframe_count: discovery.cross_origin_count,
  };
}

function emptyAnimationInfo(): AnimationInfo {
  return {
    has_keyframes: false,
    keyframe_names: [],
    has_gsap: false,
    has_scrolltrigger: false,
    has_framer_motion: false,
    has_lenis: false,
  };
}

const FONT_REQUEST_PATTERN = /(\.(woff2?|ttf|otf|eot)(\?|$))|(fonts\.googleapis\.com\/css)/i;

function isFontRequest(url: string): boolean {
  return FONT_REQUEST_PATTERN.test(url);
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

    const escapeCssIdentifier = (value: string): string => {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
      return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
    };

    const describeElement = (element: Element): string => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body) {
        if (current.id) {
          parts.unshift(`#${escapeCssIdentifier(current.id)}`);
          break;
        }
        let part = current.tagName.toLowerCase();
        const classes = Array.from(current.classList)
          .map(escapeCssIdentifier)
          .filter(Boolean);
        if (classes.length > 0) part += `.${classes.join('.')}`;
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current!.tagName)
          : [];
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };

    const svgs: Array<{ kind: 'inline' | 'external'; url?: string; markup?: string; sourceElement?: string; existingId?: string }> = [];
    for (const svgEl of Array.from(document.querySelectorAll('svg'))) {
      const markup = svgEl.outerHTML;
      // Do not discard small SVG icons: valid favicons and UI glyphs can be tiny.
      svgs.push({
        kind: 'inline',
        markup,
        sourceElement: describeElement(svgEl),
        existingId: svgEl.id || undefined,
      });
    }

    const favicons: Array<{ url: string; kind: string; sizes?: string; type?: string }> = [];
    for (const link of Array.from(document.querySelectorAll('link[rel*="icon"]'))) {
      const href = (link as HTMLLinkElement).href;
      if (!href || href.startsWith('data:')) continue;
      favicons.push({ url: href, kind: 'icon', sizes: link.getAttribute('sizes') ?? undefined });
    }

    return { images, svgs, favicons } as {
      images: DiscoveredImage[];
      svgs: DiscoveredSvg[];
      favicons: DiscoveredFavicon[];
    };
  });
}
