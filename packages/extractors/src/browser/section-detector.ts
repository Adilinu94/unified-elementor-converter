/**
 * Section-Detector — Detects page sections from live DOM.
 */
import type { Page } from 'playwright';
import type { SectionInfo } from './types.js';

export interface DetectSectionsOptions {
  maxSections?: number;
  minHeightPx?: number;
  /**
   * Drop a matched node when it CONTAINS another matched node, keeping the
   * more specific one. Default true.
   *
   * Without this, `<main>` wrapping the whole page is reported as a section
   * alongside every real section inside it, so all content is counted twice.
   * Measured on a real Framer page: with the filter the 12 remaining sections
   * sum to exactly the document height (16612px) with no overlap.
   */
  dropAncestorSections?: boolean;
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

/**
 * Section selectors, ordered from most to least specific.
 *
 * `section[data-framer-name]` is measured, not guessed. Framer emits
 * `<section class="framer-gemdf9" data-framer-name="Hero">` — no `id`, no
 * "section" in the class name, no `data-section`. Against a real Framer page
 * the previous list matched 2 nodes (`main`, `footer`), which is why the
 * `--url` path produced 2 sections with 0 widgets. Adding this one selector
 * lifts it to the 11 real sections plus the footer.
 *
 * `div[data-framer-name]` is deliberately NOT included: it matches 357 nodes
 * on the same page, 121 of them nested inside another match. Framer names
 * every layer, so the attribute alone carries no section semantics on a div.
 */
const SECTION_SELECTORS = [
  'section[id]', 'section[class*="section"]', '[data-section]',
  'section[data-framer-name]',
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
  const dropAncestors = options.dropAncestorSections !== false;

  const raw = await page.evaluate(
    ({ selectors, maxN, minH, dropAnc }) => {
      const candidates: Element[] = [];
      const seen = new Set<Element>();
      for (const el of Array.from(document.querySelectorAll(selectors))) {
        if (seen.has(el)) continue;
        if (el.getBoundingClientRect().height < minH) continue;
        seen.add(el);
        candidates.push(el);
      }

      // Keep the most specific match: drop any candidate that wraps another.
      const kept = dropAnc
        ? candidates.filter((a) => !candidates.some((b) => b !== a && a.contains(b)))
        : candidates;

      const out: Array<{
        section_id: string; selector: string; y_range: [number, number];
        layout: string; child_count: number; tag: string; id?: string; classes: string;
        framerName?: string;
      }> = [];

      for (const el of kept) {
        if (out.length >= maxN) break;
        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const id = el.id || undefined;
        const classes = el.className && typeof el.className === 'string' ? el.className : '';
        const framerName = el.getAttribute('data-framer-name') ?? undefined;

        // Prefer the stable Framer name over a hashed class for the selector:
        // `.framer-gemdf9` changes on every republish, the name does not.
        const selector = id
          ? `${tag}#${id}`
          : framerName
            ? `${tag}[data-framer-name="${framerName}"]`
            : classes
              ? `${tag}.${classes.split(' ')[0]}`
              : tag;

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
          framerName,
        });
      }
      return out;
    },
    { selectors: SECTION_SELECTORS, maxN: maxSections, minH: minHeightPx, dropAnc: dropAncestors },
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
