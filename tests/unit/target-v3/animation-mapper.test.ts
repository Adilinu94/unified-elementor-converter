import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_STAGGER_STEP_MS,
  DURATION_ENUM,
  ENTRANCE_ANIMATION_KEYS,
  MOTION_FX_SPEED_MAX,
  MOTION_FX_SPEED_STEP,
  NON_NATIVE_MOTION,
  durationEnumFor,
  durationMsForEnum,
  entranceControlId,
  entranceDirectionFrom,
  formatAnimationMappingReport,
  isContainerFamily,
  isKnownEntranceAnimation,
  mapAnimations,
  mapSticky,
  renderedAmplitudeFor,
  requiredSpeedFor,
  residualTargets,
  resolveAnimationControlIds,
  resolveMotionFxIds,
  snapToStep,
  type AnimationTargetInfo,
} from '@elconv/target-v3';
import {
  CONTAINER_SCHEMA_KEY,
  validateSettingsAgainstSchema,
  type AnimationIR,
  type ResolvedWidgetSchema,
  type SchemaGateElement,
  type WidgetSchemaMap,
} from '@elconv/core';

/**
 * Arbeitspaket B4 — AnimationIR → native Elementor settings.
 *
 * The schema below is not hand-written: it is the committed snapshot pulled live
 * from testseite.nick-webdesign.de (Elementor 4.2.1 + Pro 4.1.0, `missing: []`).
 * That matters for exactly the thing this module gets wrong most easily — the
 * container/widget name split (`animation` vs `_animation`) and the companion
 * conditions. A test against an invented schema would pass while the real deploy
 * is rejected.
 */
const SNAPSHOT_PATH = resolve(__dirname, '../../../schemas/elementor-v3-controls.snapshot.json');
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
  elementor: { version: string; pro?: string };
  missing: string[];
  widgets: WidgetSchemaMap;
};

const liveSchema: ResolvedWidgetSchema = {
  schema: snapshot.widgets,
  source: 'snapshot',
  degraded: false,
  degradedReasons: [],
};

/**
 * A site without the Pro motion-fx and sticky modules: every `motion_fx_*` and
 * `sticky` control removed.
 *
 * NOT the live target. Measured there (2026-08-28): PRO Elements 4.2.2 is active
 * with `elementor-pro` installed-but-inactive, `ELEMENTOR_PRO_VERSION` is
 * defined, and `motion-fx` + `sticky` are among the loaded modules — so the real
 * snapshot above HAS every Pro control. This variant exists to prove the mapper
 * falls back honestly on a Core-only site instead of writing keys the server
 * would reject.
 */
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

function target(schemaKey: string, extra: Partial<AnimationTargetInfo> = {}): AnimationTargetInfo {
  return { schemaKey, ...extra };
}

function ctxFor(
  targets: Record<string, AnimationTargetInfo>,
  schema: ResolvedWidgetSchema = liveSchema,
) {
  return { schema, resolveTarget: (id: string) => targets[id] };
}

const EVIDENCE = { sourceIds: ['x'], methods: ['dom' as const], confidence: 0.8, warnings: [] };

function animation(overrides: Partial<AnimationIR> = {}): AnimationIR {
  return {
    id: 'a1',
    kind: 'scroll',
    targetSourceId: 'node-1',
    intent: 'entrance:opacity+translateY',
    motionClass: 'entrance',
    effects: [
      { kind: 'opacity', from: 0, to: 1, range: 1, monotonic: true },
      { kind: 'translateY', from: 50, to: 0, range: 50, monotonic: true },
    ],
    evidence: EVIDENCE,
    ...overrides,
  };
}

// ============================================================================
// The name split — the single fact that a hardcoded table gets wrong
// ============================================================================

describe('animation/control-names — container vs widget naming', () => {
  it('confirms the split against the live snapshot rather than assuming it', () => {
    const container = snapshot.widgets[CONTAINER_SCHEMA_KEY].controls;
    const heading = snapshot.widgets.heading.controls;

    expect(container.animation).toBeDefined();
    expect(container._animation).toBeUndefined();
    expect(heading._animation).toBeDefined();
    expect(heading.animation).toBeUndefined();

    // `animation_duration` is the odd one out: unprefixed on BOTH families.
    expect(container.animation_duration).toBeDefined();
    expect(heading.animation_duration).toBeDefined();
    expect(heading._animation_duration).toBeUndefined();
  });

  it('resolves the entrance control id per family', () => {
    expect(entranceControlId(CONTAINER_SCHEMA_KEY)).toBe('animation');
    expect(entranceControlId('heading')).toBe('_animation');
    expect(entranceControlId('button')).toBe('_animation');
  });

  it('treats legacy section and column as the container family', () => {
    // Elementor exposes no schema for them (they are in `missing`), but
    // includes/elements/section.php registers plain `animation`.
    expect(snapshot.missing.includes('section') || snapshot.widgets.section === undefined).toBe(true);
    expect(isContainerFamily('section')).toBe(true);
    expect(isContainerFamily('column')).toBe(true);
    expect(entranceControlId('section')).toBe('animation');
  });

  it('reports every id as absent when no schema entry is available', () => {
    const ids = resolveAnimationControlIds('heading', undefined);
    expect(ids.family).toBe('widget');
    expect(ids.entrance).toBeUndefined();
    expect(ids.sticky).toBeUndefined();
    // The family is still known from the key — that is a naming fact, not a
    // schema lookup — but no id may be written unverified.
    expect(Object.values(ids).filter((v) => typeof v === 'string' && v !== 'widget')).toEqual([]);
  });

  it('resolves the css_classes split too', () => {
    expect(resolveAnimationControlIds(CONTAINER_SCHEMA_KEY, snapshot.widgets[CONTAINER_SCHEMA_KEY]).cssClasses)
      .toBe('css_classes');
    expect(resolveAnimationControlIds('heading', snapshot.widgets.heading).cssClasses)
      .toBe('_css_classes');
  });

  it('resolves motion-fx field names that differ per effect', () => {
    const controls = snapshot.widgets[CONTAINER_SCHEMA_KEY].controls;
    const translateY = resolveMotionFxIds('translateY', controls)!;
    const scale = resolveMotionFxIds('scale', controls)!;

    // Measured: translate/rotate use `affectedRange`, scale/opacity/blur use
    // `range`. The two names are not interchangeable.
    expect(translateY.affectedRange).toBe('motion_fx_translateY_affectedRange');
    expect(translateY.range).toBeUndefined();
    expect(scale.range).toBe('motion_fx_scale_range');
    expect(scale.affectedRange).toBeUndefined();

    // opacity carries `level`, the transforms carry `speed`.
    expect(resolveMotionFxIds('opacity', controls)!.level).toBe('motion_fx_opacity_level');
    expect(resolveMotionFxIds('opacity', controls)!.speed).toBeUndefined();
    expect(translateY.speed).toBe('motion_fx_translateY_speed');
  });

  it('returns null for a motion-fx effect the schema does not declare', () => {
    expect(resolveMotionFxIds('translateY', coreOnlySchema.schema[CONTAINER_SCHEMA_KEY].controls)).toBeNull();
    expect(resolveMotionFxIds('translateY', undefined)).toBeNull();
  });
});

// ============================================================================
// Duration enum — a measured precision boundary, not a taste call
// ============================================================================

describe('animation/control-names — duration enum', () => {
  it('matches the enum the snapshot declares', () => {
    const control = snapshot.widgets[CONTAINER_SCHEMA_KEY].controls.animation_duration;
    expect(control.opts).toEqual([...DURATION_ENUM]);
  });

  it('maps to the nearest of the three durations frontend.css actually renders', () => {
    // .animated{1.25s} .animated-slow{2s} .animated-fast{0.75s}
    expect(durationMsForEnum('fast')).toBe(750);
    expect(durationMsForEnum('')).toBe(1250);
    expect(durationMsForEnum('slow')).toBe(2000);

    expect(durationEnumFor(300)).toBe('fast');
    expect(durationEnumFor(750)).toBe('fast');
    expect(durationEnumFor(999)).toBe('fast');
    // Midpoint of 750 and 1250.
    expect(durationEnumFor(1000)).toBe('');
    expect(durationEnumFor(1250)).toBe('');
    expect(durationEnumFor(1624)).toBe('');
    // Midpoint of 1250 and 2000.
    expect(durationEnumFor(1625)).toBe('slow');
    expect(durationEnumFor(5000)).toBe('slow');
  });

  it('treats a nonsensical duration as the default rather than throwing', () => {
    expect(durationEnumFor(0)).toBe('');
    expect(durationEnumFor(-5)).toBe('');
    expect(durationEnumFor(Number.NaN)).toBe('');
  });
});

// ============================================================================
// Entrance direction — the sign convention
// ============================================================================

describe('animation/animation-mapper — entrance direction', () => {
  it('reads the direction from the measured start offset, matching Elementor keyframes', () => {
    // fadeInUp starts at translate3d(0, +100%, 0) and rises, so a source that
    // starts positive and ends at 0 is `up`. Getting this backwards produces an
    // animation moving the wrong way while passing every schema check.
    expect(entranceDirectionFrom([{ kind: 'translateY', from: 50, to: 0, range: 50 }])).toBe('up');
    expect(entranceDirectionFrom([{ kind: 'translateY', from: -50, to: 0, range: 50 }])).toBe('down');
    // fadeInLeft starts at translate3d(-100%, 0, 0).
    expect(entranceDirectionFrom([{ kind: 'translateX', from: -80, to: 0, range: 80 }])).toBe('left');
    expect(entranceDirectionFrom([{ kind: 'translateX', from: 80, to: 0, range: 80 }])).toBe('right');
  });

  it('has no direction when nothing translated', () => {
    expect(entranceDirectionFrom([{ kind: 'opacity', from: 0, to: 1, range: 1 }])).toBe('none');
    expect(entranceDirectionFrom([])).toBe('none');
  });

  it('has no direction from a zero-amplitude translate', () => {
    // The probe never emits one, but a hand-built IR can. `from > to` on two
    // equal values would otherwise resolve to `down` — a direction invented from
    // a non-measurement, and Elementor would animate an element that never moved.
    expect(entranceDirectionFrom([{ kind: 'translateY', from: 0, to: 0, range: 0 }])).toBe('none');
    expect(entranceDirectionFrom([
      { kind: 'translateY', from: 0, to: 0, range: 0 },
      { kind: 'translateX', from: -40, to: 0, range: 40 },
    ])).toBe('left');
  });

  it('picks the dominant axis when both moved, because Elementor has no diagonal', () => {
    const direction = entranceDirectionFrom([
      { kind: 'translateX', from: 10, to: 0, range: 10 },
      { kind: 'translateY', from: 90, to: 0, range: 90 },
    ]);
    expect(direction).toBe('up');
  });
});

// ============================================================================
// Entrance mapping
// ============================================================================

describe('animation/animation-mapper — entrance', () => {
  it('maps the measured fade-up onto _animation: fadeInUp on a widget', () => {
    const result = mapAnimations([animation()], ctxFor({ 'node-1': target('heading') }));
    const [resolution] = result.resolutions;
    expect(resolution.nativeSettings._animation).toBe('fadeInUp');
    expect(resolution.nativeSettings.animation).toBeUndefined();
    expect(isKnownEntranceAnimation('fadeInUp')).toBe(true);
  });

  it('uses the unprefixed control on a container', () => {
    const result = mapAnimations([animation()], ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }));
    const [resolution] = result.resolutions;
    expect(resolution.nativeSettings.animation).toBe('fadeInUp');
    expect(resolution.nativeSettings._animation).toBeUndefined();
  });

  it('chooses a zoom key when the source started scaled down', () => {
    // Measured on the real page: framer-1abc2qs-container starts at
    // matrix(0.7,…) with opacity 0.
    const result = mapAnimations(
      [animation({
        effects: [
          { kind: 'opacity', from: 0, to: 1, range: 1, monotonic: true },
          { kind: 'scale', from: 0.7, to: 1, range: 0.3, monotonic: true },
        ],
      })],
      ctxFor({ 'node-1': target('image') }),
    );
    expect(result.resolutions[0].nativeSettings._animation).toBe('zoomIn');
  });

  it('reports the travel-distance gap instead of implying a pixel match', () => {
    const [resolution] = mapAnimations([animation()], ctxFor({ 'node-1': target('heading') })).resolutions;
    // Elementor's fadeInUp travels 100% of the element's own height; the source
    // moved a fixed 50px. That is a real difference and it is named.
    expect(resolution.decision).toBe('static-approximation');
    expect(resolution.precisionLoss.join(' ')).toContain('50px');
    expect(resolution.precisionLoss.join(' ')).toContain("100% of the element's own size");
  });

  it('reports the 0.3 floor when the source scaled up from zero', () => {
    // Measured: Content-box framer-dzq2bx starts at matrix(0,0,0,0,0,0).
    const [resolution] = mapAnimations(
      [animation({
        effects: [
          { kind: 'opacity', from: 0, to: 1, range: 1, monotonic: true },
          { kind: 'scale', from: 0, to: 1, range: 1, monotonic: true },
        ],
      })],
      ctxFor({ 'node-1': target('image') }),
    ).resolutions;
    expect(resolution.precisionLoss.join(' ')).toContain('begins at 0.3');
  });

  it('writes animation_duration with its companion and names the rounding', () => {
    const [resolution] = mapAnimations(
      [animation({ durationMs: 500 })],
      ctxFor({ 'node-1': target('heading') }),
    ).resolutions;
    expect(resolution.nativeSettings.animation_duration).toBe('fast');
    expect(resolution.companionsApplied).toContain('animation_duration');
    expect(resolution.precisionLoss.join(' ')).toContain('renders 750ms');
  });

  it('omits the duration entirely when the source measured none', () => {
    // The scroll sweep samples settled states, so it reports no duration.
    // Inventing one would be fabrication.
    const [resolution] = mapAnimations([animation()], ctxFor({ 'node-1': target('heading') })).resolutions;
    expect(resolution.nativeSettings.animation_duration).toBeUndefined();
    expect(resolution.precisionLoss.join(' ')).toContain('duration unknown from the source');
  });

  it('never chooses an entrance when the motion class is unknown', () => {
    // element-base.php adds .elementor-invisible to any element with an
    // entrance, and frontend.css hides it until the JS handler runs. A wrong
    // entrance can therefore make content permanently invisible.
    for (const motionClass of [undefined, 'indeterminate' as const]) {
      const [resolution] = mapAnimations(
        [animation({ motionClass })],
        ctxFor({ 'node-1': target('heading') }),
      ).resolutions;
      expect(resolution.decision).toBe('unsupported');
      expect(resolution.nativeSettings).toEqual({});
      expect(resolution.reason).toMatch(/elementor-invisible|not classified/);
    }
  });

  it('falls back to CSS when the schema declares no entrance control', () => {
    const [resolution] = mapAnimations(
      [animation()],
      ctxFor({ 'node-1': target('heading') }, {
        ...liveSchema,
        schema: {
          heading: { widgetType: 'heading', complete: true, controls: { title: { t: 'textarea' } } },
        },
      }),
    ).resolutions;
    expect(resolution.decision).toBe('css-fallback');
    expect(resolution.nativeSettings).toEqual({});
  });
});

// ============================================================================
// Stagger
// ============================================================================

describe('animation/animation-mapper — stagger', () => {
  const siblings: AnimationIR[] = [0, 1, 2].map((index) =>
    animation({ id: `a${index}`, targetSourceId: `node-${index}` }),
  );
  const siblingTargets = Object.fromEntries(
    [0, 1, 2].map((index) => [
      `node-${index}`,
      target('heading', { parentSourceId: 'row', indexInParent: index }),
    ]),
  );

  it('replaces GSAP stagger with ascending _animation_delay', () => {
    const result = mapAnimations(siblings, ctxFor(siblingTargets));
    const delays = result.resolutions.map((r) => r.nativeSettings._animation_delay);
    expect(delays).toEqual([undefined, DEFAULT_STAGGER_STEP_MS, DEFAULT_STAGGER_STEP_MS * 2]);
  });

  it('orders by indexInParent, not by the animation list order', () => {
    const reversed = [...siblings].reverse();
    const result = mapAnimations(reversed, ctxFor(siblingTargets));
    const byTarget = new Map(result.resolutions.map((r) => [r.targetSourceId, r.nativeSettings._animation_delay]));
    expect(byTarget.get('node-0')).toBeUndefined();
    expect(byTarget.get('node-2')).toBe(DEFAULT_STAGGER_STEP_MS * 2);
  });

  it('does not stagger a lone element', () => {
    const result = mapAnimations([siblings[0]], ctxFor(siblingTargets));
    expect(result.resolutions[0].nativeSettings._animation_delay).toBeUndefined();
  });

  it('does not stagger across different travel directions', () => {
    const mixed = [
      animation({ id: 'up', targetSourceId: 'node-0' }),
      animation({
        id: 'down',
        targetSourceId: 'node-1',
        effects: [
          { kind: 'opacity', from: 0, to: 1, range: 1, monotonic: true },
          { kind: 'translateY', from: -50, to: 0, range: 50, monotonic: true },
        ],
      }),
    ];
    const result = mapAnimations(mixed, ctxFor(siblingTargets));
    for (const resolution of result.resolutions) {
      expect(resolution.nativeSettings._animation_delay).toBeUndefined();
    }
  });

  it('does not stagger when the parent is unknown', () => {
    const result = mapAnimations(siblings, ctxFor(
      Object.fromEntries([0, 1, 2].map((i) => [`node-${i}`, target('heading')])),
    ));
    for (const resolution of result.resolutions) {
      expect(resolution.nativeSettings._animation_delay).toBeUndefined();
    }
  });

  it('honours disableStagger', () => {
    const result = mapAnimations(siblings, { ...ctxFor(siblingTargets), disableStagger: true });
    for (const resolution of result.resolutions) {
      expect(resolution.nativeSettings._animation_delay).toBeUndefined();
    }
  });

  it('uses a custom step when asked', () => {
    const result = mapAnimations(siblings, { ...ctxFor(siblingTargets), staggerStepMs: 250 });
    expect(result.resolutions[2].nativeSettings._animation_delay).toBe(500);
  });
});

// ============================================================================
// Scroll-linked — the amplitude inversion
// ============================================================================

describe('animation/animation-mapper — motion-fx amplitude', () => {
  it('inverts Pro getElementStep for translate and rotate', () => {
    // -(passedPercents - 50) * speed over a 0..100 pass = 100 * speed px total.
    expect(requiredSpeedFor('translateY', { kind: 'translateY', from: 365, to: 0, range: 365 }))
      .toBeCloseTo(3.65, 4);
    expect(renderedAmplitudeFor('translateY', 3.65)).toBeCloseTo(365, 4);
    expect(requiredSpeedFor('rotateZ', { kind: 'rotate', from: -8, to: 0, range: 8 }))
      .toBeCloseTo(0.08, 4);
  });

  it('inverts the scale formula, which is not the translate one', () => {
    // 1 + speed * movePoint / 1000, movePoint 0..100 → span = speed / 10.
    expect(requiredSpeedFor('scale', { kind: 'scale', from: 1, to: 1.1, range: 0.1 }))
      .toBeCloseTo(1, 4);
    expect(renderedAmplitudeFor('scale', 1)).toBeCloseTo(0.1, 4);
  });

  it('refuses to derive a speed from a non-amplitude', () => {
    expect(requiredSpeedFor('translateY', { kind: 'translateY', from: 0, to: 0, range: 0 })).toBeUndefined();
    expect(requiredSpeedFor('translateY', { kind: 'translateY', from: 0, to: 0, range: Number.NaN }))
      .toBeUndefined();
  });

  it('snaps to the slider step and never below one step', () => {
    expect(snapToStep(3.65)).toBe(3.7);
    expect(snapToStep(0.08)).toBe(0.1);
    expect(snapToStep(0.0001)).toBe(MOTION_FX_SPEED_STEP);
  });

  it('maps the measured image zoom to a scale effect with all companions', () => {
    const [resolution] = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        intent: 'scroll-linked:scale',
        effects: [{ kind: 'scale', from: 1, to: 1.1, range: 0.1, monotonic: false }],
      })],
      ctxFor({ 'node-1': target('image') }),
    ).resolutions;

    expect(resolution.nativeSettings.motion_fx_motion_fx_scrolling).toBe('yes');
    expect(resolution.nativeSettings.motion_fx_scale_effect).toBe('yes');
    expect(resolution.nativeSettings.motion_fx_scale_speed).toEqual({ unit: 'px', size: 1, sizes: [] });
    expect(resolution.companionsApplied).toContain('motion_fx_motion_fx_scrolling');
    expect(resolution.companionsApplied).toContain('motion_fx_scale_effect');
    expect(resolution.decision).toBe('native');
  });

  it('reports the resolution loss on the measured 8-degree rotation', () => {
    // 8° needs speed 0.08, below the 0.1 slider step → renders 10°.
    const [resolution] = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        intent: 'scroll-linked:rotate',
        effects: [{ kind: 'rotate', from: -8, to: 0, range: 8, monotonic: true }],
      })],
      ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }),
    ).resolutions;

    expect(resolution.nativeSettings.motion_fx_rotateZ_effect).toBe('yes');
    expect(resolution.nativeSettings.motion_fx_rotateZ_speed).toEqual({ unit: 'px', size: 0.1, sizes: [] });
    expect(resolution.decision).toBe('static-approximation');
    expect(resolution.precisionLoss.join(' ')).toContain('10.0°');
  });

  it('declares the measured horizontal run unreachable instead of clamping it', () => {
    // 2950px needs speed 29.5 — nearly 3x the control maximum. Clamping to 10
    // would render 1000px and look like a successful mapping.
    const [resolution] = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        intent: 'scroll-linked:translateX',
        effects: [{ kind: 'translateX', from: 1900, to: -1050, range: 2950, monotonic: true }],
      })],
      ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }),
    ).resolutions;

    expect(resolution.decision).toBe('js-fallback');
    expect(resolution.nativeSettings).toEqual({});
    expect(resolution.reason).toContain('29.50');
    expect(resolution.reason).toContain(String(MOTION_FX_SPEED_MAX));
  });

  it('picks the right direction family per effect type', () => {
    const flip = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        effects: [{ kind: 'translateY', from: 0, to: 200, range: 200, monotonic: true }],
      })],
      ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }),
    ).resolutions[0];
    // Rising series needs the binary flip, not a phase word.
    expect(flip.nativeSettings.motion_fx_translateY_direction).toBe('negative');

    const phase = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        effects: [{ kind: 'scale', from: 1.1, to: 1, range: 0.1, monotonic: true }],
      })],
      ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }),
    ).resolutions[0];
    // Shrinking scale is the four-phase control's `in-out`, never 'negative'.
    expect(phase.nativeSettings.motion_fx_scale_direction).toBe('in-out');
  });

  it('falls back to JS on a Core-only site rather than writing Pro keys', () => {
    const [resolution] = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        effects: [{ kind: 'scale', from: 1, to: 1.1, range: 0.1 }],
      })],
      ctxFor({ 'node-1': target('image') }, coreOnlySchema),
    ).resolutions;
    expect(resolution.decision).toBe('js-fallback');
    // Names both providers, because the capability is not tied to one plugin.
    expect(resolution.reason).toContain('pro-elements');
    expect(resolution.reason).toContain('elementor-pro');
    expect(resolution.nativeSettings).toEqual({});
  });

  it('maps natively on the real target schema, which HAS the Pro controls', () => {
    // The live snapshot comes from a site running PRO Elements, not Elementor
    // Pro. The mapper asks the schema, not the plugin list — so a fork provides
    // the capability transparently.
    expect(snapshot.widgets[CONTAINER_SCHEMA_KEY].controls.motion_fx_motion_fx_scrolling)
      .toBeDefined();
    expect(snapshot.widgets[CONTAINER_SCHEMA_KEY].controls.sticky).toBeDefined();

    const [resolution] = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        effects: [{ kind: 'scale', from: 1, to: 1.1, range: 0.1, monotonic: false }],
      })],
      ctxFor({ 'node-1': target('image') }),
    ).resolutions;
    expect(resolution.decision).toBe('native');
  });

  it('refuses scroll-linked motion that carries no amplitude', () => {
    const [resolution] = mapAnimations(
      [animation({ motionClass: 'scroll-linked', effects: [] })],
      ctxFor({ 'node-1': target('image') }),
    ).resolutions;
    expect(resolution.decision).toBe('unsupported');
    expect(resolution.reason).toContain('no measured effects');
  });

  it('maps what it can and names what it could not', () => {
    const [resolution] = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        effects: [
          { kind: 'scale', from: 1, to: 1.1, range: 0.1 },
          { kind: 'translateX', from: 1900, to: -1050, range: 2950 },
        ],
      })],
      ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }),
    ).resolutions;
    expect(resolution.nativeSettings.motion_fx_scale_effect).toBe('yes');
    expect(resolution.nativeSettings.motion_fx_translateX_effect).toBeUndefined();
    expect(resolution.decision).toBe('static-approximation');
    expect(resolution.precisionLoss.join(' ')).toContain('partially mapped');
  });
});

// ============================================================================
// Sticky
// ============================================================================

describe('animation/animation-mapper — sticky', () => {
  it('maps the two measured sticky elements with their offsets', () => {
    const result = mapSticky(
      [
        { targetSourceId: 'sticky-1', top: '50px' },
        { targetSourceId: 'sticky-2', top: '0px' },
      ],
      ctxFor({
        'sticky-1': target(CONTAINER_SCHEMA_KEY),
        'sticky-2': target(CONTAINER_SCHEMA_KEY),
      }),
    );
    expect(result.nativeCount).toBe(2);
    expect(result.resolutions[0].nativeSettings).toEqual({ sticky: 'top', sticky_offset: 50 });
    expect(result.resolutions[1].nativeSettings).toEqual({ sticky: 'top', sticky_offset: 0 });
    expect(result.resolutions[0].companionsApplied).toContain('sticky_offset');
  });

  it('distinguishes a bottom-sticky element from a top-sticky one', () => {
    const result = mapSticky(
      [{ targetSourceId: 'sticky-1', bottom: '20px' }],
      ctxFor({ 'sticky-1': target(CONTAINER_SCHEMA_KEY) }),
    );
    expect(result.resolutions[0].nativeSettings.sticky).toBe('bottom');
    expect(result.resolutions[0].nativeSettings.sticky_offset).toBe(20);
  });

  it('reports an unparseable offset instead of writing a guess', () => {
    const result = mapSticky(
      [{ targetSourceId: 'sticky-1', top: 'auto' }],
      ctxFor({ 'sticky-1': target(CONTAINER_SCHEMA_KEY) }),
    );
    expect(result.resolutions[0].nativeSettings.sticky_offset).toBeUndefined();
    expect(result.resolutions[0].precisionLoss.join(' ')).toContain('not a px value');
  });

  it('falls back to CSS on a Core-only site', () => {
    const result = mapSticky(
      [{ targetSourceId: 'sticky-1', top: '50px' }],
      ctxFor({ 'sticky-1': target(CONTAINER_SCHEMA_KEY) }, coreOnlySchema),
    );
    expect(result.resolutions[0].decision).toBe('css-fallback');
    expect(result.resolutions[0].reason).toContain('pro-elements');
  });

  it('reports a sticky target that is not in the tree', () => {
    const result = mapSticky([{ targetSourceId: 'ghost', top: '0px' }], ctxFor({}));
    expect(result.resolutions[0].decision).toBe('unsupported');
    expect(result.warnings.join(' ')).toContain('ghost');
  });
});

// ============================================================================
// The acceptance criterion: every emitted setting passes the schema gate
// ============================================================================

describe('animation/animation-mapper — schema gate acceptance', () => {
  /** Wrap mapped settings in a minimal tree the gate can validate. */
  function gateFor(schemaKey: string, settings: Record<string, unknown>): SchemaGateElement[] {
    const isContainer = schemaKey === CONTAINER_SCHEMA_KEY;
    return [{
      id: 'e1',
      elType: isContainer ? 'container' : 'widget',
      ...(isContainer ? {} : { widgetType: schemaKey }),
      settings,
    }];
  }

  it('emits zero missing-companion violations for an entrance on a widget', () => {
    const result = mapAnimations(
      [animation({ durationMs: 800 })],
      ctxFor({ 'node-1': target('heading', { parentSourceId: 'row', indexInParent: 1 }) }),
    );
    const report = validateSettingsAgainstSchema(
      gateFor('heading', result.settingsByTarget['node-1']),
      snapshot.widgets,
    );
    expect(report.violations.filter((v) => v.kind === 'missing-companion')).toEqual([]);
    expect(report.violations.filter((v) => v.kind === 'unsatisfied-condition')).toEqual([]);
    expect(report.violations.filter((v) => v.kind === 'unknown-key')).toEqual([]);
    expect(report.violations.filter((v) => v.kind === 'invalid-enum')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('emits zero violations for a container entrance, which uses the other names', () => {
    const result = mapAnimations(
      [animation({ durationMs: 2500 })],
      ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }),
    );
    const report = validateSettingsAgainstSchema(
      gateFor(CONTAINER_SCHEMA_KEY, result.settingsByTarget['node-1']),
      snapshot.widgets,
    );
    expect(report.violations).toEqual([]);
  });

  it('emits zero violations for a full motion-fx effect set', () => {
    const result = mapAnimations(
      [animation({
        motionClass: 'scroll-linked',
        effects: [
          { kind: 'scale', from: 1, to: 1.1, range: 0.1, monotonic: false },
          { kind: 'translateY', from: 365, to: 0, range: 365, monotonic: true },
          { kind: 'rotate', from: -8, to: 0, range: 8, monotonic: true },
        ],
      })],
      ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }),
    );
    const settings = result.settingsByTarget['node-1'];
    // Sanity: the master switch and every per-effect toggle are present, which
    // is precisely what Elementor silently requires.
    expect(settings.motion_fx_motion_fx_scrolling).toBe('yes');
    const report = validateSettingsAgainstSchema(
      gateFor(CONTAINER_SCHEMA_KEY, settings),
      snapshot.widgets,
    );
    expect(report.violations).toEqual([]);
  });

  it('emits zero violations for sticky', () => {
    const result = mapSticky(
      [{ targetSourceId: 'sticky-1', top: '50px' }],
      ctxFor({ 'sticky-1': target(CONTAINER_SCHEMA_KEY) }),
    );
    const report = validateSettingsAgainstSchema(
      gateFor(CONTAINER_SCHEMA_KEY, result.settingsByTarget['sticky-1']),
      snapshot.widgets,
    );
    expect(report.violations).toEqual([]);
  });

  it('only ever picks entrance keys from Elementor own catalogue', () => {
    const travels = [
      { from: 50, to: 0, range: 50 },
      { from: -50, to: 0, range: 50 },
      { from: 0, to: 0, range: 0 },
    ];
    const directions: AnimationIR[] = travels.map((travel, index) =>
      animation({
        id: `d${index}`,
        targetSourceId: `node-${index}`,
        effects: [
          { kind: 'opacity', from: 0, to: 1, range: 1 },
          { kind: 'translateY', ...travel },
        ],
      }),
    );
    const targets = Object.fromEntries(directions.map((_, i) => [`node-${i}`, target('heading')]));
    const result = mapAnimations(directions, ctxFor(targets));
    const keys = result.resolutions.map((r) => r.nativeSettings._animation as string);
    for (const key of keys) {
      expect(ENTRANCE_ANIMATION_KEYS.has(key), key).toBe(true);
    }
    // Up, down and the undirected fade — three distinct catalogue keys, so the
    // assertion above is not passing on one repeated value.
    expect(keys).toEqual(['fadeInUp', 'fadeInDown', 'fadeIn']);
  });
});

// ============================================================================
// Honesty of the result surface
// ============================================================================

describe('animation/animation-mapper — reporting', () => {
  it('reports an animation whose target is not in the tree', () => {
    const result = mapAnimations([animation({ targetSourceId: 'ghost' })], ctxFor({}));
    expect(result.resolutions[0].decision).toBe('unsupported');
    expect(result.nativeCount).toBe(0);
    expect(result.fallbackCount).toBe(1);
    expect(result.warnings.join(' ')).toContain('ghost');
    expect(result.settingsByTarget).toEqual({});
  });

  it('says so when it ran against a degraded schema', () => {
    const result = mapAnimations([animation()], ctxFor({ 'node-1': target('heading') }, {
      ...liveSchema,
      degraded: true,
      degradedReasons: ['snapshot is 3 months old'],
    }));
    expect(result.warnings.join(' ')).toContain('degraded');
    expect(result.warnings.join(' ')).toContain('may exist live');
  });

  it('merges settings per target when one element carries several animations', () => {
    const result = mapAnimations(
      [
        animation({ id: 'a', targetSourceId: 'node-1' }),
        animation({
          id: 'b',
          targetSourceId: 'node-1',
          motionClass: 'scroll-linked',
          effects: [{ kind: 'scale', from: 1, to: 1.1, range: 0.1 }],
        }),
      ],
      ctxFor({ 'node-1': target(CONTAINER_SCHEMA_KEY) }),
    );
    const settings = result.settingsByTarget['node-1'];
    expect(settings.animation).toBe('fadeInUp');
    expect(settings.motion_fx_scale_effect).toBe('yes');
  });

  it('groups residual work by the fallback it needs', () => {
    const result = mapAnimations(
      [
        animation({ id: 'native', targetSourceId: 'node-1' }),
        animation({
          id: 'js',
          targetSourceId: 'node-2',
          motionClass: 'scroll-linked',
          effects: [{ kind: 'translateX', from: 1900, to: -1050, range: 2950 }],
        }),
        animation({ id: 'ghost', targetSourceId: 'nowhere' }),
      ],
      ctxFor({
        'node-1': target('heading'),
        'node-2': target(CONTAINER_SCHEMA_KEY),
      }),
    );
    const residual = residualTargets(result);
    expect(residual.jsFallback.map((r) => r.animationId)).toEqual(['js']);
    expect(residual.unsupported.map((r) => r.animationId)).toEqual(['ghost']);
    expect(residual.cssFallback).toEqual([]);
  });

  it('formats a report that names every decision and its precision loss', () => {
    const result = mapAnimations([animation()], ctxFor({ 'node-1': target('heading') }));
    const text = formatAnimationMappingReport(result);
    expect(text).toContain('static-approximation');
    expect(text).toContain('node-1');
    expect(text).toContain('~');
  });

  it('marks which non-native classes the mapper can actually detect', () => {
    const detectable = NON_NATIVE_MOTION.filter((row) => row.detectedAutomatically).map((r) => r.id);
    // The two amplitude-visible cases are detectable from one element's data;
    // the coupled card stack and the text odometer are not, and the table says so
    // rather than implying full coverage.
    expect(detectable).toEqual(['horizontal-run', 'scale-from-zero']);
  });

  it('returns an empty result for an empty animation list', () => {
    const result = mapAnimations([], ctxFor({}));
    expect(result).toEqual({
      resolutions: [],
      nativeCount: 0,
      fallbackCount: 0,
      settingsByTarget: {},
      warnings: [],
    });
  });
});
