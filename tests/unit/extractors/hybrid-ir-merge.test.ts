import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildUnframerIr,
  parseUnframerProject,
  parseUnframerXml,
  mergeLiveDomIntoIr,
  selectTopLevelSections,
  formatHybridMergeReport,
  classifyMotionSeries,
  parsePackedSample,
  type LiveDomEvidence,
  type LiveSectionGeometry,
  type MotionEvidence,
  type MotionObservation,
} from '@elconv/extractors';
import { validateVisualPageIR, type VisualPageIR } from '@elconv/core';

const FIXTURES = resolve(__dirname, 'fixtures/framer');
const PAGE_XML = readFileSync(resolve(FIXTURES, 'unframer-home-page.xml'), 'utf8');
const PROJECT_XML = readFileSync(resolve(FIXTURES, 'unframer-project.xml'), 'utf8');

/**
 * Real per-viewport section geometry, captured from the live Humeen page at the
 * viewports the page's OWN `__framer__breakpoints` declare (1200 / 810 / 390).
 */
interface GeometryFixture {
  viewports: Array<{ label: string; width: number; height: number }>;
  documentHeights: Record<string, number>;
  byViewport: Record<string, LiveSectionGeometry[]>;
}
const geometry: GeometryFixture = JSON.parse(
  readFileSync(resolve(FIXTURES, 'live-section-geometry-humeen.json'), 'utf8'),
);

/** The frozen motion sweep of the same page. */
interface MotionFixture {
  stops: number[];
  breakpointsPayload: string;
  series: Record<string, Array<string | null>>;
  sticky: Array<{ framerName?: string; top: string; heightPx: number }>;
}
const sweep: MotionFixture = JSON.parse(
  readFileSync(resolve(FIXTURES, 'motion-sweep-humeen.json'), 'utf8'),
);

function buildStructuralIr(): VisualPageIR {
  const project = parseUnframerProject(PROJECT_XML);
  return buildUnframerIr(parseUnframerXml(PAGE_XML), {
    route: '/',
    pageId: 'augiA20Il',
    project,
  }).ir;
}

/**
 * Rebuild MotionEvidence from the frozen sweep.
 *
 * The section attribution the probe reads off the live DOM cannot be recovered
 * from the sweep alone, so it is supplied per element here from the measured
 * page layout. Everything else — the packed series and the classification — is
 * the real measured data.
 */
function buildMotionEvidence(
  sectionByKey: Record<string, { sectionName?: string; framerName?: string; ordinal?: number }> = {},
): MotionEvidence {
  const observations: MotionObservation[] = Object.entries(sweep.series).map(([key, series]) => {
    const [, name, cls] = key.split(':');
    const isFramerName = !/^[a-z]+$/.test(name);
    const override = sectionByKey[key] ?? {};
    const classification = classifyMotionSeries(series.map(parsePackedSample));
    return {
      ...classification,
      key,
      framerName: override.framerName ?? (isFramerName ? name : undefined),
      tag: isFramerName ? 'div' : name,
      selector: isFramerName ? `div[data-framer-name="${name}"]` : `${name}.${cls}`,
      sectionName: override.sectionName,
      ordinalInSection: override.ordinal ?? 0,
      depthInSection: 2,
    };
  });

  return {
    url: 'https://loud-alternative-352151.framer.app/',
    probedAt: '2026-08-26T11:42:04.099Z',
    documentHeightPx: 16612,
    stops: sweep.stops,
    viewports: geometry.viewports,
    observations,
    sticky: sweep.sticky.map((entry) => ({
      framerName: entry.framerName,
      selector: `div[data-framer-name="${entry.framerName}"]`,
      top: entry.top,
      bottom: 'auto',
      heightPx: entry.heightPx,
      ordinalInSection: 0,
    })),
    appear: { targets: [] },
    cssAnimations: {
      keyframes: [], same_origin_count: 0, cross_origin_count: 0, transitions: [],
      gsap: { hasGSAP: false, hasScrollTrigger: false },
    },
    animationProperties: { elements: [], referencedKeyframes: [], distinctTransitionProperties: [] },
    pseudoStates: [],
    warnings: [],
  };
}

function liveEvidence(overrides: Partial<LiveDomEvidence> = {}): LiveDomEvidence {
  return {
    viewports: geometry.viewports,
    byViewport: geometry.byViewport,
    documentHeights: geometry.documentHeights,
    ...overrides,
  };
}

describe('hybrid-ir-merge / selectTopLevelSections', () => {
  it('drops the framer-*-container wrappers that share a box with their section', () => {
    // Measured: div.framer-1iiwtwk-container sits at exactly the same box as
    // section[data-framer-name="Desktop"] (y=9438 h=923). Keeping both breaks
    // the order alignment by inflating the section count.
    const raw = geometry.byViewport.desktop;
    expect(raw).toHaveLength(14);

    const { kept, dropped } = selectTopLevelSections(raw);
    expect(kept).toHaveLength(11);
    expect(dropped.map((entry) => entry.reason).join(' ')).toContain('same box as');
    // The <section> survives, the wrapper div does not.
    expect(kept.some((c) => c.tag === 'section' && c.bbox.y === 9438)).toBe(true);
    expect(kept.some((c) => c.tag === 'div' && c.bbox.y === 9438)).toBe(false);
  });

  it('drops the slideshow section nested inside the testimonial section', () => {
    // Measured: section.framer-slideshow is at y=9588 h=535 w=645, INSIDE the
    // testimonial section at y=9438..10361 w=1200. A flat querySelectorAll
    // reports it as a sibling.
    const { kept, dropped } = selectTopLevelSections(geometry.byViewport.desktop);
    expect(kept.some((c) => c.firstClass === 'framer-slideshow')).toBe(false);
    expect(dropped.some((entry) => entry.candidate.firstClass === 'framer-slideshow')).toBe(true);
  });

  it('yields exactly 11 sections at every measured viewport', () => {
    for (const label of ['desktop', 'tablet', 'mobile']) {
      const { kept } = selectTopLevelSections(geometry.byViewport[label]);
      expect(kept, label).toHaveLength(11);
    }
  });

  it('returns the sections in document order', () => {
    const { kept } = selectTopLevelSections(geometry.byViewport.desktop);
    const ys = kept.map((c) => c.bbox.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it('can be told to keep everything', () => {
    const { kept } = selectTopLevelSections(geometry.byViewport.desktop, {
      dropNested: false,
      dropDuplicateBoxes: false,
    });
    expect(kept).toHaveLength(14);
  });
});

describe('hybrid-ir-merge / geometry', () => {
  const structural = buildStructuralIr();

  it('starts from a structural IR that has no geometry at all', () => {
    for (const section of structural.sections) {
      expect(Object.keys(section.bboxByViewport)).toHaveLength(0);
    }
    expect(structural.source.extractionMode).toBe('unframer');
  });

  it('gives every one of the 11 sections a box at all three viewports', () => {
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence());
    expect(report.sectionsWithGeometry).toBe(11);
    expect(report.sectionsWithoutGeometry).toEqual([]);
    for (const section of ir.sections) {
      expect(Object.keys(section.bboxByViewport).sort()).toEqual(['desktop', 'mobile', 'tablet']);
    }
  });

  it('applies the real measured boxes, not derived ones', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence());
    const hero = ir.sections[0];
    expect(hero.bboxByViewport.desktop).toEqual({ x: 0, y: 0, width: 1200, height: 900 });
    // Mobile is genuinely a different layout, not a scaled desktop.
    expect(hero.bboxByViewport.mobile).toEqual({ x: 0, y: 0, width: 390, height: 669 });
  });

  it('declares the viewports the boxes were measured at', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence());
    expect(ir.viewportProfiles.map((v) => v.width)).toEqual([1200, 810, 390]);
    // 1440 / 768 are DEFAULT_VIEWPORTS and were never measured on this page.
    expect(ir.viewportProfiles.map((v) => v.width)).not.toContain(1440);
    expect(ir.viewportProfiles.map((v) => v.width)).not.toContain(768);
  });

  it('marks the merged IR as hybrid with evidence from both sides', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence());
    expect(ir.source.extractionMode).toBe('hybrid');
    for (const section of ir.sections) {
      expect(section.evidence.methods).toContain('mcp');
      expect(section.evidence.methods).toContain('dom');
      // Charter §3.4 acceptance: at least two independent methods per section.
      expect(section.evidence.methods.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('still validates as a VisualPageIR', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence());
    const result = validateVisualPageIR(ir);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('does not mutate the input IR', () => {
    const before = JSON.stringify(structural);
    mergeLiveDomIntoIr(structural, liveEvidence());
    expect(JSON.stringify(structural)).toBe(before);
  });

  it('drops the structure-only warning it has now answered', () => {
    expect(structural.warnings.some((w) => w.startsWith('structure-only extraction:'))).toBe(true);
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence());
    expect(ir.warnings.some((w) => w.startsWith('structure-only extraction:'))).toBe(false);
    expect(ir.warnings.some((w) => w.startsWith('hybrid merge:'))).toBe(true);
  });
});

describe('hybrid-ir-merge / section matching', () => {
  const structural = buildStructuralIr();

  it('verifies the nine sections whose names agree on both sides', () => {
    const { report } = mergeLiveDomIntoIr(structural, liveEvidence());
    const verified = report.sections.filter((match) => match.method === 'name+order');
    expect(verified.map((match) => match.structuralName)).toEqual([
      'Hero', 'About', 'Projects', 'Partners', 'Services', 'Awards', 'Rating', 'Cta', 'Blogs',
    ]);
  });

  it('matches Cta to CTA despite the case difference', () => {
    const { report } = mergeLiveDomIntoIr(structural, liveEvidence());
    const cta = report.sections.find((match) => match.structuralName === 'Cta')!;
    expect(cta.method).toBe('name+order');
    expect(cta.domName).toBe('CTA');
  });

  it('matches the two component-instance sections that render under a variant name', () => {
    // This is the case a name-first merge cannot solve: Testimonial and Faq are
    // the two XML sections carrying a componentId, and a rendered Framer
    // component instance is named after its ACTIVE VARIANT (Desktop / Tablet /
    // Phone), not after the layer. So the two sections whose structure is least
    // recoverable from the DOM are exactly the two a name match would drop.
    const { report, ir } = mergeLiveDomIntoIr(structural, liveEvidence());
    const renamed = report.sections.filter((match) => match.method === 'order-variant-rename');
    expect(renamed.map((match) => match.structuralName)).toEqual(['Testimonial', 'Faq']);
    for (const match of renamed) {
      expect(match.domName).toBe('Desktop');
      expect(match.reason).toContain('variant name');
      // Lower confidence than a name-verified match, but still merged.
      expect(match.confidence).toBeLessThan(0.97);
      expect(match.viewportsApplied).toHaveLength(3);
    }
    // And they did get real geometry.
    const testimonial = ir.sections.find((section) => section.sourceName === 'Testimonial')!;
    expect(testimonial.bboxByViewport.desktop).toEqual({ x: 0, y: 9438, width: 1200, height: 923 });
  });

  it('reports no conflicts on the real page', () => {
    const { report } = mergeLiveDomIntoIr(structural, liveEvidence());
    expect(report.conflicts).toEqual([]);
    expect(report.unmatchedDomSections).toEqual([]);
  });

  it('refuses to apply geometry when the count differs AND the name does not verify', () => {
    // One DOM section removed: the alignment past that point is shifted, so
    // every unverified pair must be left alone rather than force-fitted.
    const truncated = geometry.byViewport.desktop.filter((c) => c.framerName !== 'Projects');
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      byViewport: { desktop: truncated },
      viewports: [geometry.viewports[0]],
    }));

    expect(report.conflicts.join(' ')).toContain('section count differs');
    const unmatched = report.sections.filter((match) => match.method === 'unmatched');
    expect(unmatched.length).toBeGreaterThan(0);
    for (const match of unmatched) {
      const section = ir.sections.find((candidate) => candidate.sourceId === match.sourceId)!;
      expect(Object.keys(section.bboxByViewport)).toHaveLength(0);
    }
  });

  it('skips a viewport whose section count disagrees instead of guessing', () => {
    const brokenTablet = geometry.byViewport.tablet.slice(0, 8);
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      byViewport: { ...geometry.byViewport, tablet: brokenTablet },
    }));
    expect(report.conflicts.join(' ')).toContain('tablet');
    expect(report.conflicts.join(' ')).toContain('NOT applied');
    for (const section of ir.sections) {
      expect(Object.keys(section.bboxByViewport)).not.toContain('tablet');
      expect(Object.keys(section.bboxByViewport)).toContain('desktop');
    }
  });

  it('handles live evidence with no viewport at all', () => {
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({ byViewport: {} }));
    expect(report.sectionsWithGeometry).toBe(0);
    expect(report.conflicts.join(' ')).toContain('no viewport');
    expect(ir).toBe(structural);
  });

  it('keeps the named structural background over a computed literal and says so', () => {
    const recoloured = geometry.byViewport.desktop.map((candidate, index) =>
      index === 0 ? { ...candidate, backgroundColor: 'rgb(255, 0, 0)' } : candidate,
    );
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      byViewport: { desktop: recoloured },
      viewports: [geometry.viewports[0]],
    }));
    const hero = ir.sections[0];
    // /Dark from the project styles, not the injected red.
    expect(hero.background?.color).not.toBe('rgb(255, 0, 0)');
    expect(report.conflicts.join(' ')).toContain('background differs');
    expect(report.conflicts.join(' ')).toContain('Kept the structural value');
  });

  it('accepts a computed background where the structural side had none', () => {
    const noBackgroundIr: VisualPageIR = {
      ...structural,
      sections: structural.sections.map((section, index) =>
        index === 2 ? { ...section, background: undefined } : section,
      ),
    };
    const { ir } = mergeLiveDomIntoIr(noBackgroundIr, liveEvidence());
    const projects = ir.sections[2];
    expect(projects.background?.color).toBe(geometry.byViewport.desktop[2].backgroundColor);
  });
});

describe('hybrid-ir-merge / motion attribution', () => {
  const structural = buildStructuralIr();

  it('reports every observation it cannot attribute, and attributes none by guess', () => {
    // No section attribution supplied: every observation must land in the
    // unattributed list rather than being pinned to an arbitrary node.
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence(),
    }));
    expect(report.animationsMapped).toBe(0);
    expect(ir.animations).toEqual([]);
    expect(report.animationsUnmapped).toHaveLength(31);
    expect(report.animationsUnmapped.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('attributes an observation to the section that encloses it', () => {
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects' },
      }),
    }));
    expect(report.animationsMapped).toBe(1);
    const animation = ir.animations[0];
    const projects = ir.sections.find((section) => section.sourceName === 'Projects')!;
    // Either the exact node or the section itself, and the report says which.
    expect(animation.kind).toBe('scroll');
    expect(animation.intent).toContain('entrance');
    expect(animation.evidence.methods).toEqual(['dom', 'computed-style']);
    expect([projects.sourceId, ...collectSourceIds(projects)]).toContain(animation.targetSourceId);
  });

  it('attributes to an exact node when the layer name resolves, with higher confidence', () => {
    const projects = structural.sections.find((section) => section.sourceName === 'Projects')!;
    const namedChild = collectNamedNodes(projects)[0];
    expect(namedChild, 'fixture must contain a named node inside Projects').toBeDefined();

    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects', framerName: namedChild!.sourceName },
      }),
    }));
    const animation = ir.animations[0];
    expect(animation.targetSourceId).toBe(namedChild!.sourceId);
    expect(animation.evidence.confidence).toBeGreaterThan(0.7);
  });

  it('falls back to the section with lower confidence when the layer name is unknown', () => {
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects', framerName: 'NoSuchLayer' },
      }),
    }));
    const projects = ir.sections.find((section) => section.sourceName === 'Projects')!;
    const animation = ir.animations[0];
    expect(animation.targetSourceId).toBe(projects.sourceId);
    expect(animation.evidence.confidence).toBeLessThan(0.7);
    expect(animation.evidence.warnings.join(' ')).toContain('enclosing section');
    expect(report.warnings.join(' ')).toContain('rather than to a');
  });

  it('does not claim the same node for two observations', () => {
    const projects = structural.sections.find((section) => section.sourceName === 'Projects')!;
    const named = collectNamedNodes(projects)[0]!;
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects', framerName: named.sourceName, ordinal: 0 },
        '225:Bottom:framer-1uglcty': { sectionName: 'Projects', framerName: named.sourceName, ordinal: 0 },
      }),
    }));
    const targets = ir.animations.map((animation) => animation.targetSourceId);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('falls back to a section only ONCE, and reports the rest as unattributed', () => {
    // Measured on a live page: 31 observations produced 3 distinct targets because
    // every unresolvable one fell back to its enclosing section. A target writes
    // ONE entrance onto that element, so 28 effects were reported by
    // G_ANIMATION_PARITY as never appearing — correct, but uselessly late. A
    // second fallback to the same section adds no information, so it is named as
    // unattributed here, where it is still actionable.
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects', framerName: 'NoSuchLayer' },
        '225:Bottom:framer-1uglcty': { sectionName: 'Projects', framerName: 'AlsoMissing' },
      }),
    }));

    expect(report.animationsMapped).toBe(1);
    expect(ir.animations).toHaveLength(1);
    const rejected = report.animationsUnmapped.find((entry) =>
      entry.reason.includes('already carries a fallback-attributed animation'),
    );
    expect(rejected).toBeDefined();
    expect(rejected!.reason).toContain('only one could be visible');
  });

  it('still attributes an exact node after a section fallback was used', () => {
    // The cap applies to the FALLBACK only. An observation that resolves to a
    // real node must not be refused because an earlier one could not.
    const projects = structural.sections.find((section) => section.sourceName === 'Projects')!;
    const named = collectNamedNodes(projects)[0]!;
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects', framerName: 'NoSuchLayer' },
        '225:Bottom:framer-1uglcty': { sectionName: 'Projects', framerName: named.sourceName, ordinal: 0 },
      }),
    }));

    expect(report.animationsMapped).toBe(2);
    const targets = ir.animations.map((animation) => animation.targetSourceId);
    expect(new Set(targets).size).toBe(2);
    expect(targets).toContain(named.sourceId);
  });

  it('never carries a duration for scroll-derived motion', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects' },
        '266:Cards:framer-1lv5kfo': { sectionName: 'Services' },
      }),
    }));
    expect(ir.animations.length).toBeGreaterThan(0);
    for (const animation of ir.animations) {
      expect(animation.durationMs).toBeUndefined();
    }
  });

  it('carries the motion class as a field, not only inside the intent string', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        // Measured entrance: opacity 0 -> 1 with translateY 50 -> 0.
        '202:Top:framer-izxvjs': { sectionName: 'Projects' },
        // Measured scroll scrub: opacity constant, translateX 1900 -> -1050.
        '266:Cards:framer-1lv5kfo': { sectionName: 'Services' },
      }),
    }));
    const classes = ir.animations.map((animation) => animation.motionClass);
    expect(classes).toContain('entrance');
    expect(classes).toContain('scroll-linked');
    // A target has to branch on the class to choose between an entrance
    // animation and a scroll motion effect. Parsing it out of `intent` prose
    // would be a contract no compiler can check.
    for (const animation of ir.animations) {
      expect(animation.intent).toContain(animation.motionClass!);
    }
  });

  it('carries measured amplitudes, which is the only basis for a motion-fx speed', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '266:Cards:framer-1lv5kfo': { sectionName: 'Services' },
      }),
    }));
    const cards = ir.animations[0];
    const translateX = cards.effects?.find((effect) => effect.kind === 'translateX');
    expect(translateX).toBeDefined();
    // The real horizontal run: 1900px -> -1050px, a 2950px span. Elementor's
    // speed control resolves to -(passedPercents - 50) * speed px, so without
    // this number a mapper can only invent a speed.
    expect(translateX!.from).toBeCloseTo(1900, 0);
    expect(translateX!.to).toBeCloseTo(-1050, 0);
    expect(translateX!.range).toBeCloseTo(2950, 0);
    expect(translateX!.monotonic).toBe(true);
  });

  it('produces animations that pass IR validation with the new fields', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects' },
        '266:Cards:framer-1lv5kfo': { sectionName: 'Services' },
        '267:div:framer-1yv66y7-container': { sectionName: 'Services' },
      }),
    }));
    const validation = validateVisualPageIR(ir);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it('keeps the entrance / scroll-linked distinction in the intent', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects' },
        '266:Cards:framer-1lv5kfo': { sectionName: 'Services' },
      }),
    }));
    const intents = ir.animations.map((animation) => animation.intent);
    expect(intents.some((intent) => intent.startsWith('entrance:'))).toBe(true);
    expect(intents.some((intent) => intent.startsWith('scroll-linked:'))).toBe(true);
  });

  it('excludes indeterminate observations from the animation list', () => {
    const { ir, report } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        // The sub-epsilon image: real measured noise, must not become an animation.
        '131:Image:framer-tw203r': { sectionName: 'Projects' },
      }),
    }));
    expect(ir.animations).toEqual([]);
    expect(report.animationsUnmapped.some((entry) => entry.reason.includes('not classified'))).toBe(true);
  });

  it('still validates after animations were added', () => {
    const { ir } = mergeLiveDomIntoIr(structural, liveEvidence({
      motion: buildMotionEvidence({
        '202:Top:framer-izxvjs': { sectionName: 'Projects' },
        '267:div:framer-1yv66y7-container': { sectionName: 'Services', framerName: 'Cards' },
      }),
    }));
    expect(validateVisualPageIR(ir).errors).toEqual([]);
  });
});

describe('hybrid-ir-merge / formatHybridMergeReport', () => {
  it('names the match method and the viewports for every section', () => {
    const { report } = mergeLiveDomIntoIr(buildStructuralIr(), liveEvidence());
    const text = formatHybridMergeReport(report);
    expect(text).toContain('11/11 section(s) got geometry');
    expect(text).toContain('[name+order] Hero');
    expect(text).toContain('[order-variant-rename] Testimonial');
    expect(text).toContain('desktop/tablet/mobile');
  });

  it('lists unattributed motion so nothing is silently lost', () => {
    const { report } = mergeLiveDomIntoIr(buildStructuralIr(), liveEvidence({
      motion: buildMotionEvidence(),
    }));
    const text = formatHybridMergeReport(report);
    expect(text).toContain('Unattributed motion (31)');
  });
});

function collectSourceIds(section: { nodes: Array<{ sourceId: string; children: unknown[] }> }): string[] {
  const out: string[] = [];
  const walk = (nodes: Array<{ sourceId: string; children: unknown[] }>): void => {
    for (const node of nodes) {
      out.push(node.sourceId);
      walk(node.children as Array<{ sourceId: string; children: unknown[] }>);
    }
  };
  walk(section.nodes);
  return out;
}

function collectNamedNodes(
  section: { nodes: Array<{ sourceId: string; sourceName?: string; children: unknown[] }> },
): Array<{ sourceId: string; sourceName?: string }> {
  const out: Array<{ sourceId: string; sourceName?: string }> = [];
  const walk = (nodes: Array<{ sourceId: string; sourceName?: string; children: unknown[] }>): void => {
    for (const node of nodes) {
      if (node.sourceName) out.push(node);
      walk(node.children as Array<{ sourceId: string; sourceName?: string; children: unknown[] }>);
    }
  };
  walk(section.nodes);
  return out;
}
