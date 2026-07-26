/**
 * Structure Diff (#8)
 *
 * DOM-structure diff between the Framer live site and the Elementor live site.
 * For non-vision models: instead of pixel diff, compares per-section STRUCTURE
 * (container count, child depth, text content, heading order, button count,
 * image count). Returns structured data the builder can act on — no images
 * needed.
 *
 * @example
 * import { runStructureDiff } from './qa/structure-diff.js';
 * const diff = await runStructureDiff({
 *   framerUrl: 'https://easier-train-154753.framer.app/',
 *   elementorUrl: 'https://testseite.nick-webdesign.de/oral-care/',
 *   sections: [{ framerSelector: 'section', elementorClass: 'oc-hero', label: 'Hero' }],
 * });
 */

export interface SectionMapping {
  /** Framer-side selector (or 'auto' to grab top-level sections). */
  framerSelector: string;
  /** Elementor-side section class (css_classes on the container). */
  elementorClass: string;
  /** Human label. */
  label: string;
}

export interface SectionStructure {
  label: string;
  side: 'framer' | 'elementor';
  /** Number of direct child containers. */
  childCount: number;
  /** Max DOM depth. */
  maxDepth: number;
  /** Total text content length. */
  textLength: number;
  /** Heading tags in order: ['h1','h2','h2',...]. */
  headings: string[];
  /** Number of button-like elements. */
  buttonCount: number;
  /** Number of images. */
  imageCount: number;
  /** First 200 chars of text for sanity check. */
  textPreview: string;
}

export interface SectionDiff {
  label: string;
  framer: SectionStructure | null;
  elementor: SectionStructure | null;
  /** Per-field match. */
  matches: { childCount: boolean; headings: boolean; buttonCount: boolean; imageCount: boolean };
  /** Overall: do the structures match? */
  match: boolean;
  /** Human-readable deltas. */
  deltas: string[];
}

export interface StructureDiffOptions {
  framerUrl: string;
  elementorUrl: string;
  sections: SectionMapping[];
  /** Wait after load (ms). Default 2500. */
  waitMs?: number;
}

/**
 * Run a structure diff between Framer live and Elementor live.
 * Returns per-section structured comparison (no images).
 */
export async function runStructureDiff(opts: StructureDiffOptions): Promise<SectionDiff[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const diffs: SectionDiff[] = [];

  try {
    const [framerStruct, elementorStruct] = await Promise.all([
      probeStructure(browser, opts.framerUrl, opts.sections, 'framer', opts.waitMs ?? 2500),
      probeStructure(browser, opts.elementorUrl, opts.sections, 'elementor', opts.waitMs ?? 2500),
    ]);

    for (let i = 0; i < opts.sections.length; i++) {
      const f = framerStruct[i] ?? null;
      const e = elementorStruct[i] ?? null;
      diffs.push(compareStructure(opts.sections[i].label, f, e));
    }
  } finally {
    await browser.close();
  }
  return diffs;
}

async function probeStructure(
  browser: import('playwright').Browser,
  url: string,
  sections: SectionMapping[],
  side: 'framer' | 'elementor',
  waitMs: number,
): Promise<(SectionStructure | null)[]> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.waitForTimeout(waitMs);

  const out: (SectionStructure | null)[] = [];
  for (const s of sections) {
    const selector = side === 'framer' ? s.framerSelector : `.${s.elementorClass}`;
    const struct = await page.evaluate(
      ({ sel, sideLabel }) => {
        const root = document.querySelector(sel);
        if (!root) return null;
        const headings: string[] = [];
        root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => headings.push(h.tagName.toLowerCase()));
        const buttons = root.querySelectorAll('button, a[href], .elementor-button').length;
        const images = root.querySelectorAll('img').length;
        const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
        let maxDepth = 0;
        const walk = (el: Element, d: number) => {
          maxDepth = Math.max(maxDepth, d);
          for (const c of Array.from(el.children)) walk(c as Element, d + 1);
        };
        walk(root, 0);
        return {
          label: '',
          side: sideLabel,
          childCount: root.children.length,
          maxDepth,
          textLength: text.length,
          headings,
          buttonCount: buttons,
          imageCount: images,
          textPreview: text.slice(0, 200),
        };
      },
      { sel: selector, sideLabel: side },
    );
    if (struct) {
      struct.label = s.label;
      struct.side = side;
    }
    out.push(struct);
  }
  await page.close();
  return out;
}

function compareStructure(label: string, f: SectionStructure | null, e: SectionStructure | null): SectionDiff {
  const matches = {
    childCount: !!f && !!e && Math.abs(f.childCount - e.childCount) <= 1,
    headings: !!f && !!e && JSON.stringify(f.headings) === JSON.stringify(e.headings),
    buttonCount: !!f && !!e && f.buttonCount === e.buttonCount,
    imageCount: !!f && !!e && Math.abs(f.imageCount - e.imageCount) <= 1,
  };
  const deltas: string[] = [];
  if (!f) deltas.push('framer section not found');
  if (!e) deltas.push('elementor section not found');
  if (f && e) {
    if (!matches.childCount) deltas.push(`childCount: framer=${f.childCount} elementor=${e.childCount}`);
    if (!matches.headings) deltas.push(`headings: framer=[${f.headings.join(',')}] elementor=[${e.headings.join(',')}]`);
    if (!matches.buttonCount) deltas.push(`buttons: framer=${f.buttonCount} elementor=${e.buttonCount}`);
    if (!matches.imageCount) deltas.push(`images: framer=${f.imageCount} elementor=${e.imageCount}`);
  }
  return {
    label,
    framer: f,
    elementor: e,
    matches,
    match: Object.values(matches).every(Boolean) && f && e ? true : false,
    deltas,
  };
}

/** Format a SectionDiff[] as a human-readable report. */
export function formatStructureDiff(diffs: SectionDiff[]): string {
  const lines: string[] = ['Structure Diff (Framer vs Elementor)'];
  const passed = diffs.filter((d) => d.match).length;
  lines.push(`${passed}/${diffs.length} sections match structurally`);
  lines.push('');
  for (const d of diffs) {
    const status = d.match ? 'MATCH' : 'DIFF';
    lines.push(`[${status}] ${d.label}`);
    for (const delta of d.deltas) lines.push(`    ${delta}`);
    if (d.framer && d.elementor) {
      lines.push(`    framer:   children=${d.framer.childCount} depth=${d.framer.maxDepth} headings=[${d.framer.headings.join(',')}] btns=${d.framer.buttonCount} imgs=${d.framer.imageCount}`);
      lines.push(`    elementor: children=${d.elementor.childCount} depth=${d.elementor.maxDepth} headings=[${d.elementor.headings.join(',')}] btns=${d.elementor.buttonCount} imgs=${d.elementor.imageCount}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
