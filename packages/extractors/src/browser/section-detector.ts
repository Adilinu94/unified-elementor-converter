/**
 * Section-Detector — Detects page sections from live DOM.
 */
import type { Page } from 'playwright';
import type { SectionInfo } from './types.js';

export interface DetectSectionsOptions {
  maxSections?: number;
  minHeightPx?: number;
}

/** Merger threshold (V2 §5.5). Override only for tests. */
export interface MergeThreshold {
  /** Max height in px for rule (a). */
  maxHeightPx?: number;
  /** Max child-count per section for rule (a). */
  maxChildCount?: number;
  /** Max height in px for rule (b). */
  maxHeightPxTight?: number;
}

export const DEFAULT_MERGE_THRESHOLD: Required<MergeThreshold> = {
  maxHeightPx: 200,
  maxChildCount: 2,
  maxHeightPxTight: 100,
};

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

/**
 * Helper for the merge decision: do `a` and `b` qualify as mergeable?
 * Exposed for unit tests.
 *
 *   (a) both < maxHeightPx AND both < maxChildCount children
 *   (b) both < maxHeightPxTight AND same backgroundColor
 *
 * @param bgA / bgB backgroundColor of section A / B (computed style).
 */
export function areMergeable(
  a: { heightPx: number; childCount: number; backgroundColor?: string },
  b: { heightPx: number; childCount: number; backgroundColor?: string },
  threshold: MergeThreshold = {},
): boolean {
  const t = { ...DEFAULT_MERGE_THRESHOLD, ...threshold };
  // Rule (a)
  if (
    a.heightPx < t.maxHeightPx &&
    b.heightPx < t.maxHeightPx &&
    a.childCount < t.maxChildCount &&
    b.childCount < t.maxChildCount
  ) {
    return true;
  }
  // Rule (b)
  if (
    a.heightPx < t.maxHeightPxTight &&
    b.heightPx < t.maxHeightPxTight &&
    !!a.backgroundColor &&
    a.backgroundColor === b.backgroundColor
  ) {
    return true;
  }
  return false;
}

/**
 * Merge adjacent small sections according to V2 §5.5 thresholds.
 *
 * Sections are processed in y-range order. Two adjacent sections (the next
 * one in the list, no gap) are merged when `areMergeable()` returns true.
 * The merged section's selector is a comma-separated list of child selectors
 * so Elementor V3 can recreate them as inner-sections.
 *
 * Background-color is optional; if absent, only rule (a) applies.
 */
export function mergeSmallSections<T extends {
  section_id: string;
  selector: string;
  y_range: [number, number];
  layout: string;
  child_count: number;
  tag: string;
  id?: string;
  classes: string;
  backgroundColor?: string;
}>(
  sections: T[],
  threshold: MergeThreshold = {},
): T[] {
  if (sections.length < 2) return sections;

  const sorted = [...sections].sort((a, b) => a.y_range[0] - b.y_range[0]);
  const merged: T[] = [];
  let buffer: T | null = null;

  const flushBuffer = () => {
    if (buffer) {
      merged.push(buffer);
      buffer = null;
    }
  };

  for (const sec of sorted) {
    const heightPx = sec.y_range[1] - sec.y_range[0];
    const sectionLike = {
      heightPx,
      childCount: sec.child_count,
      backgroundColor: sec.backgroundColor,
    };

    if (buffer) {
      const isAdjacent = sec.y_range[0] - buffer.y_range[1] <= 2; // tolerate 2px gap
      if (isAdjacent && areMergeable(sectionLike, {
        heightPx: buffer.y_range[1] - buffer.y_range[0],
        childCount: buffer.child_count,
        backgroundColor: buffer.backgroundColor,
      }, threshold)) {
        // Merge buffer + sec
        const combinedSelectors = `${buffer.selector}, ${sec.selector}`;
        buffer = {
          ...buffer,
          section_id: `${buffer.section_id}+${sec.section_id}`,
          selector: combinedSelectors,
          y_range: [buffer.y_range[0], sec.y_range[1]],
          child_count: buffer.child_count + sec.child_count,
        } as T;
        continue;
      } else {
        flushBuffer();
      }
    }
    buffer = sec;
  }
  flushBuffer();
  return merged;
}
