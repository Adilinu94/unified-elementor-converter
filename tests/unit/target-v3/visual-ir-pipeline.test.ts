import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildV3FromVisualIr,
  formatAnimationSummary,
  NATIVE_SHARE_TARGET,
  RESIDUAL_SNIPPET_BUDGET,
  schemaIsUsableForAnimations,
} from '@elconv/target-v3';
import {
  validateSnippet,
  type AnimationIR,
  type ResolvedWidgetSchema,
  type VisualPageIR,
  type WidgetSchemaMap,
} from '@elconv/core';

/**
 * The seam that joins the v7.0 animation modules.
 *
 * Every module in `animation/` was unit-tested and none had a production caller,
 * so nothing proved the pieces fit. These tests assert the two things a unit test
 * structurally cannot: that the ORDER is right (snippets before parity), and that
 * the parity guard is scored against artefacts that really exist.
 */
const SNAPSHOT_PATH = resolve(__dirname, '../../../schemas/elementor-v3-controls.snapshot.json');
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as { widgets: WidgetSchemaMap };

const liveSchema: ResolvedWidgetSchema = {
  schema: snapshot.widgets,
  source: 'snapshot',
  degraded: false,
  degradedReasons: [],
};

/** A Core-only site: no Pro motion-fx, so scroll effects must fall back. */
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

/**
 * A site where BOTH animation families are unavailable.
 *
 * Not the same as `coreOnlySchema`, and the difference is a fact worth encoding:
 * the entrance animation is an Elementor **Core** feature, so on a Core-only site
 * an entrance still maps natively and only the scroll effect falls back. Forcing
 * both onto the residual path needs the entrance control removed too.
 */
const noAnimationSchema: ResolvedWidgetSchema = {
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
            ([id]) =>
              !id.startsWith('motion_fx_') &&
              !id.startsWith('sticky') &&
              id !== '_animation' &&
              id !== 'animation',
          ),
        ),
      },
    ]),
  ),
};

const EVIDENCE = { sourceIds: ['x'], methods: ['dom' as const], confidence: 0.85, warnings: [] };

function entrance(overrides: Partial<AnimationIR> = {}): AnimationIR {
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

function scrollLinked(overrides: Partial<AnimationIR> = {}): AnimationIR {
  return {
    id: 'a-scroll',
    kind: 'scroll',
    targetSourceId: 'node-2',
    intent: 'scroll:translateY',
    motionClass: 'scroll-linked',
    effects: [{ kind: 'translateY', from: 100, to: -100, range: 200, monotonic: true }],
    evidence: EVIDENCE,
    ...overrides,
  };
}

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

// ============================================================================
// The ordering guarantee
// ============================================================================

describe('buildV3FromVisualIr — ordering', () => {
  it('scores parity AFTER the residual snippets, so a fallback is not a gap', () => {
    // On a Core-only site the scroll effect has no motion-fx module. Parity run
    // before the snippet exists would report it as unhandled — a failing build
    // where nothing is actually wrong. This is the reason the seam exists.
    const result = buildV3FromVisualIr(pageIr([scrollLinked()]), {
      schema: coreOnlySchema,
      pageId: 42,
    });

    expect(result.animation.parity.gaps).toEqual([]);
    expect(result.animation.parity.snippetCovered).toBe(1);
    expect(result.snippets.length).toBeGreaterThan(0);

    const parityGuard = result.guards.results.find((entry) => entry.name.startsWith('G_ANIMATION_PARITY'));
    expect(parityGuard?.result.passed).toBe(true);
  });

  it('includes the per-run parity guard in the standard report', () => {
    const result = buildV3FromVisualIr(pageIr([entrance()]), { schema: liveSchema, pageId: 42 });
    const names = result.guards.results.map((entry) => entry.name);

    expect(names.some((name) => name.startsWith('G_ANIMATION_PARITY'))).toBe(true);
    // The standard set must still be there — the parity guard is an addition,
    // not a replacement.
    expect(names.some((name) => name.startsWith('G1'))).toBe(true);
  });

  it('still fails parity when a fallback exists and nothing carries it', () => {
    // A scroll effect with no measured amplitude cannot be carried by a snippet,
    // so the build must keep reporting the gap rather than quietly passing.
    const unclassified = scrollLinked({ effects: [] });
    const result = buildV3FromVisualIr(pageIr([unclassified]), {
      schema: coreOnlySchema,
      pageId: 42,
    });

    expect(result.snippets).toEqual([]);
    expect(result.animation.parity.gaps).toHaveLength(1);
    const parityGuard = result.guards.results.find((entry) => entry.name.startsWith('G_ANIMATION_PARITY'));
    expect(parityGuard?.result.passed).toBe(false);
  });
});

// ============================================================================
// Native path
// ============================================================================

describe('buildV3FromVisualIr — native path', () => {
  it('emits zero snippets when every effect is reproduced natively', () => {
    // Akzeptanz B: 0 non-native effects means 0 snippets, and the animations are
    // still present — natively.
    const result = buildV3FromVisualIr(pageIr([entrance(), scrollLinked()]), {
      schema: liveSchema,
      pageId: 42,
    });

    expect(result.snippets).toEqual([]);
    expect(result.animation.parity.nativeCovered).toBe(2);
    expect(result.animation.parity.gaps).toEqual([]);
    expect(result.animation.nativeShare).toBe(1);
    expect(result.animation.meetsNativeTarget).toBe(true);
  });

  it('reports meetsNativeTarget false for a page with no animations at all', () => {
    // A page with no animations has not met an 80% target; it had no target.
    const result = buildV3FromVisualIr(pageIr([]), { schema: liveSchema });

    expect(result.animation.nativeShare).toBeNull();
    expect(result.animation.meetsNativeTarget).toBe(false);
    expect(result.animation.report).toContain('none detected');
  });

  it('warns when the native share falls below the target', () => {
    const result = buildV3FromVisualIr(pageIr([scrollLinked()]), {
      schema: coreOnlySchema,
      pageId: 42,
    });

    expect(result.animation.nativeShare).toBe(0);
    expect(result.animation.meetsNativeTarget).toBe(false);
    expect(result.warnings.join(' ')).toContain(`below the ${NATIVE_SHARE_TARGET * 100}% target`);
  });

  it('keeps an entrance native on a Core-only site — only the scroll effect falls back', () => {
    // Entrance animations ship with Elementor Core; motion effects need Pro. So
    // removing Pro must cost exactly one of these two, and a mixed page reaches
    // 50% native rather than 0%.
    const result = buildV3FromVisualIr(pageIr([entrance(), scrollLinked()]), {
      schema: coreOnlySchema,
      pageId: 42,
    });

    expect(result.animation.nativeShare).toBe(0.5);
    expect(result.animation.parity.nativeCovered).toBe(1);
    expect(result.animation.parity.snippetCovered).toBe(1);
    expect(result.animation.parity.gaps).toEqual([]);
  });
});

// ============================================================================
// Snippet hygiene
// ============================================================================

describe('buildV3FromVisualIr — snippets', () => {
  it('warns rather than silently emitting site-wide snippets', () => {
    const result = buildV3FromVisualIr(pageIr([scrollLinked()]), { schema: coreOnlySchema });

    expect(result.snippets.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toContain('will apply site-wide');
  });

  it('scopes snippets to the page when a pageId is given', () => {
    const result = buildV3FromVisualIr(pageIr([scrollLinked()]), {
      schema: coreOnlySchema,
      pageId: 777,
    });

    expect(result.warnings.join(' ')).not.toContain('site-wide');
    expect(result.snippets.some((snippet) => snippet.code.includes('page-id-777'))).toBe(true);
  });

  it('produces snippets that pass the WPCode safe-combination validator', () => {
    // A snippet WPCode rejects is a silent no-op on the live site.
    const result = buildV3FromVisualIr(pageIr([entrance(), scrollLinked()]), {
      schema: coreOnlySchema,
      pageId: 42,
    });

    expect(result.snippets.length).toBeGreaterThan(0);
    for (const snippet of result.snippets) {
      expect(validateSnippet(snippet).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });

  it('reports exceeding the snippet budget instead of hiding it', () => {
    // An entrance needs a CSS block AND its observer, so an entrance plus a
    // scroll effect is 3 snippets — over the plan's budget of 2 by design.
    // `noAnimationSchema`, not `coreOnlySchema`: entrance animations are a Core
    // feature, so on a Core-only site the entrance maps natively and only the
    // scroll effect would fall back.
    const result = buildV3FromVisualIr(pageIr([entrance(), scrollLinked()]), {
      schema: noAnimationSchema,
      pageId: 42,
    });

    expect(result.snippets.length).toBe(3);
    expect(result.snippets.length).toBeGreaterThan(RESIDUAL_SNIPPET_BUDGET);
    expect(result.warnings.join(' ')).toContain('exceed the budget');
  });

  it('surfaces a residual skip as a warning naming the animation', () => {
    const result = buildV3FromVisualIr(pageIr([scrollLinked({ effects: [] })]), {
      schema: coreOnlySchema,
      pageId: 42,
    });

    expect(result.animation.residualSkips.length + result.animation.parity.gaps.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toContain('a-scroll');
  });

  it('carries the entrance fidelity caveat into the notes', () => {
    // A CSS-only entrance cannot reproduce a viewport-triggered reveal without
    // JS, and the report must say so rather than imply parity.
    const result = buildV3FromVisualIr(pageIr([entrance()]), {
      schema: noAnimationSchema,
      pageId: 42,
    });

    expect(result.animation.residualNotes.join(' ')).toContain('un-animated');
    expect(result.animation.report).toContain('Residual snippet fidelity');
  });
});

// ============================================================================
// No schema
// ============================================================================

describe('buildV3FromVisualIr — without a schema', () => {
  it('writes no animation setting and says why', () => {
    const result = buildV3FromVisualIr(pageIr([entrance()]), {});

    expect(result.animation.resolutions).toEqual([]);
    expect(result.snippets).toEqual([]);
    expect(result.warnings.join(' ')).toContain('no control schema was passed');
    // No resolutions means nothing to account for — not a false pass claim.
    expect(result.animation.parity.total).toBe(0);
  });

  it('still produces a usable tree', () => {
    // The absence of a schema must cost the animations, not the page.
    const result = buildV3FromVisualIr(pageIr([entrance()]), {});
    expect(result.tree).toHaveLength(1);
    expect(result.canContinue).toBe(true);
  });
});

describe('schemaIsUsableForAnimations', () => {
  it('rejects an absent schema with an actionable reason', () => {
    const verdict = schemaIsUsableForAnimations(undefined);
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toContain('loadWidgetSchemaFromSnapshot');
  });

  it('accepts a degraded schema but names the caveat', () => {
    // A degraded schema is still usable: a control reported absent may exist
    // live, so refusing to write anything would lose more than it protects.
    const verdict = schemaIsUsableForAnimations({
      ...liveSchema,
      degraded: true,
      degradedReasons: ['live fetch failed'],
    });
    expect(verdict.usable).toBe(true);
    expect(verdict.reason).toContain('live fetch failed');
  });

  it('accepts a clean schema', () => {
    expect(schemaIsUsableForAnimations(liveSchema)).toEqual({ usable: true, reason: 'snapshot schema' });
  });
});

// ============================================================================
// Report
// ============================================================================

describe('formatAnimationSummary', () => {
  it('states the native share against the target', () => {
    const result = buildV3FromVisualIr(pageIr([entrance(), scrollLinked()]), {
      schema: liveSchema,
      pageId: 42,
    });
    expect(result.animation.report).toContain('native share: 100%');
    expect(result.animation.report).toContain('target 80%');
  });

  it('names each unhandled effect rather than only counting them', () => {
    const report = formatAnimationSummary(
      [
        {
          targetSourceId: 'hero-title',
          animationId: 'a-1',
          decision: 'unsupported',
          nativeSettings: {},
          reason: 'no motionClass',
          companionsApplied: [],
          precisionLoss: [],
        },
      ],
      {
        nativeCovered: 0,
        snippetCovered: 0,
        gaps: [
          { targetSourceId: 'hero-title', animationId: 'a-1', decision: 'unsupported', reason: 'no motionClass' },
        ],
        orphanAnimatedElementIds: [],
        total: 1,
      },
      0,
      [],
    );

    expect(report).toContain('hero-title');
    expect(report).toContain('no motionClass');
  });
});
