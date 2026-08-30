/**
 * Kit breakpoints — the WHEN that a responsive suffix does not carry.
 *
 * ## The measured failure these tests encode
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
 * |  768  | 56px   | 56px   | match |
 * |  760  | 56px   | 40px   | MISMATCH |
 * |  700  | 40px   | 40px   | match |
 *
 * The live kit (id 209) declared Elementor's stock `viewport_md: 768` /
 * `viewport_lg: 1025`; the source's bands are `<760 / 760–1199 / ≥1200`.
 */

import { describe, expect, it } from 'vitest';
import {
  bandAt,
  formatKitBreakpointReconciliation,
  reconcileKitBreakpoints,
  requiredKitViewports,
} from '@elconv/core';

/** The real source bands of the measured page. */
const SOURCE_WIDTHS = [1200, 760, 390];
/** What the live kit actually declared. */
const STOCK_KIT = { viewport_md: 768, viewport_lg: 1025 };

describe('requiredKitViewports', () => {
  it('maps the source bands onto the two kit boundaries unchanged', () => {
    // Both kit keys are LOWER bounds, and so are the source's band widths, so
    // the mapping needs no ±1 arithmetic.
    expect(requiredKitViewports(SOURCE_WIDTHS)).toEqual({ viewport_md: 760, viewport_lg: 1200 });
  });

  it('sorts widest-first regardless of input order', () => {
    expect(requiredKitViewports([390, 1200, 760])).toEqual({ viewport_md: 760, viewport_lg: 1200 });
  });

  it('derives nothing from fewer than three bands', () => {
    // Elementor has exactly two adjustable boundaries. A source with one
    // breakpoint has no tablet band, and inventing one moves a boundary the
    // author never set.
    expect(requiredKitViewports([1200, 390])).toBeUndefined();
    expect(requiredKitViewports([1200])).toBeUndefined();
  });
});

describe('bandAt', () => {
  it('treats both kit values as lower bounds', () => {
    expect(bandAt(1025, STOCK_KIT)).toBe('desktop');
    expect(bandAt(1024, STOCK_KIT)).toBe('tablet');
    expect(bandAt(768, STOCK_KIT)).toBe('tablet');
    expect(bandAt(767, STOCK_KIT)).toBe('mobile');
  });
});

describe('reconcileKitBreakpoints', () => {
  it('names the two measured disagreement ranges', () => {
    const result = reconcileKitBreakpoints(SOURCE_WIDTHS, STOCK_KIT);

    expect(result.verdict).toBe('mismatch');
    expect(result.required).toEqual({ viewport_md: 760, viewport_lg: 1200 });

    // 760–767: the kit serves mobile, the source is still tablet.
    // 1025–1199: the kit serves desktop, the source has switched to tablet.
    // Both were confirmed by browser sweep — 760px and 1150px both mismatched.
    expect(result.disagreementRanges).toEqual([
      { from: 760, to: 767, kitBand: 'mobile', sourceBand: 'tablet' },
      { from: 1025, to: 1199, kitBand: 'desktop', sourceBand: 'tablet' },
    ]);
  });

  it('covers the widths that actually mismatched in the browser', () => {
    const { disagreementRanges } = reconcileKitBreakpoints(SOURCE_WIDTHS, STOCK_KIT);
    const covered = (width: number): boolean =>
      disagreementRanges.some((range) => width >= range.from && width <= range.to);

    // Measured MISMATCH.
    expect(covered(1150)).toBe(true);
    expect(covered(1100)).toBe(true);
    expect(covered(760)).toBe(true);
    // Measured match — must not be reported as broken.
    expect(covered(1250)).toBe(false);
    expect(covered(1200)).toBe(false);
    expect(covered(1024)).toBe(false);
    expect(covered(768)).toBe(false);
    expect(covered(700)).toBe(false);
    expect(covered(390)).toBe(false);
  });

  it('reports a match without any range when the kit already agrees', () => {
    const result = reconcileKitBreakpoints(SOURCE_WIDTHS, { viewport_md: 760, viewport_lg: 1200 });
    expect(result.verdict).toBe('match');
    expect(result.disagreementRanges).toEqual([]);
  });

  it('says what is required even when the kit could not be read', () => {
    // A build should still be able to state the target configuration it needs.
    const result = reconcileKitBreakpoints(SOURCE_WIDTHS, undefined);
    expect(result.verdict).toBe('not-derivable');
    expect(result.required).toEqual({ viewport_md: 760, viewport_lg: 1200 });
    expect(result.reason).toContain('could not be read');
  });

  it('does not claim a mismatch it cannot prove', () => {
    const result = reconcileKitBreakpoints([1200, 390], STOCK_KIT);
    expect(result.verdict).toBe('not-derivable');
    expect(result.disagreementRanges).toEqual([]);
    expect(result.actual).toEqual(STOCK_KIT);
  });

  it('reports one range when only the tablet bound differs', () => {
    const result = reconcileKitBreakpoints([1200, 800, 390], { viewport_md: 768, viewport_lg: 1200 });
    expect(result.disagreementRanges).toEqual([
      { from: 768, to: 799, kitBand: 'tablet', sourceBand: 'mobile' },
    ]);
  });

  it('never reports a disagreement below the lowest boundary', () => {
    // Both band functions say `mobile` there, at every kit setting.
    const { disagreementRanges } = reconcileKitBreakpoints(SOURCE_WIDTHS, STOCK_KIT);
    expect(disagreementRanges.every((range) => range.from >= 760)).toBe(true);
  });
});

describe('formatKitBreakpointReconciliation', () => {
  it('states the verdict and every affected range', () => {
    const text = formatKitBreakpointReconciliation(
      reconcileKitBreakpoints(SOURCE_WIDTHS, STOCK_KIT),
    );
    expect(text).toContain('MISMATCH');
    expect(text).toContain('1025–1199px');
    expect(text).toContain('the kit serves desktop where the source serves tablet');
  });
});
