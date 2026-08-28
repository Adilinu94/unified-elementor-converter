import { describe, expect, it } from 'vitest';
import {
  alignSectionRoots,
  formatRootAlignment,
  normaliseLayerName,
  type LiveDomNode,
} from '@elconv/extractors';
import type { Evidence, VisualSectionIR } from '@elconv/core';

/**
 * Anchor-based root alignment (v7.0 A4, alignment half).
 *
 * The fixture is the measured shape of the live project
 * (precious-board-067119.framer.app, 2026-08-28): 12 structural sections against
 * 15 DOM roots. Pure index alignment — what `mergeLiveDomIntoIr` does — matches
 * NONE of them, because the DOM carries three roots the structural section
 * detector never saw. That is the failure these tests pin down.
 */

const EVIDENCE: Evidence = { sourceIds: ['x'], methods: ['mcp', 'xml'], confidence: 0.92, warnings: [] };

function section(sourceName: string, sourceId = sourceName): VisualSectionIR {
  return {
    sourceId,
    role: 'generic',
    sourceName,
    layoutArchetype: 'stacked',
    bboxByViewport: {},
    nodes: [],
    evidence: EVIDENCE,
  };
}

function root(framerName: string | undefined, bbox: Partial<LiveDomNode['bbox']> = {}, tag = 'section'): LiveDomNode {
  return {
    ...(framerName !== undefined ? { framerName } : {}),
    tag,
    bbox: { x: 0, y: 0, width: 1440, height: 500, ...bbox },
    children: [],
  };
}

/**
 * The real 12 structural section names, verbatim from the Unframer XML.
 * Note the missing separators: the XML tag is the layer name stripped.
 */
const IR_SECTIONS = [
  'HeroSection',
  'IntroSection',
  'StatementSection',
  'FeaturesSection1',
  'FeaturesSection2',
  'TestimonialsSection',
  'WorkflowSection',
  'ClientResultsSection',
  'IntegrationsSection',
  'BlogSection',
  'FaqSection',
  'LenisSmoothScroll',
].map((name) => section(name));

/**
 * The real 15 DOM roots in document order, with the measured boxes.
 *
 * `Desktop` appears three times: the site header plus the two component-instance
 * sections rendering under their active variant name.
 */
const DOM_ROOTS: LiveDomNode[] = [
  root('Desktop', { y: 0, height: 84 }, 'header'),
  root('Hero Section', { y: 0, height: 1194 }),
  root('Intro Section', { y: 1194, height: 890 }),
  root('Statement Section', { y: 2085, height: 3690 }),
  root('Features Section #1', { y: 5775, height: 1007 }),
  root('Features Section #2', { y: 6782, height: 1220 }),
  root('Desktop', { y: 8002, height: 873 }),
  root('Workflow Section', { y: 8875, height: 1238 }),
  root('Client Results Section', { y: 10113, height: 999 }),
  root('Integrations Section', { y: 11112, height: 631 }),
  root('Blog Section', { y: 11743, height: 1529 }),
  root('Desktop', { y: 13271, height: 843 }),
  root('Lenis Smooth Scroll', { y: 0, width: 0, height: 0 }, 'div'),
  root('CTA & Footer', { y: 14115, height: 1202 }, 'div'),
  root('Light', { y: 842, width: 140, height: 38 }, 'a'),
];

describe('normaliseLayerName', () => {
  it('bridges the XML tag and the DOM name for the same layer', () => {
    // The single fact that makes name anchoring possible at all.
    expect(normaliseLayerName('FeaturesSection1')).toBe(normaliseLayerName('Features Section #1'));
    expect(normaliseLayerName('Cta')).toBe(normaliseLayerName('CTA'));
    expect(normaliseLayerName('LenisSmoothScroll')).toBe(normaliseLayerName('Lenis Smooth Scroll'));
  });

  it('does not collapse genuinely different names', () => {
    expect(normaliseLayerName('FeaturesSection1')).not.toBe(normaliseLayerName('FeaturesSection2'));
  });
});

describe('alignSectionRoots on the measured page', () => {
  const result = alignSectionRoots(IR_SECTIONS, DOM_ROOTS);

  it('matches all 12 sections where index alignment matched none', () => {
    expect(result.matched).toBe(12);
    expect(result.unmatched).toBe(0);
    expect(result.conflicts).toEqual([]);
  });

  it('anchors the 10 sections whose names are unique on both sides', () => {
    const anchored = result.matches.filter((match) => match.method === 'name-anchor');
    expect(anchored).toHaveLength(10);
    expect(anchored.map((match) => match.structuralName)).toContain('HeroSection');
    expect(anchored.map((match) => match.structuralName)).toContain('LenisSmoothScroll');
  });

  it('resolves the two component-instance sections that render as "Desktop"', () => {
    // These are the nodes a name match cannot find and the ones whose subtrees
    // are least recoverable from the source — so getting them right is the point.
    const byOrder = result.matches.filter((match) => match.method === 'order-between-anchors');
    expect(byOrder.map((match) => match.structuralName)).toEqual(['TestimonialsSection', 'FaqSection']);
    expect(byOrder.every((match) => match.domName === 'Desktop')).toBe(true);
    expect(byOrder.map((match) => match.domIndex)).toEqual([6, 11]);
  });

  it('never assigns one DOM root to two sections', () => {
    const used = result.matches.filter((m) => m.domIndex !== -1).map((m) => m.domIndex);
    expect(new Set(used).size).toBe(used.length);
  });

  it('keeps the header and footer visible as unclaimed rather than absorbing them', () => {
    // Silently claiming them would hide the two roots a reader most needs to see:
    // they carry real content that no structural section covers.
    const names = result.extraDomRoots.map((extra) => extra.domName);
    expect(names).toContain('Desktop');
    expect(names).toContain('CTA & Footer');
    expect(names).toContain('Light');
    expect(result.extraDomRoots).toHaveLength(3);
  });

  it('explains a zero-area root by its geometry, not as a generic leftover', () => {
    // `Lenis Smooth Scroll` IS matched here, so exercise the reason text directly
    // with a root that has no structural peer.
    const orphanZero = alignSectionRoots([section('Only')], [root('Only'), root('Helper', { width: 0, height: 0 })]);
    expect(orphanZero.extraDomRoots[0].reason).toContain('zero-area');
  });

  it('confirms plain index alignment would have failed', () => {
    // Position 0 is the header on the DOM side and HeroSection on the IR side, so
    // every subsequent index is off by one. This is why the anchor step exists.
    expect(IR_SECTIONS.length).not.toBe(DOM_ROOTS.length);
    expect(DOM_ROOTS[0].framerName).toBe('Desktop');
    expect(IR_SECTIONS[0].sourceName).toBe('HeroSection');
  });
});

describe('alignSectionRoots refusals', () => {
  it('refuses to pair an ambiguous run instead of force-fitting it', () => {
    // One structural section between two anchors where the DOM offers two roots
    // has two equally plausible answers. Picking one would attach a subtree to
    // the wrong element while reporting success.
    const result = alignSectionRoots(
      [section('First'), section('Middle'), section('Last')],
      [root('First'), root('Desktop'), root('Variant 1'), root('Last')],
    );

    const middle = result.matches.find((match) => match.structuralName === 'Middle');
    expect(middle?.method).toBe('unmatched');
    expect(middle?.domIndex).toBe(-1);
    expect(result.conflicts.join(' ')).toContain('Middle');
  });

  it('does not anchor on a name that repeats on either side', () => {
    // `Desktop` occurs three times in the real DOM. Anchoring on it would bind a
    // section to whichever came first.
    const result = alignSectionRoots(
      [section('Desktop', 'a'), section('Desktop', 'b')],
      [root('Desktop'), root('Desktop')],
    );
    expect(result.matches.every((match) => match.method !== 'name-anchor')).toBe(true);
  });

  it('drops a non-monotonic anchor and says the sources disagree on order', () => {
    const result = alignSectionRoots(
      [section('Alpha'), section('Beta')],
      [root('Beta'), root('Alpha')],
    );
    expect(result.conflicts.join(' ')).toContain('disagree');
  });

  it('handles an empty DOM root list without inventing matches', () => {
    const result = alignSectionRoots(IR_SECTIONS, []);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(12);
  });

  it('handles a section with no sourceName by falling back to its role', () => {
    const roleOnly: VisualSectionIR = {
      sourceId: 's1',
      role: 'hero',
      layoutArchetype: 'stacked',
      bboxByViewport: {},
      nodes: [],
      evidence: EVIDENCE,
    };
    const result = alignSectionRoots([roleOnly], [root('Hero')]);
    expect(result.matches[0].structuralName).toBe('hero');
    expect(result.matches[0].method).toBe('name-anchor');
  });
});

describe('formatRootAlignment', () => {
  it('lists every section, the unclaimed roots and why they were left', () => {
    const text = formatRootAlignment(alignSectionRoots(IR_SECTIONS, DOM_ROOTS));
    expect(text).toContain('12 matched');
    expect(text).toContain('CTA & Footer');
    expect(text).toContain('did not treat it as a page section');
  });
});
