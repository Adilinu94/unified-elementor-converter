/**
 * `AnimationIR` → native Elementor settings, or an honest fallback verdict —
 * Arbeitspaket B4 (BAUPLAN v7.0 §4.4).
 *
 * Before this module no emitter in the repo ever wrote an animation setting: a
 * grep for `_animation`, `animation_delay`, `motion_fx_` and `sticky` across all
 * packages found only `hover_animation: 'grow'` in `patterns/glass-header.ts`
 * and a Pro `animated-headline` duration in the widget mapper. Every measured
 * effect went to a WPCode snippet — or nowhere.
 *
 * ## Two hard rules, both from verified behaviour
 *
 * 1. **Never emit a setting without its companion.** Every `motion_fx_*` control
 *    is conditioned on `motion_fx_motion_fx_scrolling: 'yes'`, every sub-field
 *    additionally on its own `_effect: 'yes'`, `sticky_offset` on `sticky!`, and
 *    `animation_delay`/`animation_duration` on the entrance control being set.
 *    Elementor drops a conditioned control silently when its condition fails, so
 *    the tree would look correct and render nothing. The companions are read
 *    from the schema through `control-names.ts`, never hardcoded.
 *
 * 2. **Never guess an entrance.** `element-base.php` adds
 *    `class="elementor-invisible"` to any element carrying an entrance
 *    animation, and `frontend.css` defines `.elementor-invisible { visibility:
 *    hidden }`. The class is only removed by the JS handler once the element
 *    scrolls into view. So a WRONG entrance does not merely animate oddly — it
 *    can leave content permanently invisible. An animation whose `motionClass`
 *    is absent or `indeterminate` therefore never becomes an entrance.
 *
 * ## What native buys over a snippet
 *
 * `frontend.css` ships
 * `@media (prefers-reduced-motion: reduce) { .animated { animation: none !important } }`,
 * so a native entrance honours the user's accessibility preference with no work
 * from us. A hand-written snippet has to reimplement that, and the existing
 * `wpcode.ts` scroll snippet does not.
 *
 * ## Deviation from the plan's signature
 *
 * §4.4 sketched `mapAnimations(animations, { schema, elType, widgetType })` —
 * one element type for the whole list. That cannot work: animations in one IR
 * target different elements, and the entrance control name depends on each
 * target's family (`animation` on a container, `_animation` on a widget). The
 * context therefore carries a per-target resolver instead of one element type.
 *
 * ## What "Pro is available" actually means
 *
 * Every `motion_fx_*` and `sticky` control comes from a Pro module, but NOT
 * necessarily from the `elementor-pro` plugin. The live target runs PRO Elements
 * (`pro-elements`) with `elementor-pro` installed-but-inactive, and it defines
 * `ELEMENTOR_PRO_VERSION`, registers the `ElementorPro\*` classes and loads
 * `motion-fx` + `sticky` — its `modules/motion-fx/controls-group.php` is
 * byte-identical to Elementor Pro's. This module therefore never asks which
 * plugin is installed; it asks the SCHEMA whether the control exists. That is
 * the only question whose answer decides whether a write succeeds.
 *
 * @module target-v3/animation/animation-mapper
 */

import type {
  AnimationEffectIR,
  AnimationIR,
  ResolvedWidgetSchema,
} from '@elconv/core';
import { ELEMENTOR_PRO_PROVIDERS } from '@elconv/core';
import {
  durationEnumFor,
  durationMsForEnum,
  resolveAnimationControlIds,
  resolveMotionFxIds,
  STICKY_UNSUPPORTED_EL_TYPES,
  type AnimationControlIds,
  type MotionFxEffectName,
} from './control-names.js';
import {
  ENTRANCE_BY_DIRECTION,
  isKnownEntranceAnimation,
  MOTION_FX_LEVEL_EFFECTS,
  MOTION_FX_SPEED_MAX,
  MOTION_FX_SPEED_STEP,
  type EntranceDirection,
} from './native-animation-map.js';

/** How a single animation was resolved against the target's capabilities. */
export type AnimationDecision =
  | 'native'
  | 'css-fallback'
  | 'js-fallback'
  | 'static-approximation'
  | 'unsupported';

export interface AnimationResolution {
  /** The IR node this resolution applies to. */
  targetSourceId: string;
  /** The animation that produced it, for traceability back into the IR. */
  animationId: string;
  decision: AnimationDecision;
  /** Settings to merge into the element. Empty for every non-native decision. */
  nativeSettings: Record<string, unknown>;
  /** Why this decision — goes into the report verbatim. */
  reason: string;
  /** Companion controls this resolution had to set. Audit trail. */
  companionsApplied: string[];
  /**
   * Fidelity the native mapping cannot deliver, in plain words.
   *
   * Present on `native` too: a native mapping is frequently an approximation
   * (Elementor's entrance travel is a percentage of the element's own size, its
   * duration is a three-value enum) and hiding that would make the report claim
   * an exactness that was never measured.
   */
  precisionLoss: string[];
}

export interface MapAnimationsResult {
  resolutions: AnimationResolution[];
  nativeCount: number;
  fallbackCount: number;
  /** `targetSourceId` → settings to merge, for the emitter. */
  settingsByTarget: Record<string, Record<string, unknown>>;
  /** Everything a reader must see before trusting the output. */
  warnings: string[];
}

/** What the emitter must tell the mapper about one animation target. */
export interface AnimationTargetInfo {
  /** Schema key: `__container__` for containers/sections, else the widget type. */
  schemaKey: string;
  /**
   * Parent element id, used only to group siblings for stagger.
   * Omitting it disables stagger for that node rather than inventing an order.
   */
  parentSourceId?: string;
  /** Position among its siblings, for a deterministic stagger order. */
  indexInParent?: number;
}

export interface MapAnimationsContext {
  schema: ResolvedWidgetSchema;
  /**
   * Resolve an `AnimationIR.targetSourceId` onto the element it addresses.
   * Returning `undefined` means the target is not in the tree — reported as
   * `unsupported`, never silently dropped.
   */
  resolveTarget: (targetSourceId: string) => AnimationTargetInfo | undefined;
  /**
   * Delay step in ms between siblings sharing one entrance. Default 100, which
   * is also Elementor's own `_animation_delay` slider step.
   */
  staggerStepMs?: number;
  /** Disable stagger entirely (e.g. when a caller wants literal fidelity). */
  disableStagger?: boolean;
}

/** Elementor's `_animation_delay` step; also the default stagger increment. */
export const DEFAULT_STAGGER_STEP_MS = 100;

/**
 * Amplitude difference above which a native approximation is worth reporting.
 *
 * 1px / 1° / 0.01 scale. Below that the difference is not observable next to the
 * measurement noise the probe already tolerates (`MOTION_EPSILON = 0.005`).
 */
const AMPLITUDE_REPORT_TOLERANCE = 1;
const SCALE_REPORT_TOLERANCE = 0.01;

/**
 * Resolve every animation against the target's real capabilities.
 *
 * Pure. Produces one resolution per animation, in input order, and never throws:
 * an unresolvable target or a missing control is a reported verdict, because a
 * build that stops on the first odd animation is less useful than one that
 * states what it could and could not do.
 */
export function mapAnimations(
  animations: readonly AnimationIR[],
  ctx: MapAnimationsContext,
): MapAnimationsResult {
  const resolutions: AnimationResolution[] = [];
  const warnings: string[] = [];
  const settingsByTarget: Record<string, Record<string, unknown>> = {};

  const staggerStep = ctx.staggerStepMs ?? DEFAULT_STAGGER_STEP_MS;
  const staggerIndex = ctx.disableStagger === true
    ? new Map<string, number>()
    : computeStaggerIndices(animations, ctx);

  for (const animation of animations) {
    const target = ctx.resolveTarget(animation.targetSourceId);
    if (target === undefined) {
      resolutions.push({
        targetSourceId: animation.targetSourceId,
        animationId: animation.id,
        decision: 'unsupported',
        nativeSettings: {},
        reason: `target "${animation.targetSourceId}" is not an element in the emitted tree`,
        companionsApplied: [],
        precisionLoss: ['the entire animation'],
      });
      warnings.push(
        `animation ${animation.id} targets "${animation.targetSourceId}", which the tree does not contain`,
      );
      continue;
    }

    const entry = ctx.schema.schema[target.schemaKey];
    const ids = resolveAnimationControlIds(target.schemaKey, entry);
    const resolution = resolveOne(animation, ids, entry?.controls, {
      staggerMs: (staggerIndex.get(animation.id) ?? 0) * staggerStep,
    });
    resolutions.push(resolution);

    if (Object.keys(resolution.nativeSettings).length > 0) {
      settingsByTarget[animation.targetSourceId] = {
        ...settingsByTarget[animation.targetSourceId],
        ...resolution.nativeSettings,
      };
    }
    if (resolution.decision !== 'native') {
      warnings.push(`animation ${animation.id} (${animation.intent}): ${resolution.reason}`);
    }
  }

  if (ctx.schema.degraded) {
    warnings.push(
      `animation mapping ran against a ${ctx.schema.source} schema flagged degraded: ` +
        ctx.schema.degradedReasons.join('; ') +
        ' — a control reported as unavailable here may exist live',
    );
  }

  const nativeCount = resolutions.filter((r) => r.decision === 'native').length;
  return {
    resolutions,
    nativeCount,
    fallbackCount: resolutions.length - nativeCount,
    settingsByTarget,
    warnings,
  };
}

// ============================================================================
// Per-animation resolution
// ============================================================================

function resolveOne(
  animation: AnimationIR,
  ids: AnimationControlIds,
  controls: Parameters<typeof resolveMotionFxIds>[1],
  options: { staggerMs: number },
): AnimationResolution {
  const base = { targetSourceId: animation.targetSourceId, animationId: animation.id };

  if (animation.motionClass === undefined || animation.motionClass === 'indeterminate') {
    return {
      ...base,
      decision: 'unsupported',
      nativeSettings: {},
      reason:
        animation.motionClass === undefined
          ? 'no motionClass on the animation; an entrance cannot be chosen safely because ' +
            'Elementor hides an entrance element with .elementor-invisible until its handler runs'
          : 'motion was measured but not classified, so no native control can be chosen',
      companionsApplied: [],
      precisionLoss: ['the entire animation'],
    };
  }

  if (animation.motionClass === 'entrance') {
    return resolveEntrance(animation, ids, options.staggerMs, base);
  }
  return resolveScrollLinked(animation, ids, controls, base);
}

// ============================================================================
// Entrance
// ============================================================================

function resolveEntrance(
  animation: AnimationIR,
  ids: AnimationControlIds,
  staggerMs: number,
  base: { targetSourceId: string; animationId: string },
): AnimationResolution {
  if (ids.entrance === undefined) {
    return {
      ...base,
      decision: 'css-fallback',
      nativeSettings: {},
      reason:
        `the schema declares no entrance control for this ${ids.family} ` +
        `(expected "${ids.family === 'container' ? 'animation' : '_animation'}")`,
      companionsApplied: [],
      precisionLoss: ['native entrance animation'],
    };
  }

  const effects = animation.effects ?? [];
  const direction = entranceDirectionFrom(effects);
  const family = ENTRANCE_BY_DIRECTION[direction];
  const startsScaledDown = effects.some(
    (effect) => effect.kind === 'scale' && effect.from < effect.to && effect.from < 0.95,
  );
  const key = startsScaledDown ? family.zoom : family.fade;

  // Guard the value we chose against Elementor's own catalogue. A key outside it
  // fails the schema gate as invalid-enum, and finding that here names the cause.
  if (!isKnownEntranceAnimation(key)) {
    return {
      ...base,
      decision: 'unsupported',
      nativeSettings: {},
      reason: `derived entrance key "${key}" is not in Elementor's animation catalogue`,
      companionsApplied: [],
      precisionLoss: ['native entrance animation'],
    };
  }

  const settings: Record<string, unknown> = { [ids.entrance]: key };
  const companions: string[] = [];
  const precisionLoss: string[] = [];

  const translate = effects.find(
    (effect) => effect.kind === 'translateX' || effect.kind === 'translateY',
  );
  if (translate !== undefined) {
    // Elementor's directed entrance keyframes start at translate3d(±100%),
    // i.e. one full element size — never a fixed pixel offset. A source that
    // moves 50px cannot be reproduced exactly by any entrance key.
    precisionLoss.push(
      `travel distance: source moved ${Math.round(translate.range)}px, ` +
        `${key} moves 100% of the element's own size`,
    );
  }
  if (startsScaledDown) {
    const scale = effects.find((effect) => effect.kind === 'scale');
    if (scale !== undefined && Math.abs(scale.from - 0.3) > SCALE_REPORT_TOLERANCE) {
      precisionLoss.push(
        `start scale: source began at ${scale.from.toFixed(3)}, ${key} begins at 0.3`,
      );
    }
  }

  if (animation.durationMs !== undefined && ids.entranceDuration !== undefined) {
    const enumValue = durationEnumFor(animation.durationMs);
    settings[ids.entranceDuration] = enumValue;
    companions.push(ids.entranceDuration);
    const rendered = durationMsForEnum(enumValue);
    if (Math.abs(rendered - animation.durationMs) > 1) {
      precisionLoss.push(
        `duration: source ${Math.round(animation.durationMs)}ms → ` +
          `"${enumValue === '' ? 'normal' : enumValue}" renders ${rendered}ms ` +
          '(animation_duration is a three-value enum, not a millisecond field)',
      );
    }
  } else if (animation.durationMs === undefined) {
    // The scroll sweep samples settled end states, so it reports no duration.
    // Writing one would be fabrication; Elementor's own 1.25s default applies.
    precisionLoss.push(
      'duration unknown from the source, so animation_duration was not written ' +
        "(Elementor's default of 1.25s applies)",
    );
  }

  if (staggerMs > 0) {
    if (ids.entranceDelay === undefined) {
      precisionLoss.push(
        `stagger of ${staggerMs}ms was dropped: the schema declares no delay control`,
      );
    } else {
      settings[ids.entranceDelay] = staggerMs;
      companions.push(ids.entranceDelay);
    }
  }

  return {
    ...base,
    decision: precisionLoss.length > 0 ? 'static-approximation' : 'native',
    nativeSettings: settings,
    reason:
      `entrance mapped to ${ids.entrance}: "${key}"` +
      (staggerMs > 0 ? ` with a ${staggerMs}ms stagger delay` : '') +
      (precisionLoss.length > 0 ? ' (approximated, see precisionLoss)' : ''),
    companionsApplied: companions,
    precisionLoss,
  };
}

/**
 * Direction an entrance travels FROM, read off the measured start offset.
 *
 * The sign convention matches Elementor's own keyframes, which is what makes the
 * mapping checkable rather than a coin flip: `fadeInUp` starts at
 * `translate3d(0, +100%, 0)` — below the resting place — and rises. So a source
 * whose `translateY` starts positive is `up`; negative is `down`. `fadeInLeft`
 * starts at `translate3d(-100%, 0, 0)`, so a negative `translateX` start is
 * `left`.
 *
 * When both axes moved, the larger amplitude wins: Elementor has no diagonal
 * entrance, and picking the dominant axis loses less than picking the first one
 * found.
 */
export function entranceDirectionFrom(
  effects: readonly AnimationEffectIR[],
): EntranceDirection {
  // A zero-amplitude translate carries no direction. The probe never emits one
  // (`buildEffect` drops anything below its epsilon), but a hand-built or
  // third-party IR can, and `from > to` on two equal values would silently
  // resolve to `down` — an invented direction from a non-measurement.
  const moved = (effect: AnimationEffectIR | undefined): AnimationEffectIR | undefined =>
    effect !== undefined && effect.range > 0 ? effect : undefined;

  const y = moved(effects.find((effect) => effect.kind === 'translateY'));
  const x = moved(effects.find((effect) => effect.kind === 'translateX'));
  const dominant = pickDominant(y, x);
  if (dominant === undefined) return 'none';
  if (dominant.kind === 'translateY') return dominant.from > dominant.to ? 'up' : 'down';
  return dominant.from < dominant.to ? 'left' : 'right';
}

function pickDominant(
  a: AnimationEffectIR | undefined,
  b: AnimationEffectIR | undefined,
): AnimationEffectIR | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a.range >= b.range ? a : b;
}

// ============================================================================
// Scroll-linked (Pro motion effects)
// ============================================================================

/** Which IR effect kind drives which Pro motion-fx effect. */
const MOTION_FX_FOR_EFFECT: Record<AnimationEffectIR['kind'], MotionFxEffectName | undefined> = {
  translateX: 'translateX',
  translateY: 'translateY',
  rotate: 'rotateZ',
  scale: 'scale',
  opacity: 'opacity',
};

function resolveScrollLinked(
  animation: AnimationIR,
  ids: AnimationControlIds,
  controls: Parameters<typeof resolveMotionFxIds>[1],
  base: { targetSourceId: string; animationId: string },
): AnimationResolution {
  const effects = animation.effects ?? [];
  if (effects.length === 0) {
    return {
      ...base,
      decision: 'unsupported',
      nativeSettings: {},
      reason:
        'scroll-linked motion carries no measured effects, and every motion-fx control ' +
        'is an amplitude — no speed can be derived without one',
      companionsApplied: [],
      precisionLoss: ['the entire animation'],
    };
  }

  if (ids.motionFxScrolling === undefined) {
    return {
      ...base,
      decision: 'js-fallback',
      nativeSettings: {},
      reason:
        'the schema declares no motion_fx_motion_fx_scrolling control; scroll effects come from ' +
        `the Pro motion-fx module (provided by ${ELEMENTOR_PRO_PROVIDERS.join(' or ')}), ` +
        'so this needs a scroll library instead',
      companionsApplied: [],
      precisionLoss: ['native scroll motion effect'],
    };
  }

  const settings: Record<string, unknown> = {};
  const companions: string[] = [ids.motionFxScrolling];
  const precisionLoss: string[] = [];
  const unreachable: string[] = [];
  let mappedAny = false;

  for (const effect of effects) {
    const fxName = MOTION_FX_FOR_EFFECT[effect.kind];
    if (fxName === undefined) {
      unreachable.push(`${effect.kind} has no motion-fx equivalent`);
      continue;
    }
    const fx = resolveMotionFxIds(fxName, controls);
    if (fx === null) {
      unreachable.push(`the schema declares no motion_fx_${fxName}_effect control`);
      continue;
    }
    const amplitude = amplitudeControlFor(fxName, fx);
    if (amplitude === undefined) {
      unreachable.push(`motion_fx_${fxName} declares no amplitude control`);
      continue;
    }

    const required = requiredSpeedFor(fxName, effect);
    if (required === undefined) {
      unreachable.push(`${effect.kind} amplitude ${effect.range} cannot be expressed as a speed`);
      continue;
    }
    if (required > MOTION_FX_SPEED_MAX) {
      unreachable.push(
        `${effect.kind} needs speed ${required.toFixed(2)}, above the control maximum of ` +
          `${MOTION_FX_SPEED_MAX} (measured amplitude ${Math.round(effect.range)})`,
      );
      continue;
    }

    const snapped = snapToStep(required);
    settings[ids.motionFxScrolling] = 'yes';
    settings[fx.effect] = 'yes';
    companions.push(fx.effect);
    settings[amplitude] = { unit: 'px', size: snapped, sizes: [] };
    mappedAny = true;

    const renderedRange = renderedAmplitudeFor(fxName, snapped);
    const tolerance = fxName === 'scale' ? SCALE_REPORT_TOLERANCE : AMPLITUDE_REPORT_TOLERANCE;
    if (Math.abs(renderedRange - effect.range) > tolerance) {
      precisionLoss.push(
        `${effect.kind}: source amplitude ${formatAmplitude(fxName, effect.range)}, ` +
          `speed ${snapped} renders ${formatAmplitude(fxName, renderedRange)} ` +
          `(slider step is ${MOTION_FX_SPEED_STEP})`,
      );
    }

    const direction = directionFor(fxName, effect, fx);
    if (direction !== undefined) {
      settings[direction.control] = direction.value;
      companions.push(direction.control);
    }
  }

  if (!mappedAny) {
    return {
      ...base,
      decision: 'js-fallback',
      nativeSettings: {},
      reason: `no effect could be mapped natively: ${unreachable.join('; ')}`,
      companionsApplied: [],
      precisionLoss: ['native scroll motion effect'],
    };
  }

  for (const note of unreachable) {
    precisionLoss.push(`partially mapped — ${note}`);
  }

  return {
    ...base,
    decision: precisionLoss.length > 0 ? 'static-approximation' : 'native',
    nativeSettings: settings,
    reason:
      `scroll-linked motion mapped to ${countEffects(settings)} motion-fx effect(s)` +
      (unreachable.length > 0 ? `; ${unreachable.length} effect(s) not reachable` : ''),
    companionsApplied: dedupe(companions),
    precisionLoss,
  };
}

/**
 * The control that carries an effect's amplitude.
 *
 * `opacity` and `blur` use `level`, the transform effects use `speed`. The two
 * are separate control ids, so sending `speed` to an opacity effect is an
 * unknown key and would make the server reject the whole write.
 */
function amplitudeControlFor(
  fxName: MotionFxEffectName,
  fx: NonNullable<ReturnType<typeof resolveMotionFxIds>>,
): string | undefined {
  return MOTION_FX_LEVEL_EFFECTS.has(fxName) ? fx.level : fx.speed;
}

/**
 * Invert Pro's own formula to get the speed a measured amplitude needs.
 *
 * Translate and rotate (`getElementStep`): the element travels
 * `-(passedPercents - 50) * speed`, so across a full 0..100 pass the total span
 * is `100 * speed`. Scale: `1 + speed * movePoint / 1000` with `movePoint`
 * 0..100, so the multiplier span is `speed / 10`. Opacity: `level / 10` is the
 * amplitude, so `level = range * 10`.
 */
export function requiredSpeedFor(
  fxName: MotionFxEffectName,
  effect: AnimationEffectIR,
): number | undefined {
  if (!Number.isFinite(effect.range) || effect.range <= 0) return undefined;
  switch (fxName) {
    case 'translateX':
    case 'translateY':
    case 'rotateZ':
      return effect.range / 100;
    case 'scale':
      return effect.range * 10;
    case 'opacity':
    case 'blur':
      return effect.range * 10;
  }
}

/** The amplitude a given speed actually renders, i.e. the inverse of the above. */
export function renderedAmplitudeFor(fxName: MotionFxEffectName, speed: number): number {
  switch (fxName) {
    case 'translateX':
    case 'translateY':
    case 'rotateZ':
      return speed * 100;
    case 'scale':
    case 'opacity':
    case 'blur':
      return speed / 10;
  }
}

function formatAmplitude(fxName: MotionFxEffectName, value: number): string {
  if (fxName === 'rotateZ') return `${value.toFixed(1)}°`;
  if (fxName === 'scale' || fxName === 'opacity' || fxName === 'blur') return value.toFixed(3);
  return `${Math.round(value)}px`;
}

/** Snap to the slider's own step, never below one step. */
export function snapToStep(value: number): number {
  const steps = Math.max(1, Math.round(value / MOTION_FX_SPEED_STEP));
  return Number((steps * MOTION_FX_SPEED_STEP).toFixed(1));
}

/**
 * The `direction` value for one effect, when it differs from the schema default.
 *
 * The transform effects take a binary `'' | 'negative'` flip; `scale`, `opacity`
 * and `blur` take a four-phase `out-in | in-out | …`. Sending a flip value to a
 * phase control is an `invalid-enum`, so the two families are kept apart.
 *
 * Default direction `''` means the element moves from `+50*speed` toward
 * `-50*speed` as the page scrolls down — a decreasing series. A measured series
 * that increases therefore needs `'negative'`.
 */
function directionFor(
  fxName: MotionFxEffectName,
  effect: AnimationEffectIR,
  fx: NonNullable<ReturnType<typeof resolveMotionFxIds>>,
): { control: string; value: string } | undefined {
  if (fx.direction === undefined) return undefined;
  if (MOTION_FX_LEVEL_EFFECTS.has(fxName) || fxName === 'scale') {
    // 'out-in' is the schema default for all three phase-based effects, and it
    // is the rising / scaling-up case. Only the inverse needs writing.
    return effect.from > effect.to ? { control: fx.direction, value: 'in-out' } : undefined;
  }
  return effect.from < effect.to ? { control: fx.direction, value: 'negative' } : undefined;
}

function countEffects(settings: Record<string, unknown>): number {
  return Object.keys(settings).filter((key) => key.endsWith('_effect')).length;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// ============================================================================
// Stagger
// ============================================================================

/**
 * Assign a stagger position to every entrance that shares a parent and a family.
 *
 * This replaces GSAP's `stagger` with `_animation_delay`, and the grouping is
 * deliberately narrow: siblings only, and only entrances whose derived travel
 * direction agrees. A shared delay ramp across unrelated elements would look
 * like a bug rather than a choreography.
 *
 * Elements whose target carries no `parentSourceId` get no stagger — an unknown
 * parent is not a reason to invent an order.
 */
function computeStaggerIndices(
  animations: readonly AnimationIR[],
  ctx: MapAnimationsContext,
): Map<string, number> {
  const groups = new Map<string, Array<{ id: string; order: number }>>();

  animations.forEach((animation, fallbackOrder) => {
    if (animation.motionClass !== 'entrance') return;
    const target = ctx.resolveTarget(animation.targetSourceId);
    if (target?.parentSourceId === undefined) return;
    const direction = entranceDirectionFrom(animation.effects ?? []);
    const key = `${target.parentSourceId}|${direction}`;
    const bucket = groups.get(key) ?? [];
    bucket.push({ id: animation.id, order: target.indexInParent ?? fallbackOrder });
    groups.set(key, bucket);
  });

  const indices = new Map<string, number>();
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    bucket.sort((a, b) => a.order - b.order);
    bucket.forEach((entry, index) => indices.set(entry.id, index));
  }
  return indices;
}

// ============================================================================
// Sticky
// ============================================================================

/**
 * One `position: sticky` element the source used.
 *
 * Declared structurally rather than imported from `@elconv/extractors` — the
 * same reason `animation-injector.ts` keeps a local `AnimationInfo`: target-v3
 * must not depend on the extractor package.
 */
export interface StickyCandidate {
  /** Element id in the emitted tree. */
  targetSourceId: string;
  /** Computed `top` value, e.g. `"50px"` or `"0px"`. */
  top?: string;
  /** Computed `bottom`, when the element sticks to the bottom instead. */
  bottom?: string;
}

/**
 * Map `position: sticky` onto Elementor's native sticky controls.
 *
 * Separate from `mapAnimations` because sticky is not an animation: nothing
 * moves over time, an element simply stops scrolling. It shares this module
 * because it shares the companion discipline — `sticky_offset` is conditioned on
 * `sticky!` and is dropped without it.
 *
 * Measured on the real page: two sticky elements, `top: 50px` and `top: 0px`.
 * A `0px` offset is still written explicitly: the schema default is `0`, so the
 * value is redundant for the renderer but makes the intent visible in the editor.
 */
export function mapSticky(
  candidates: readonly StickyCandidate[],
  ctx: Pick<MapAnimationsContext, 'schema' | 'resolveTarget'>,
): MapAnimationsResult {
  const resolutions: AnimationResolution[] = [];
  const warnings: string[] = [];
  const settingsByTarget: Record<string, Record<string, unknown>> = {};

  for (const candidate of candidates) {
    const base = { targetSourceId: candidate.targetSourceId, animationId: `sticky-${candidate.targetSourceId}` };
    const target = ctx.resolveTarget(candidate.targetSourceId);
    if (target === undefined) {
      resolutions.push({
        ...base,
        decision: 'unsupported',
        nativeSettings: {},
        reason: `sticky target "${candidate.targetSourceId}" is not an element in the emitted tree`,
        companionsApplied: [],
        precisionLoss: ['sticky behaviour'],
      });
      warnings.push(`sticky candidate "${candidate.targetSourceId}" has no element in the tree`);
      continue;
    }

    const entry = ctx.schema.schema[target.schemaKey];
    const ids = resolveAnimationControlIds(target.schemaKey, entry);
    if (STICKY_UNSUPPORTED_EL_TYPES.has(target.schemaKey)) {
      resolutions.push({
        ...base,
        decision: 'css-fallback',
        nativeSettings: {},
        reason:
          `Pro's sticky module does not register the control on elType "${target.schemaKey}" ` +
          '(it hooks section, container and common only), so sticky needs CSS here',
        companionsApplied: [],
        precisionLoss: ['native sticky'],
      });
      warnings.push(
        `sticky on "${candidate.targetSourceId}" targets a ${target.schemaKey}, which Pro does not make sticky`,
      );
      continue;
    }
    if (ids.sticky === undefined) {
      resolutions.push({
        ...base,
        decision: 'css-fallback',
        nativeSettings: {},
        reason:
          'the schema declares no sticky control; sticky comes from the Pro sticky module ' +
          `(provided by ${ELEMENTOR_PRO_PROVIDERS.join(' or ')}), ` +
          'so this needs position: sticky in CSS instead',
        companionsApplied: [],
        precisionLoss: ['native sticky'],
      });
      warnings.push(`sticky on "${candidate.targetSourceId}" is not natively available`);
      continue;
    }

    const edge = candidate.bottom !== undefined && candidate.top === undefined ? 'bottom' : 'top';
    const offset = parsePxOffset(edge === 'top' ? candidate.top : candidate.bottom);
    const settings: Record<string, unknown> = { [ids.sticky]: edge };
    const companions: string[] = [];
    const precisionLoss: string[] = [];

    if (offset === undefined) {
      precisionLoss.push(
        `offset "${(edge === 'top' ? candidate.top : candidate.bottom) ?? '(none)'}" is not a px value; ` +
          "Elementor's sticky_offset default of 0 applies",
      );
    } else if (ids.stickyOffset === undefined) {
      precisionLoss.push(`offset ${offset}px was dropped: the schema declares no sticky_offset control`);
    } else {
      settings[ids.stickyOffset] = offset;
      companions.push(ids.stickyOffset);
    }

    resolutions.push({
      ...base,
      decision: precisionLoss.length > 0 ? 'static-approximation' : 'native',
      nativeSettings: settings,
      reason: `sticky mapped to ${ids.sticky}: "${edge}"${offset !== undefined ? ` with offset ${offset}` : ''}`,
      companionsApplied: companions,
      precisionLoss,
    });
    settingsByTarget[candidate.targetSourceId] = {
      ...settingsByTarget[candidate.targetSourceId],
      ...settings,
    };
  }

  const nativeCount = resolutions.filter((r) => r.decision === 'native').length;
  return {
    resolutions,
    nativeCount,
    fallbackCount: resolutions.length - nativeCount,
    settingsByTarget,
    warnings,
  };
}

/** Parse a computed `top`/`bottom` into a px number. `auto` yields undefined. */
function parsePxOffset(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (match === null) return undefined;
  return Math.round(Number(match[1]));
}

// ============================================================================
// Reporting
// ============================================================================

/** Human-readable mapping report for a run report or CLI output. */
export function formatAnimationMappingReport(result: MapAnimationsResult): string {
  const lines = [
    `Animation mapping: ${result.nativeCount} native, ${result.fallbackCount} needing a fallback ` +
      `(of ${result.resolutions.length})`,
    '',
  ];
  for (const resolution of result.resolutions) {
    lines.push(`  [${resolution.decision}] ${resolution.targetSourceId} — ${resolution.reason}`);
    for (const loss of resolution.precisionLoss) lines.push(`      ~ ${loss}`);
    if (resolution.companionsApplied.length > 0) {
      lines.push(`      + companions: ${resolution.companionsApplied.join(', ')}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push('', `Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) lines.push(`  ! ${warning}`);
  }
  return lines.join('\n');
}

/** Effects that still need a snippet, grouped for the residual generator. */
export function residualTargets(result: MapAnimationsResult): {
  cssFallback: AnimationResolution[];
  jsFallback: AnimationResolution[];
  unsupported: AnimationResolution[];
} {
  return {
    cssFallback: result.resolutions.filter((r) => r.decision === 'css-fallback'),
    jsFallback: result.resolutions.filter((r) => r.decision === 'js-fallback'),
    unsupported: result.resolutions.filter((r) => r.decision === 'unsupported'),
  };
}
