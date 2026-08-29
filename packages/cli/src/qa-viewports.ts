/**
 * QA capture viewports, derived from the reference source instead of guessed.
 *
 * ## What was measured
 *
 * `elconv qa` compared a converted page against its Framer reference at the
 * repo-wide default widths 1440 / 768 / 390. The reference's own breakpoint
 * payload says something else:
 *
 * ```
 * [{"mediaQuery":"(min-width: 1200px)"},
 *  {"mediaQuery":"(min-width: 810px) and (max-width: 1199.98px)"},
 *  {"mediaQuery":"(max-width: 809.98px)"}]
 * ```
 *
 * The band boundary is 810px, not 768px. Driving the reference across it
 * confirms two different layouts:
 *
 * | width | documentHeight | h1 font-size |
 * |-------|----------------|--------------|
 * | 1440  | 16612          | 150px        |
 * | 810   | 17529          | 120px        |
 * | 809   | 10190          | 52px         |
 * | 768   | 10060          | 52px         |
 *
 * So the "tablet" score at 768px was comparing the reference's PHONE variant
 * against the target's desktop layout. The resulting number is not a fidelity
 * measurement of anything — it is an artefact of probing the wrong side of a
 * boundary the source declared and we ignored.
 *
 * ## Why a plain fetch rather than the browser probe
 *
 * `deriveViewportsFromBreakpoints` already exists and is already tested; what
 * was missing is a caller on the QA path. Its input is the `__framer__breakpoints`
 * payload, which Framer server-renders — verified present in the raw 627,198-byte
 * HTML response, no hydration required. A fetch is therefore sufficient, and it
 * keeps viewport resolution off the Playwright path so a browser failure cannot
 * silently reinstate the wrong widths.
 *
 * ## Honesty contract
 *
 * The resolution always reports WHERE the widths came from. A source that
 * declares no breakpoints falls back to the repo defaults with a warning, and
 * that warning reaches the QA report — a fallback must never look like a
 * measurement.
 */

import { conventionalViewportHeight, deriveViewportsFromBreakpoints } from '@elconv/extractors';

/**
 * The label vocabulary the diff pipeline can carry.
 *
 * Not a free string: `ViewportScreenshot.viewport` in core and
 * `CanonicalLiveDiffViewport.label` in the QA package are both this closed
 * union, so a label outside it cannot reach a diff report at all.
 */
export type QaViewportLabel = 'wide' | 'desktop' | 'tablet' | 'mobile';

export interface QaViewport {
  label: QaViewportLabel;
  width: number;
  height: number;
}

/** Where a viewport list came from. Reported so a fallback is never mistaken for source data. */
export type QaViewportSource = 'caller' | 'source-breakpoints' | 'fallback';

export interface ResolvedQaViewports {
  viewports: QaViewport[];
  source: QaViewportSource;
  warnings: string[];
}

/**
 * Repo defaults, used only when nothing better is knowable.
 *
 * Kept as a last resort rather than a starting point: for any project whose
 * bands do not happen to match these numbers, they test layouts the site never
 * shows at those widths.
 */
export const QA_FALLBACK_VIEWPORTS: readonly QaViewport[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile', width: 390, height: 844 },
];

/**
 * Names for a band list, chosen by how many bands there are.
 *
 * Widest first throughout. Two bands are a desktop/mobile pair rather than
 * desktop/tablet, because a source with one breakpoint splits at a phone
 * boundary far more often than at a tablet one — and a wrong name here would
 * put a phone capture in a directory called `tablet`.
 */
const LABELS_BY_COUNT: Readonly<Record<number, readonly QaViewportLabel[]>> = {
  1: ['desktop'],
  2: ['desktop', 'mobile'],
  3: ['desktop', 'tablet', 'mobile'],
  4: ['wide', 'desktop', 'tablet', 'mobile'],
};

const MAX_LABELLED_BANDS = 4;

/**
 * Read Framer's server-rendered breakpoint payload out of a raw HTML document.
 *
 * Matched on the script id rather than on position or content, because that id
 * is the contract Framer's own runtime reads. Returns `null` when the document
 * is not a Framer render, which is the normal case for any other source.
 */
export function readFramerBreakpointsFromHtml(html: string): string | null {
  const pattern = new RegExp(
    '<script[^>]*id=["\']__framer__breakpoints["\'][^>]*>([\\s\\S]*?)</script>',
  );
  const match = pattern.exec(html);
  return match ? match[1]! : null;
}

/** Fetch a document body. Injectable so the resolution is testable without a network. */
export type HtmlFetcher = (url: string) => Promise<string>;

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

async function fetchHtmlDefault(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveQaViewportsOptions {
  /** Reference URL whose breakpoints decide the widths. Absent for a capture-only run. */
  refUrl?: string;
  /** Explicit widths from `--viewports`. An instruction, so it always wins. */
  explicitWidths?: readonly number[];
  fetchHtml?: HtmlFetcher;
}

/**
 * Decide which widths to capture at.
 *
 * Precedence is deliberate: an explicit `--viewports` is an instruction and
 * overrides everything; otherwise the reference's own breakpoints decide;
 * only with neither do the repo defaults apply.
 */
export async function resolveQaViewports(
  options: ResolveQaViewportsOptions,
): Promise<ResolvedQaViewports> {
  if (options.explicitWidths && options.explicitWidths.length > 0) {
    const labelled = labelWidths(options.explicitWidths);
    return {
      viewports: labelled.viewports,
      source: 'caller',
      warnings: labelled.warnings,
    };
  }

  if (!options.refUrl) {
    return {
      viewports: [...QA_FALLBACK_VIEWPORTS],
      source: 'fallback',
      warnings: ['no reference URL, so no source breakpoints; using the repo default widths'],
    };
  }

  const fetchHtml = options.fetchHtml ?? fetchHtmlDefault;
  let html: string;
  try {
    html = await fetchHtml(options.refUrl);
  } catch (error) {
    return {
      viewports: [...QA_FALLBACK_VIEWPORTS],
      source: 'fallback',
      warnings: [
        `could not read the reference document to derive breakpoints `
          + `(${error instanceof Error ? error.message : String(error)}); using the repo default widths`,
      ],
    };
  }

  const payload = readFramerBreakpointsFromHtml(html);
  const derived = deriveViewportsFromBreakpoints(payload);
  if (derived.viewports.length === 0) {
    return {
      viewports: [...QA_FALLBACK_VIEWPORTS],
      source: 'fallback',
      warnings: [...derived.warnings, 'using the repo default widths instead'],
    };
  }

  // Re-label from the width list rather than reusing the probe's labels: the
  // probe names the first three bands desktop/tablet/mobile regardless of how
  // many there are, which would call a two-band source's phone width "tablet".
  const labelled = labelWidths(derived.viewports.map((viewport) => viewport.width));
  return {
    viewports: labelled.viewports,
    source: 'source-breakpoints',
    warnings: [...derived.warnings, ...labelled.warnings],
  };
}

/**
 * Label a width list, widest first.
 *
 * More than four bands cannot be carried: the diff pipeline's viewport field is
 * a four-value union, so the extra bands are dropped — reported as a warning,
 * because silently narrowing the measured surface is exactly the kind of quiet
 * loss the charter forbids.
 */
export function labelWidths(widths: readonly number[]): { viewports: QaViewport[]; warnings: string[] } {
  const sorted = [...new Set(widths)].sort((a, b) => b - a);
  const warnings: string[] = [];

  let kept = sorted;
  if (sorted.length > MAX_LABELLED_BANDS) {
    kept = sorted.slice(0, MAX_LABELLED_BANDS);
    warnings.push(
      `the source declares ${sorted.length} breakpoint bands but the diff pipeline carries at most `
        + `${MAX_LABELLED_BANDS}; captured ${kept.join(', ')}px and SKIPPED `
        + `${sorted.slice(MAX_LABELLED_BANDS).join(', ')}px`,
    );
  }

  const labels = LABELS_BY_COUNT[kept.length] ?? LABELS_BY_COUNT[MAX_LABELLED_BANDS]!;
  return {
    viewports: kept.map((width, index) => ({
      label: labels[index]!,
      width,
      height: conventionalViewportHeight(width),
    })),
    warnings,
  };
}

/**
 * Parse a `--viewports 1200,810,390` flag value.
 *
 * A malformed entry is rejected rather than silently dropped: a typo that
 * quietly removed a viewport would shrink the measured surface without saying so.
 */
export function parseViewportWidths(raw: string | undefined): number[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const widths = raw.split(',').map((part) => {
    const value = Number(part.trim());
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(`--viewports: "${part.trim()}" is not a positive integer pixel width`);
    }
    return value;
  });
  return widths;
}
