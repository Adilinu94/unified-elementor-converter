/**
 * Reconcile the target's Elementor breakpoints with the source's own bands.
 *
 * ## The measured failure
 *
 * A converted page carried 370 correct breakpoint-suffixed settings — the
 * emitter wrote `typography_font_size_tablet: 56px` where the source renders
 * 56px — and the rendered page still showed the wrong size at most widths.
 *
 * Sweeping both pages across the disputed range (h1 font-size, source vs target):
 *
 * | width | source | target | |
 * |-------|--------|--------|--|
 * | 1250  | 72px   | 72px   | match |
 * | 1200  | 72px   | 72px   | match |
 * | 1150  | 56px   | 72px   | MISMATCH |
 * | 1100  | 56px   | 72px   | MISMATCH |
 * | 1024  | 56px   | 56px   | match |
 * |  800  | 56px   | 56px   | match |
 * |  768  | 56px   | 56px   | match |
 * |  760  | 56px   | 40px   | MISMATCH |
 * |  700  | 40px   | 40px   | match |
 * |  390  | 40px   | 40px   | match |
 *
 * The values are right; the WIDTHS they activate at are not. The live kit
 * (`_elementor_page_settings` on the active kit, id 209) declared Elementor's
 * stock `viewport_md: 768` / `viewport_lg: 1025`, while the source's bands are
 * `<760 / 760–1199 / ≥1200`. So between 1025 and 1199 Elementor still serves
 * desktop while the source has already switched to tablet, and at 760–767
 * Elementor serves mobile while the source is still tablet.
 *
 * A responsive override is therefore only half a deliverable: the suffix says
 * WHAT, the kit says WHEN, and writing one without the other produces a page
 * that is correct at three widths and wrong between them.
 *
 * ## Elementor's band semantics
 *
 * Verified against the live kit's own keys:
 *
 * ```
 * mobile  : width <  viewport_md
 * tablet  : viewport_md ≤ width < viewport_lg
 * desktop : width ≥ viewport_lg
 * ```
 *
 * so `viewport_md` is the TABLET's lower bound and `viewport_lg` is the
 * DESKTOP's lower bound. Both are lower bounds, which is why a source band list
 * maps onto them directly and needs no ±1 arithmetic.
 *
 * @module core/elementor/kit-breakpoints
 */

/** Elementor's two adjustable band boundaries, as the kit stores them. */
export interface KitViewports {
  /** Lower bound of the tablet band. Below this, Elementor serves mobile. */
  viewport_md: number;
  /** Lower bound of the desktop band. */
  viewport_lg: number;
}

export type KitBreakpointVerdict = 'match' | 'mismatch' | 'not-derivable';

export interface KitBreakpointReconciliation {
  verdict: KitBreakpointVerdict;
  /** What the kit must declare for the source's bands to activate correctly. */
  required?: KitViewports;
  /** What the kit declares now, when it was readable. */
  actual?: KitViewports;
  /**
   * Widths at which the two disagree about which band applies.
   *
   * Reported as ranges rather than a boolean because the size of the wrong
   * region is the whole severity signal: a 1px disagreement is noise, and the
   * measured 175px one (1025–1199) covers most laptop widths.
   */
  disagreementRanges: Array<{ from: number; to: number; kitBand: string; sourceBand: string }>;
  reason: string;
}

/**
 * The kit settings a source's breakpoint widths require.
 *
 * Takes the widths the source itself declares — the same list
 * `deriveViewportsFromBreakpoints` produces — and returns the two kit values
 * that make Elementor's bands coincide with them.
 *
 * Fewer than three bands is not an error: a source with one breakpoint has no
 * tablet band, and inventing one would move a boundary the author never set. It
 * is reported as `not-derivable` so the caller states that rather than guessing.
 */
export function requiredKitViewports(sourceWidths: readonly number[]): KitViewports | undefined {
  const sorted = [...new Set(sourceWidths)].sort((left, right) => right - left);
  if (sorted.length < 3) return undefined;
  // Widest first: [desktop, tablet, mobile]. The desktop and tablet widths ARE
  // the lower bounds of their bands, so they map onto the kit keys unchanged.
  return { viewport_lg: sorted[0]!, viewport_md: sorted[1]! };
}

/** Which band a width falls into, under the given kit values. */
export function bandAt(width: number, viewports: KitViewports): 'mobile' | 'tablet' | 'desktop' {
  if (width >= viewports.viewport_lg) return 'desktop';
  if (width >= viewports.viewport_md) return 'tablet';
  return 'mobile';
}

/**
 * Compare what the source needs against what the target declares.
 *
 * The disagreement ranges are computed by walking the union of both boundary
 * sets rather than every integer width: the band function is piecewise constant,
 * so a change can only occur at a boundary, and walking 1px at a time would
 * produce the same answer at 2000x the cost.
 */
export function reconcileKitBreakpoints(
  sourceWidths: readonly number[],
  actual: KitViewports | undefined,
): KitBreakpointReconciliation {
  const required = requiredKitViewports(sourceWidths);

  if (required === undefined) {
    return {
      verdict: 'not-derivable',
      ...(actual !== undefined ? { actual } : {}),
      disagreementRanges: [],
      reason:
        `the source declares ${new Set(sourceWidths).size} breakpoint band(s); Elementor's two `
        + 'adjustable boundaries need three to be derived without inventing one',
    };
  }

  if (actual === undefined) {
    return {
      verdict: 'not-derivable',
      required,
      disagreementRanges: [],
      reason: 'the target kit\'s viewport settings could not be read, so no comparison was possible',
    };
  }

  if (actual.viewport_md === required.viewport_md && actual.viewport_lg === required.viewport_lg) {
    return {
      verdict: 'match',
      required,
      actual,
      disagreementRanges: [],
      reason: `the kit already declares viewport_md=${actual.viewport_md}, viewport_lg=${actual.viewport_lg}`,
    };
  }

  return {
    verdict: 'mismatch',
    required,
    actual,
    disagreementRanges: disagreements(required, actual),
    reason:
      `the kit declares viewport_md=${actual.viewport_md}, viewport_lg=${actual.viewport_lg} but the `
      + `source's bands need viewport_md=${required.viewport_md}, viewport_lg=${required.viewport_lg}; `
      + 'every breakpoint-suffixed setting therefore activates at the wrong width',
  };
}

/** Contiguous width ranges where the two band functions differ. */
function disagreements(
  required: KitViewports,
  actual: KitViewports,
): KitBreakpointReconciliation['disagreementRanges'] {
  const boundaries = [...new Set([
    required.viewport_md,
    required.viewport_lg,
    actual.viewport_md,
    actual.viewport_lg,
  ])].sort((left, right) => left - right);

  const ranges: KitBreakpointReconciliation['disagreementRanges'] = [];
  for (let index = 0; index < boundaries.length; index++) {
    const from = boundaries[index]!;
    // The last segment is open-ended upward; both functions agree there because
    // the higher of the two `viewport_lg` values makes both say `desktop`.
    const to = index + 1 < boundaries.length ? boundaries[index + 1]! - 1 : Number.POSITIVE_INFINITY;
    const kitBand = bandAt(from, actual);
    const sourceBand = bandAt(from, required);
    if (kitBand === sourceBand) continue;
    if (!Number.isFinite(to)) continue;
    ranges.push({ from, to, kitBand, sourceBand });
  }

  // Below the lowest boundary both functions say `mobile`, so that region is
  // never a disagreement and is deliberately not walked.
  return mergeAdjacent(ranges);
}

/** Join ranges that touch and carry the same verdict pair. */
function mergeAdjacent(
  ranges: KitBreakpointReconciliation['disagreementRanges'],
): KitBreakpointReconciliation['disagreementRanges'] {
  const merged: KitBreakpointReconciliation['disagreementRanges'] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined
      && previous.to + 1 === range.from
      && previous.kitBand === range.kitBand
      && previous.sourceBand === range.sourceBand
    ) {
      previous.to = range.to;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/** One block for a run report or the CLI. */
export function formatKitBreakpointReconciliation(result: KitBreakpointReconciliation): string {
  const lines = [`Kit breakpoints: ${result.verdict.toUpperCase()} — ${result.reason}`];
  for (const range of result.disagreementRanges) {
    lines.push(
      `  ${range.from}–${range.to}px: the kit serves ${range.kitBand} where the source serves ${range.sourceBand}`,
    );
  }
  return lines.join('\n');
}
