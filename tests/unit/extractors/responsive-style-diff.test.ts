/**
 * Per-viewport style diff — the only possible source of a responsive override.
 *
 * ## Why the comparison exists
 *
 * Framer returns its non-primary breakpoints as EMPTY stubs. Verified against
 * the live MCP (2026-08-29) by asking `getNodeXml` for the two variant roots of
 * the Ordina home page directly:
 *
 * ```
 * Tablet (lqBlLakCk, 760px) → 620 bytes, 0 children
 * Phone  (m6quUCEMD, 390px) → 619 bytes, 0 children
 * ```
 *
 * with the server's own note: *"This is a replica node (variant). Only update a
 * few attributes on variants."* There is no second call that returns the tablet
 * layout, so the override exists nowhere but in the rendered page.
 *
 * ## The measured numbers these tests encode
 *
 * On the Ordina page at its own breakpoints (1200 / 760 / 390), comparing the
 * three captures produced 104 overridden nodes at tablet and 166 at mobile, and
 * the emitted IR carried font-size chains that match the browser exactly:
 * `72 → 56 → 40px` for the h1, `20 → 19 → 18px` for an h3.
 *
 * The tree shapes are NOT equal across viewports — 690 named nodes at desktop
 * against 746 at tablet and 754 at mobile, because Framer renders extra variant
 * overlays at narrower widths. That is why pairing is by name anchors and why an
 * unpaired position must be counted rather than assumed.
 */

import { describe, expect, it } from 'vitest';
import {
  diffResponsiveStyles,
  formatResponsiveDiffReport,
} from '../../../packages/extractors/src/framer/responsive-style-diff.js';
import type { LiveDomNode } from '../../../packages/extractors/src/framer/component-expansion.js';

function node(overrides: Partial<LiveDomNode> = {}): LiveDomNode {
  return {
    tag: 'div',
    bbox: { x: 0, y: 0, width: 100, height: 40 },
    children: [],
    ...overrides,
  };
}

describe('diffResponsiveStyles', () => {
  it('records a property whose value differs at the narrower viewport', () => {
    const desktop = [node({ framerName: 'Hero', styles: { padding: '40px', gap: '16px' } })];
    const mobile = [node({ framerName: 'Hero', styles: { padding: '20px', gap: '16px' } })];

    const { roots, report } = diffResponsiveStyles(
      { label: 'desktop', roots: desktop },
      [{ label: 'mobile', roots: mobile }],
    );

    // Only `padding` changed; `gap` is identical and must not be re-emitted as
    // an override, which would write a mobile value that changes nothing.
    expect(roots[0]!.responsiveStyles).toEqual({ mobile: { padding: '20px' } });
    expect(report.nodesWithOverrides.mobile).toBe(1);
    expect(report.changedProperties.mobile).toEqual({ padding: 1 });
  });

  it('carries the measured font-size chain 72 → 56 → 40px', () => {
    // The real h1 of the Ordina page. This chain was ZERO-length until the
    // capture started reading typography from the element that renders the text.
    const desktop = [node({ framerName: 'Title', styles: { 'font-size': '72px' } })];
    const tablet = [node({ framerName: 'Title', styles: { 'font-size': '56px' } })];
    const mobile = [node({ framerName: 'Title', styles: { 'font-size': '40px' } })];

    const { roots } = diffResponsiveStyles(
      { label: 'desktop', roots: desktop },
      [{ label: 'tablet', roots: tablet }, { label: 'mobile', roots: mobile }],
    );

    expect(roots[0]!.responsiveStyles).toEqual({
      tablet: { 'font-size': '56px' },
      mobile: { 'font-size': '40px' },
    });
  });

  it('leaves a node alone when nothing changed', () => {
    const styles = { padding: '40px' };
    const { roots, report } = diffResponsiveStyles(
      { label: 'desktop', roots: [node({ framerName: 'Same', styles })] },
      [{ label: 'mobile', roots: [node({ framerName: 'Same', styles })] }],
    );

    expect(roots[0]!.responsiveStyles).toBeUndefined();
    expect(report.nodesWithOverrides.mobile).toBe(0);
  });

  it('does not mutate the input capture', () => {
    const desktop = [node({ framerName: 'Hero', styles: { padding: '40px' } })];
    diffResponsiveStyles(
      { label: 'desktop', roots: desktop },
      [{ label: 'mobile', roots: [node({ framerName: 'Hero', styles: { padding: '20px' } })] }],
    );
    expect(desktop[0]!.responsiveStyles).toBeUndefined();
  });

  it('descends into children', () => {
    const desktop = [node({
      framerName: 'Section',
      styles: { padding: '80px' },
      children: [node({ framerName: 'Heading', styles: { 'font-size': '48px' } })],
    })];
    const mobile = [node({
      framerName: 'Section',
      styles: { padding: '24px' },
      children: [node({ framerName: 'Heading', styles: { 'font-size': '32px' } })],
    })];

    const { roots, report } = diffResponsiveStyles(
      { label: 'desktop', roots: desktop },
      [{ label: 'mobile', roots: mobile }],
    );

    expect(roots[0]!.responsiveStyles).toEqual({ mobile: { padding: '24px' } });
    expect(roots[0]!.children[0]!.responsiveStyles).toEqual({ mobile: { 'font-size': '32px' } });
    expect(report.nodesWithOverrides.mobile).toBe(2);
  });

  it('pairs by name anchor when the narrower viewport renders an extra node', () => {
    // Measured: 690 named nodes at desktop, 754 at mobile. A strict index walk
    // would shift every node after the extra one and attribute the wrong values.
    const desktop = [node({
      framerName: 'Row',
      children: [
        node({ framerName: 'Left', styles: { padding: '40px' } }),
        node({ framerName: 'Right', styles: { padding: '40px' } }),
      ],
    })];
    const mobile = [node({
      framerName: 'Row',
      children: [
        node({ framerName: 'Left', styles: { padding: '20px' } }),
        node({ framerName: 'Overlay', styles: { padding: '0px' } }),
        node({ framerName: 'Right', styles: { padding: '10px' } }),
      ],
    })];

    const { roots } = diffResponsiveStyles(
      { label: 'desktop', roots: desktop },
      [{ label: 'mobile', roots: mobile }],
    );

    // Each name found its own counterpart; `Right` did NOT take `Overlay`'s 0px.
    expect(roots[0]!.children[0]!.responsiveStyles).toEqual({ mobile: { padding: '20px' } });
    expect(roots[0]!.children[1]!.responsiveStyles).toEqual({ mobile: { padding: '10px' } });
  });

  it('pairs an unambiguous position by order even when the names differ', () => {
    // Deliberate, and it is why the aligner is shared with the section and
    // instance layers: a rendered component instance is named after its ACTIVE
    // VARIANT, so the same node is `Desktop` at 1200px and `Phone` at 390px.
    // Refusing on the name difference would lose the override on exactly the
    // nodes that have one.
    const desktop = [node({ framerName: 'Desktop', styles: { padding: '40px' } })];
    const mobile = [node({ framerName: 'Phone', styles: { padding: '20px' } })];

    const { roots, report } = diffResponsiveStyles(
      { label: 'desktop', roots: desktop },
      [{ label: 'mobile', roots: mobile }],
    );

    expect(roots[0]!.responsiveStyles).toEqual({ mobile: { padding: '20px' } });
    expect(report.unpaired.mobile).toBe(0);
  });

  it('counts an unpaired position instead of guessing a value for it', () => {
    // An unpaired node keeps its desktop styling at every width, which is
    // indistinguishable from a deliberate design decision unless it is reported.
    // Here the narrower viewport renders the container as a leaf, so its two
    // children have no counterpart at all — not a rename, a genuine absence.
    const desktop = [node({
      framerName: 'Row',
      children: [
        node({ framerName: 'Left', styles: { padding: '40px' } }),
        node({ framerName: 'Right', styles: { padding: '40px' } }),
      ],
    })];
    const mobile = [node({ framerName: 'Row', children: [] })];

    const { roots, report } = diffResponsiveStyles(
      { label: 'desktop', roots: desktop },
      [{ label: 'mobile', roots: mobile }],
    );

    expect(roots[0]!.children[0]!.responsiveStyles).toBeUndefined();
    expect(roots[0]!.children[1]!.responsiveStyles).toBeUndefined();
    expect(report.unpaired.mobile).toBe(2);
    expect(report.nodesWithOverrides.mobile).toBe(0);
  });

  it('skips a property that is absent at the narrower viewport', () => {
    // Elementor has no "unset at mobile" control: re-emitting the desktop value
    // is a no-op and emitting an empty one clears it at every width.
    const { roots } = diffResponsiveStyles(
      { label: 'desktop', roots: [node({ framerName: 'X', styles: { padding: '40px', gap: '8px' } })] },
      [{ label: 'mobile', roots: [node({ framerName: 'X', styles: { padding: '40px' } })] }],
    );
    expect(roots[0]!.responsiveStyles).toBeUndefined();
  });

  it('reports an empty capture rather than treating it as "no overrides"', () => {
    const { report } = diffResponsiveStyles(
      { label: 'desktop', roots: [node({ framerName: 'X', styles: { padding: '40px' } })] },
      [{ label: 'mobile', roots: [] }],
    );
    expect(report.warnings.some((w) => w.includes('no roots'))).toBe(true);
    expect(report.nodesWithOverrides.mobile).toBe(0);
  });

  it('derives nothing, and claims nothing, with no other viewport', () => {
    const { roots, report } = diffResponsiveStyles(
      { label: 'desktop', roots: [node({ framerName: 'X', styles: { padding: '40px' } })] },
      [],
    );
    expect(roots[0]!.responsiveStyles).toBeUndefined();
    expect(report.breakpoints).toEqual([]);
  });
});

describe('formatResponsiveDiffReport', () => {
  it('says plainly when no comparison was possible', () => {
    const { report } = diffResponsiveStyles({ label: 'desktop', roots: [] }, []);
    expect(formatResponsiveDiffReport(report)).toContain('no non-primary viewport');
  });

  it('names each breakpoint with its counts and its top properties', () => {
    const { report } = diffResponsiveStyles(
      { label: 'desktop', roots: [node({ framerName: 'X', styles: { padding: '40px' } })] },
      [{ label: 'mobile', roots: [node({ framerName: 'X', styles: { padding: '20px' } })] }],
    );
    const text = formatResponsiveDiffReport(report);
    expect(text).toContain('mobile: 1 node(s) overridden');
    expect(text).toContain('padding=1');
  });
});
