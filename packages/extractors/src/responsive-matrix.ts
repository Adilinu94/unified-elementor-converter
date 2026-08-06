/**
 * Responsive Matrix — P1-4
 *
 * Generates a structured diff of CSS property changes across the three standard
 * breakpoints (desktop 1440 / tablet 768 / mobile 390).
 *
 * Input: the `computedStyles` field from ExtractionResult, which is already
 * populated by `walkComputedStylesMultiViewport` when `detectResponsiveStyles`
 * is enabled during extraction.
 *
 * Output: responsive-matrix.json with per-element property diffs.
 *
 * Use case: the V3/V4 builder reads this to know which Elementor responsive
 * breakpoint overrides (tablet/mobile columns, font-sizes, paddings) to emit.
 *
 * Only properties that DIFFER across at least two viewports are included —
 * unchanged properties are omitted to keep the report small and actionable.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ComputedStyleSnapshot } from './browser/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Property value at each viewport label. `changed: true` when not all equal. */
export type PropertyMatrix = Record<string, string | boolean> & {
  changed: boolean;
};

export interface ElementMatrix {
  selector: string;
  tag: string;
  /** Only properties that differ across at least 2 viewports. */
  properties: Record<string, PropertyMatrix>;
  /** How many properties changed for this element. */
  changeCount: number;
}

export interface ResponsiveMatrixSummary {
  elementsScanned: number;
  elementsWithChanges: number;
  totalChanges: number;
  /** Top 10 most-changed properties (descending frequency). */
  mostChangedProperties: string[];
}

export interface ResponsiveMatrix {
  sourceUrl: string;
  generatedAt: string;
  /** Ordered viewport labels present in the data (e.g. ['desktop','tablet','mobile']). */
  viewportLabels: string[];
  /** Viewport widths indexed by label. */
  breakpoints: Record<string, number | null>;
  elements: ElementMatrix[];
  summary: ResponsiveMatrixSummary;
}

// ---------------------------------------------------------------------------
// Properties compared in the matrix (subset that commonly change across BPs)
// ---------------------------------------------------------------------------

const RESPONSIVE_PROPS = new Set([
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'width',
  'height',
  'max-width',
  'min-width',
  'max-height',
  'min-height',
  'display',
  'flex-direction',
  'flex-wrap',
  'grid-template-columns',
  'grid-template-rows',
  'column-gap',
  'row-gap',
  'gap',
  'position',
  'top',
  'left',
  'right',
  'bottom',
  'order',
  'align-items',
  'justify-content',
  'overflow',
  'white-space',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a ResponsiveMatrix from multi-viewport computed-style snapshots.
 *
 * @param snapshots  - Record keyed by viewport label ('desktop'|'tablet'|'mobile')
 *                     to arrays of ComputedStyleSnapshot for that viewport.
 * @param sourceUrl  - The URL the snapshots were captured from.
 */
export function buildResponsiveMatrix(
  snapshots: Record<string, ComputedStyleSnapshot[]>,
  sourceUrl: string,
): ResponsiveMatrix {
  const viewportLabels = Object.keys(snapshots);
  const generatedAt = new Date().toISOString();

  if (viewportLabels.length < 2) {
    return {
      sourceUrl,
      generatedAt,
      viewportLabels,
      breakpoints: guessBreakpoints(viewportLabels),
      elements: [],
      summary: {
        elementsScanned: 0,
        elementsWithChanges: 0,
        totalChanges: 0,
        mostChangedProperties: [],
      },
    };
  }

  // Index each viewport's snapshots by selector for O(1) lookup
  const byLabel = new Map<string, Map<string, ComputedStyleSnapshot>>();
  for (const [label, snaps] of Object.entries(snapshots)) {
    const bySelector = new Map<string, ComputedStyleSnapshot>();
    for (const s of snaps) {
      bySelector.set(s.selector, s);
    }
    byLabel.set(label, bySelector);
  }

  // Collect all selectors across all viewports
  const allSelectors = new Set<string>();
  for (const sMap of byLabel.values()) {
    for (const sel of sMap.keys()) {
      allSelectors.add(sel);
    }
  }

  // Build element matrix entries — only for elements present in 2+ viewports
  const elements: ElementMatrix[] = [];
  const propFreq = new Map<string, number>(); // property change frequency

  for (const selector of allSelectors) {
    // Get snapshots for this selector across all viewports
    const perLabel: Record<string, ComputedStyleSnapshot | undefined> = {};
    let presenceCount = 0;
    for (const label of viewportLabels) {
      const snap = byLabel.get(label)?.get(selector);
      perLabel[label] = snap;
      if (snap) presenceCount++;
    }
    if (presenceCount < 2) continue; // only in one viewport → skip

    // Pick a reference snapshot for tag
    const ref = viewportLabels.map((l) => perLabel[l]).find((s) => s !== undefined);
    if (!ref) continue;

    // Build per-property diff
    const propMatrix: Record<string, PropertyMatrix> = {};
    let changeCount = 0;

    for (const prop of RESPONSIVE_PROPS) {
      const values: Record<string, string> = {};
      let hasValue = false;
      for (const label of viewportLabels) {
        const snap = perLabel[label];
        const val = snap?.styles[prop];
        if (val !== undefined) {
          values[label] = val;
          hasValue = true;
        }
      }
      if (!hasValue) continue;

      // Fill missing labels with '' for comparison
      const filled: Record<string, string> = {};
      for (const label of viewportLabels) {
        filled[label] = values[label] ?? '';
      }

      const uniqueValues = new Set(Object.values(filled));
      const changed = uniqueValues.size > 1;

      if (!changed) continue; // skip identical properties

      propMatrix[prop] = { ...filled, changed } as PropertyMatrix;
      changeCount++;
      propFreq.set(prop, (propFreq.get(prop) ?? 0) + 1);
    }

    if (changeCount === 0) continue; // nothing changed for this element → skip

    elements.push({ selector, tag: ref.tag, properties: propMatrix, changeCount });
  }

  // Sort: most-changed elements first
  elements.sort((a, b) => b.changeCount - a.changeCount);

  // Top 10 most-changed properties
  const mostChangedProperties = [...propFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([prop]) => prop);

  const summary: ResponsiveMatrixSummary = {
    elementsScanned: allSelectors.size,
    elementsWithChanges: elements.length,
    totalChanges: elements.reduce((acc, e) => acc + e.changeCount, 0),
    mostChangedProperties,
  };

  return {
    sourceUrl,
    generatedAt,
    viewportLabels,
    breakpoints: guessBreakpoints(viewportLabels),
    elements,
    summary,
  };
}

/**
 * Build the matrix and write it to `outputDir/responsive-matrix.json`.
 * Returns the written file path.
 */
export async function writeResponsiveMatrix(
  snapshots: Record<string, ComputedStyleSnapshot[]>,
  outputDir: string,
  sourceUrl: string,
): Promise<string> {
  const matrix = buildResponsiveMatrix(snapshots, sourceUrl);
  const outPath = path.join(outputDir, 'responsive-matrix.json');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(matrix, null, 2), 'utf-8');
  process.stdout.write(
    `[responsive-matrix] ✓ ${matrix.summary.elementsWithChanges} elements with changes → ${outPath}\n`,
  );
  return outPath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessBreakpoints(labels: string[]): Record<string, number | null> {
  const KNOWN: Record<string, number> = {
    desktop: 1440,
    tablet: 768,
    mobile: 390,
    wide: 1920,
    lg: 1024,
    md: 768,
    sm: 390,
  };
  const result: Record<string, number | null> = {};
  for (const label of labels) {
    result[label] = KNOWN[label] ?? null;
  }
  return result;
}
