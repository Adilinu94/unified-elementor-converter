import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildResidualSnippets,
  checkAnimationParity,
  createAnimationParityGuard,
  emitVisualIrToV3,
  formatParityResult,
  hasAnimationSettings,
  isSafeCssIdent,
  mapAnimations,
  nativeShare,
  residualTargets,
  type AnimationResolution,
} from '@elconv/target-v3';
import type { V3Element } from '@elconv/target-v3';
import {
  CONTAINER_SCHEMA_KEY,
  validateSnippet,
  type AnimationIR,
  type ResolvedWidgetSchema,
  type VisualPageIR,
  type WidgetSchemaMap,
} from '@elconv/core';

/**
 * Arbeitspaket B5 — `G_ANIMATION_PARITY` + residual WPCode snippets.
 *
 * The schema is the committed live snapshot (Elementor 4.2.1 + Pro 4.1.0), same
 * as the mapper test. Using it matters here for one specific reason: the whole
 * point of these two modules is the split between "the target CAN do this" and
 * "a snippet must carry it", and that split is decided entirely by which control
 * ids the schema declares. Against an invented schema both modules would agree
 * with themselves and prove nothing.
 */
const SNAPSHOT_PATH = resolve(__dirname, '../../../schemas/elementor-v3-controls.snapshot.json');
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
  missing: string[];
  widgets: WidgetSchemaMap;
};

const liveSchema: ResolvedWidgetSchema = {
  schema: snapshot.widgets,
  source: 'snapshot',
  degraded: false,
  degradedReasons: [],
};

/** A Core-only site: every Pro `motion_fx_*` / `sticky` control removed. */
const coreOnlySchema: ResolvedWidgetSchema = {
  source: 'snapshot',
  degraded: false,
  degradedReasons: [],
  schema: Object.fromEntries(
    Object.entries(snapshot.widgets).map(([key, entry]) => [
      key,
      {
        ...entry,
        controls: Object.fromEntries(
          Object.entries(entry.controls).filter(
            ([id]) => !id.startsWith('motion_fx_') && !id.startsWith('sticky'),
          ),
        ),
      },
    ]),
  ),
};

const EVIDENCE = { sourceIds: ['x'], methods: ['dom' as const], confidence: 0.8, warnings: [] };

function entranceAnimation(overrides: Partial<AnimationIR> = {}): AnimationIR {
  return {
    id: 'a-entrance',
    kind: 'scroll',
    targetSourceId: 'node-1',
    intent: 'entrance:opacity+translateY',
    motionClass: 'entrance',
    durationMs: 600,
    effects: [
      { kind: 'opacity', from: 0, to: 1, range: 1, monotonic: true },
      { kind: 'translateY', from: 40, to: 0, range: 40, monotonic: true },
    ],
    evidence: EVIDENCE,
    ...overrides,
  };
}

function scrollAnimation(overrides: Partial<AnimationIR> = {}): AnimationIR {
  return {
    id: 'a-scroll',
    kind: 'scroll',
    targetSourceId: 'node-2',
    intent: 'scroll:translateY',
    motionClass: 'scroll-linked',
    effects: [{ kind: 'translateY', from: 120, to: -120, range: 240, monotonic: true }],
    evidence: EVIDENCE,
    ...overrides,
  };
}

function resolution(overrides: Partial<AnimationResolution> = {}): AnimationResolution {
  return {
    targetSourceId: 'node-1',
    animationId: 'a-entrance',
    decision: 'native',
    nativeSettings: {},
    reason: 'test',
    companionsApplied: [],
    precisionLoss: [],
    ...overrides,
  };
}

function widget(settings: Record<string, unknown>, id = 'w1'): V3Element {
  return { id, elType: 'widget', widgetType: 'heading', settings };
}

// ============================================================================
// hasAnimationSettings — the master-switch trap
// ============================================================================

describe('hasAnimationSettings', () => {
  it('accepts a written entrance on either naming family', () => {
    expect(hasAnimationSettings(widget({ _animation: 'fadeInUp' }))).toBe(true);
    expect(hasAnimationSettings({ id: 'c1', elType: 'container', settings: { animation: 'fadeIn' } })).toBe(true);
  });

  it('rejects the motion-fx master switch on its own', () => {
    // `motion_fx_motion_fx_scrolling: 'yes'` with no `*_effect` produces no
    // motion at all. Counting it as coverage would let a half-written effect set
    // pass as handled — the exact silent failure the guard exists to catch.
    expect(
      hasAnimationSettings(widget({ motion_fx_motion_fx_scrolling: 'yes' })),
    ).toBe(false);
  });

  it('accepts the master switch once a concrete effect is enabled', () => {
    expect(
      hasAnimationSettings(
        widget({ motion_fx_motion_fx_scrolling: 'yes', motion_fx_translateY_effect: 'yes' }),
      ),
    ).toBe(true);
  });

  it('rejects empty-string and null control values', () => {
    // Elementor's "Default" duration IS the empty string, so an element carrying
    // only `_animation: ''` has no entrance.
    expect(hasAnimationSettings(widget({ _animation: '' }))).toBe(false);
    expect(hasAnimationSettings(widget({ _animation: null }))).toBe(false);
  });

  it('ignores an effect control that is set to something other than yes', () => {
    expect(hasAnimationSettings(widget({ motion_fx_translateY_effect: '' }))).toBe(false);
  });
});

// ============================================================================
// checkAnimationParity — native coverage is a real cross-check
// ============================================================================

describe('checkAnimationParity', () => {
  it('counts a native resolution as covered only when the tree carries its settings', () => {
    const settings = { _animation: 'fadeInUp', animation_duration: 'fast' };
    const report = checkAnimationParity(
      { resolutions: [resolution({ nativeSettings: settings })] },
      [widget(settings)],
    );

    expect(report.nativeCovered).toBe(1);
    expect(report.gaps).toEqual([]);
    expect(report.orphanAnimatedElementIds).toEqual([]);
  });

  it('reports a gap when the mapper wrote settings that no element carries', () => {
    // This is the flattening failure: the merge targeted an element that a later
    // pass removed, so the settings exist only in the resolution.
    const report = checkAnimationParity(
      { resolutions: [resolution({ nativeSettings: { _animation: 'fadeInUp' } })] },
      [widget({ _animation: 'fadeInDown' })],
    );

    expect(report.nativeCovered).toBe(0);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0].reason).toContain('no element in the tree carries them');
  });

  it('matches slider values structurally, not by reference', () => {
    // Motion-fx amplitudes are objects. Reference equality would fail even
    // though the emitter merged that exact object.
    const settings = {
      motion_fx_motion_fx_scrolling: 'yes',
      motion_fx_translateY_effect: 'yes',
      motion_fx_translateY_speed: { unit: 'px', size: 1.2, sizes: [] },
    };
    const report = checkAnimationParity(
      { resolutions: [resolution({ nativeSettings: settings })] },
      [widget({ ...settings, motion_fx_translateY_speed: { unit: 'px', size: 1.2, sizes: [] } })],
    );

    expect(report.nativeCovered).toBe(1);
  });

  it('treats a fallback as covered only when a snippet claims its source id', () => {
    const resolutions = [
      resolution({ targetSourceId: 'node-2', decision: 'js-fallback', reason: 'no motion-fx' }),
    ];

    const uncovered = checkAnimationParity({ resolutions }, []);
    expect(uncovered.gaps).toHaveLength(1);
    expect(uncovered.gaps[0].reason).toContain('needs a JS snippet');

    const covered = checkAnimationParity(
      { resolutions, snippetCoveredSourceIds: ['node-2'] },
      [],
    );
    expect(covered.snippetCovered).toBe(1);
    expect(covered.gaps).toEqual([]);
  });

  it('never treats unsupported as handled, even with a snippet claiming it', () => {
    // An `unsupported` verdict means the SOURCE was never classified, so there is
    // no amplitude to reproduce. A snippet claiming it would be fabrication.
    const report = checkAnimationParity(
      {
        resolutions: [resolution({ decision: 'unsupported', reason: 'no motionClass' })],
        snippetCoveredSourceIds: ['node-1'],
      },
      [],
    );

    expect(report.gaps).toHaveLength(1);
    expect(report.snippetCovered).toBe(0);
    expect(report.gaps[0].reason).toBe('no motionClass');
  });

  it('names animated elements that no resolution explains', () => {
    const report = checkAnimationParity({ resolutions: [] }, [widget({ _animation: 'fadeIn' }, 'stray')]);
    expect(report.orphanAnimatedElementIds).toEqual(['stray']);
  });

  it('walks nested elements', () => {
    const settings = { _animation: 'fadeInUp' };
    const tree: V3Element[] = [
      {
        id: 's1',
        elType: 'section',
        elements: [{ id: 'c1', elType: 'column', elements: [widget(settings)] }],
      },
    ];
    const report = checkAnimationParity({ resolutions: [resolution({ nativeSettings: settings })] }, tree);
    expect(report.nativeCovered).toBe(1);
  });

  it('does not let one tree element cover two resolutions', () => {
    // Two animations resolving to identical settings must not both claim the
    // same element: that would report 2/2 coverage for one written entrance.
    const settings = { _animation: 'fadeInUp' };
    const report = checkAnimationParity(
      {
        resolutions: [
          resolution({ targetSourceId: 'node-1', nativeSettings: settings }),
          resolution({ targetSourceId: 'node-9', animationId: 'a-2', nativeSettings: settings }),
        ],
      },
      [widget(settings)],
    );

    expect(report.total).toBe(2);
    expect(report.nativeCovered).toBe(1);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0].targetSourceId).toBe('node-9');
    expect(report.gaps[0].reason).toContain('already accounted for by another animation');
  });
});

// ============================================================================
// Reporting
// ============================================================================

describe('formatParityResult / nativeShare', () => {
  it('passes with an explicit "nothing to account for" when no effects existed', () => {
    const result = formatParityResult(checkAnimationParity({ resolutions: [] }, []));
    expect(result.passed).toBe(true);
    expect(result.message).toContain('nothing to account for');
  });

  it('returns null rather than 100% for a page with no animations', () => {
    // A page with no animations has not met an 80% target; it had no target.
    expect(nativeShare(checkAnimationParity({ resolutions: [] }, []))).toBeNull();
  });

  it('reports the native share as a fraction of all detected effects', () => {
    const settings = { _animation: 'fadeInUp' };
    const report = checkAnimationParity(
      {
        resolutions: [
          resolution({ nativeSettings: settings }),
          resolution({ targetSourceId: 'node-2', decision: 'js-fallback' }),
        ],
        snippetCoveredSourceIds: ['node-2'],
      },
      [widget(settings)],
    );

    expect(report.total).toBe(2);
    expect(nativeShare(report)).toBe(0.5);
  });

  it('fails the guard with the source ids of unhandled effects', () => {
    const guard = createAnimationParityGuard({
      resolutions: [resolution({ targetSourceId: 'hero-title', decision: 'js-fallback', reason: 'no motion-fx' })],
    });
    const result = guard.check([]);

    expect(guard.severity).toBe('warning');
    expect(result.passed).toBe(false);
    expect(result.details).toContain('hero-title');
  });
});

// ============================================================================
// Residual snippets
// ============================================================================

describe('buildResidualSnippets', () => {
  const elementIds = { 'node-1': 'visual-ir-hero', 'node-2': 'visual-ir-band' };

  it('carries a css-fallback entrance as a header CSS snippet plus a footer observer', () => {
    const animation = entranceAnimation();
    const result = buildResidualSnippets({
      resolutions: [resolution({ decision: 'css-fallback', reason: 'no entrance control' })],
      animations: [animation],
      elementIdBySourceId: elementIds,
    });

    expect(result.coveredSourceIds).toEqual(['node-1']);
    expect(result.skipped).toEqual([]);

    const css = result.snippets.find((s) => s.type === 'css');
    expect(css?.location).toBe('header');
    expect(css?.code).toContain('#visual-ir-hero');
    // The measured amplitudes, not a canned 20px.
    expect(css?.code).toContain('translateY(40px)');
    expect(css?.code).toContain('opacity: 0;');
    expect(css?.code).toContain('600ms');

    const js = result.snippets.find((s) => s.type === 'html');
    expect(js?.location).toBe('footer');
    expect(js?.code).toContain('IntersectionObserver');
  });

  it('leaves the element visible when neither JS nor view() timelines are available', () => {
    const result = buildResidualSnippets({
      resolutions: [resolution({ decision: 'css-fallback' })],
      animations: [entranceAnimation()],
      elementIdBySourceId: elementIds,
    });
    const css = result.snippets.find((s) => s.type === 'css')?.code ?? '';

    // The pre-animation state must live behind the reveal class or the @supports
    // block. A bare `#id { opacity: 0 }` would hide content forever on a browser
    // that reaches neither path.
    const bareRule = new RegExp(`#visual-ir-hero\\s*\\{[^}]*opacity:\\s*0`);
    expect(bareRule.test(css)).toBe(false);
    expect(css).toContain('@supports (animation-timeline: view())');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('fires the reveal at the same threshold Elementor uses natively', () => {
    // Mixing a native entrance and a residual one on one page must not produce
    // two different reveal lines.
    const result = buildResidualSnippets({
      resolutions: [resolution({ decision: 'css-fallback' })],
      animations: [entranceAnimation()],
      elementIdBySourceId: elementIds,
    });
    expect(result.snippets.find((s) => s.type === 'html')?.code).toContain('0.1');
  });

  it('carries a js-fallback scroll effect as an rAF-coalesced scrub', () => {
    const animation = scrollAnimation();
    const result = buildResidualSnippets({
      resolutions: [
        resolution({ targetSourceId: 'node-2', animationId: 'a-scroll', decision: 'js-fallback' }),
      ],
      animations: [animation],
      elementIdBySourceId: elementIds,
    });

    expect(result.coveredSourceIds).toEqual(['node-2']);
    const js = result.snippets.find((s) => s.title.includes('Scrub'));
    expect(js?.code).toContain('requestAnimationFrame');
    expect(js?.code).toContain('{ passive: true }');
    // The measured amplitude reaches the snippet verbatim — this is the reason a
    // JS scrub can be MORE faithful than the native speed slider.
    expect(js?.code).toContain('120');
    expect(js?.code).toContain('-120');
  });

  it('guards against a zero viewport height instead of emitting NaN transforms', () => {
    const result = buildResidualSnippets({
      resolutions: [resolution({ targetSourceId: 'node-2', animationId: 'a-scroll', decision: 'js-fallback' })],
      animations: [scrollAnimation()],
      elementIdBySourceId: elementIds,
    });
    expect(result.snippets.find((s) => s.title.includes('Scrub'))?.code).toContain('if (!vh) return 0;');
  });

  it('ignores native and static-approximation resolutions', () => {
    // Re-emitting a written entrance as CSS would double the motion.
    const result = buildResidualSnippets({
      resolutions: [
        resolution({ decision: 'native' }),
        resolution({ decision: 'static-approximation' }),
      ],
      animations: [entranceAnimation()],
      elementIdBySourceId: elementIds,
    });

    expect(result.snippets).toEqual([]);
    expect(result.coveredSourceIds).toEqual([]);
  });

  it('refuses to invent an animation for an unsupported verdict', () => {
    const result = buildResidualSnippets({
      resolutions: [resolution({ decision: 'unsupported' })],
      animations: [entranceAnimation()],
      elementIdBySourceId: elementIds,
    });
    expect(result.coveredSourceIds).toEqual([]);
    expect(result.snippets).toEqual([]);
  });

  it('skips with a reason when the emitter recorded no element id', () => {
    const result = buildResidualSnippets({
      resolutions: [resolution({ decision: 'css-fallback' })],
      animations: [entranceAnimation()],
      elementIdBySourceId: {},
    });

    expect(result.coveredSourceIds).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('no _element_id');
  });

  it('skips with a reason when the animation carries no measured effects', () => {
    const result = buildResidualSnippets({
      resolutions: [resolution({ decision: 'css-fallback' })],
      animations: [entranceAnimation({ effects: [] })],
      elementIdBySourceId: elementIds,
    });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('no measured effects');
  });

  it('skips an element id that would need CSS escaping', () => {
    // Such a selector parses but matches nothing, so it would be reported as
    // coverage while doing nothing.
    const result = buildResidualSnippets({
      resolutions: [resolution({ decision: 'css-fallback' })],
      animations: [entranceAnimation()],
      elementIdBySourceId: { 'node-1': '1-starts-with-digit' },
    });

    expect(result.coveredSourceIds).toEqual([]);
    expect(result.skipped[0].reason).toContain('not a bare CSS identifier');
  });

  it('applies the page guard inside the IIFE so the early return is legal', () => {
    const result = buildResidualSnippets({
      resolutions: [resolution({ decision: 'css-fallback' })],
      animations: [entranceAnimation()],
      elementIdBySourceId: elementIds,
      pageId: 4242,
    });
    const code = result.snippets.find((s) => s.type === 'html')?.code ?? '';

    expect(code).toContain('page-id-4242');
    // The guard must appear AFTER the function opens, or it is a syntax error.
    expect(code.indexOf('(function ()')).toBeLessThan(code.indexOf('page-id-4242'));
  });

  it('produces snippets that pass the WPCode safe-combination validator', () => {
    const result = buildResidualSnippets({
      resolutions: [
        resolution({ decision: 'css-fallback' }),
        resolution({ targetSourceId: 'node-2', animationId: 'a-scroll', decision: 'js-fallback' }),
      ],
      animations: [entranceAnimation(), scrollAnimation()],
      elementIdBySourceId: elementIds,
    });

    expect(result.snippets.length).toBe(3);
    for (const snippet of result.snippets) {
      const validation = validateSnippet(snippet);
      expect(validation.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('returns nothing at all when there is nothing to carry', () => {
    const result = buildResidualSnippets({ resolutions: [], animations: [], elementIdBySourceId: {} });
    expect(result).toEqual({ snippets: [], coveredSourceIds: [], skipped: [], notes: [] });
  });
});

describe('isSafeCssIdent', () => {
  it('accepts the emitter own id shape and rejects what needs escaping', () => {
    expect(isSafeCssIdent('visual-ir-ir_hero_title')).toBe(true);
    expect(isSafeCssIdent('1leading-digit')).toBe(false);
    expect(isSafeCssIdent('has space')).toBe(false);
    expect(isSafeCssIdent('has.dot')).toBe(false);
    expect(isSafeCssIdent('')).toBe(false);
  });
});

// ============================================================================
// End to end: emitter -> mapper -> residual -> parity
// ============================================================================

describe('animation parity end to end', () => {
  function pageIr(animations: AnimationIR[]): VisualPageIR {
    return {
      schemaVersion: '1.0',
      source: {
        url: 'https://example.test/',
        route: '/',
        extractionMode: 'hybrid',
        capturedAt: new Date(0).toISOString(),
        pageId: 'home',
      },
      viewportProfiles: [{ label: 'desktop', width: 1440, height: 900 }],
      tokens: { colors: {}, fonts: [], textStyles: {}, spacing: {} },
      sections: [
        {
          sourceId: 'sec-1',
          role: 'hero',
          layoutArchetype: 'stacked',
          bboxByViewport: { desktop: { x: 0, y: 0, width: 1440, height: 700 } },
          nodes: [
            { sourceId: 'node-1', role: 'heading', tag: 'h1', text: 'Hero', children: [], evidence: EVIDENCE },
            { sourceId: 'node-2', role: 'text', text: 'Band', children: [], evidence: EVIDENCE },
          ],
          evidence: EVIDENCE,
        },
      ],
      assets: [],
      animations,
      warnings: [],
    };
  }

  it('reaches full parity on a Pro site: native settings land on the real elements', () => {
    const animations = [entranceAnimation(), scrollAnimation()];
    const emitted = emitVisualIrToV3(pageIr(animations), { schema: liveSchema });

    const report = checkAnimationParity({ resolutions: emitted.animationResolutions }, emitted.tree);

    expect(report.total).toBe(2);
    expect(report.gaps).toEqual([]);
    expect(report.nativeCovered).toBe(2);
    expect(formatParityResult(report).passed).toBe(true);
  });

  it('closes the gap on a Core-only site only after the residual snippets exist', () => {
    // The scroll effect has no motion-fx module here, so the mapper hands it to a
    // snippet. This is the sequence that used to fail silently: a verdict with no
    // trace in the tree and nothing generated to carry it.
    const animations = [scrollAnimation()];
    const emitted = emitVisualIrToV3(pageIr(animations), { schema: coreOnlySchema });

    const beforeSnippets = checkAnimationParity(
      { resolutions: emitted.animationResolutions },
      emitted.tree,
    );
    expect(beforeSnippets.gaps).toHaveLength(1);
    expect(beforeSnippets.gaps[0].decision).toBe('js-fallback');

    const residual = buildResidualSnippets({
      resolutions: emitted.animationResolutions,
      animations,
      elementIdBySourceId: emitted.elementIdBySourceId,
    });
    expect(residual.coveredSourceIds).toContain('node-2');

    const afterSnippets = checkAnimationParity(
      {
        resolutions: emitted.animationResolutions,
        snippetCoveredSourceIds: residual.coveredSourceIds,
      },
      emitted.tree,
    );
    expect(afterSnippets.gaps).toEqual([]);
    expect(afterSnippets.snippetCovered).toBe(1);
  });

  it('emits selectors that address the ids actually written into the tree', () => {
    // The selector must come from the emitter's own record, not from a rebuilt
    // name: allocateId de-duplicates, so reconstruction is lossy.
    const animations = [scrollAnimation()];
    const emitted = emitVisualIrToV3(pageIr(animations), { schema: coreOnlySchema });
    const residual = buildResidualSnippets({
      resolutions: emitted.animationResolutions,
      animations,
      elementIdBySourceId: emitted.elementIdBySourceId,
    });

    const elementId = emitted.elementIdBySourceId['node-2'];
    expect(elementId).toBeDefined();
    expect(residual.snippets.some((s) => s.code.includes(elementId))).toBe(true);

    const idsInTree = new Set<string>();
    const walk = (elements: readonly V3Element[]): void => {
      for (const element of elements) {
        const value = element.settings?._element_id;
        if (typeof value === 'string') idsInTree.add(value);
        if (element.elements) walk(element.elements);
      }
    };
    walk(emitted.tree);
    expect(idsInTree.has(elementId)).toBe(true);
  });

  it('reports every animation as a gap when no schema was passed', () => {
    // Without a schema the emitter writes nothing, and nothing is generated to
    // carry it. Parity must say so rather than report an approximation.
    const animations = [entranceAnimation()];
    const emitted = emitVisualIrToV3(pageIr(animations), {});

    expect(emitted.animationResolutions).toEqual([]);
    expect(emitted.warnings.join(' ')).toContain('no control schema was passed');

    const report = checkAnimationParity({ resolutions: [] }, emitted.tree);
    expect(report.orphanAnimatedElementIds).toEqual([]);
    expect(nativeShare(report)).toBeNull();
  });

  it('groups residual work the same way the mapper reports it', () => {
    const animations = [scrollAnimation()];
    const mapped = mapAnimations(animations, {
      schema: coreOnlySchema,
      resolveTarget: () => ({ schemaKey: CONTAINER_SCHEMA_KEY }),
    });
    const grouped = residualTargets(mapped);

    expect(grouped.jsFallback).toHaveLength(1);
    expect(grouped.cssFallback).toEqual([]);
    expect(grouped.unsupported).toEqual([]);
  });
});
