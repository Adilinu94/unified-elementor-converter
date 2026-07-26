/**
 * ignore-regions.ts — Modul V1.2 (UMBAUPLAN.md §6).
 *
 * Masks out dynamic content (carousels, timestamps, ads) before diffing,
 * so pixelmatch/ssim never penalize a clone for content that legitimately
 * changes between the original and clone screenshot captures.
 */

import { PNG } from 'pngjs';
import type { Page } from 'playwright';
import type { IgnoreRegion } from '@elconv/core';

export type { IgnoreRegion };

const MASK_COLOR = [128, 128, 128, 255] as const;

/**
 * Returns a copy of `png` with each region painted over in neutral gray,
 * so pixelmatch/ssim never count diffs inside dynamic content areas.
 */
export function applyIgnoreMask(png: PNG, regions: IgnoreRegion[]): PNG {
  const out = PNG.sync.read(PNG.sync.write(png));
  for (const region of regions) {
    const xStart = Math.max(0, Math.floor(region.x));
    const yStart = Math.max(0, Math.floor(region.y));
    const xEnd = Math.min(out.width, Math.ceil(region.x + region.width));
    const yEnd = Math.min(out.height, Math.ceil(region.y + region.height));
    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        const idx = (out.width * y + x) << 2;
        out.data[idx] = MASK_COLOR[0];
        out.data[idx + 1] = MASK_COLOR[1];
        out.data[idx + 2] = MASK_COLOR[2];
        out.data[idx + 3] = MASK_COLOR[3];
      }
    }
  }
  return out;
}

interface RawDynamicRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
}

/**
 * Heuristic detection of dynamic content regions on a live/rendered page:
 * carousels, ad iframes, and short clock-style timestamps. Bounding boxes
 * require real layout, so this needs a live `Page` (not static HTML) —
 * for pages you can't render, build IgnoreRegion[] manually instead.
 */
export async function detectDynamicRegions(page: Page): Promise<IgnoreRegion[]> {
  const raw = await page.evaluate((): RawDynamicRegion[] => {
    const found: RawDynamicRegion[] = [];
    const pushRect = (el: Element, reason: string) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      found.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, reason });
    };

    const CAROUSEL_SELECTOR =
      '[data-carousel], .swiper, .slick-slider, [role="region"][aria-roledescription="carousel"]';
    document.querySelectorAll(CAROUSEL_SELECTOR).forEach((el) => pushRect(el, 'carousel'));

    const AD_SELECTOR = 'iframe[src*="doubleclick"], ins.adsbygoogle';
    document.querySelectorAll(AD_SELECTOR).forEach((el) => pushRect(el, 'ad'));

    const TIMESTAMP_RE = /\b\d{1,2}:\d{2}(:\d{2})?\b/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      if (!text || text.length > 20 || !TIMESTAMP_RE.test(text)) continue;
      const parentEl = node.parentElement;
      if (parentEl) pushRect(parentEl, 'timestamp');
    }

    return found;
  });

  return raw.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, reason: r.reason }));
}
