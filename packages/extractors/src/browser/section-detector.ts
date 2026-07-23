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
