/**
 * Playwright-Extractor — Main browser-based extraction orchestrator.
 */
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BrowserExtractionOptions, BrowserExtractionResult, ViewportConfig,
  AnimationInfo, DiscoveredImage, DiscoveredSvg, DiscoveredFavicon,
  ComputedStyleSnapshot,
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
