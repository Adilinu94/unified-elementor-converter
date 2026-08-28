/**
 * Resolve Elementor's animation / motion / sticky control ids FROM THE SCHEMA —
 * Arbeitspaket B4 (BAUPLAN v7.0 §4.4).
 *
 * ## Why this module exists instead of a constant table
 *
 * Elementor splits the entrance-animation control name by element class, and the
 * split is not guessable. Verified twice — once against the committed schema
 * snapshot (`schemas/elementor-v3-controls.snapshot.json`, Elementor 4.2.1 +
 * Pro 4.1.0, `missing: []`) and once by reading the plugin source live on
 * testseite.nick-webdesign.de:
 *
 * | element                        | entrance control | delay control       |
 * |--------------------------------|------------------|---------------------|
 * | `__container__` (and section)  | `animation`      | `animation_delay`   |
 * | every widget                   | `_animation`     | `_animation_delay`  |
 *
 * `includes/elements/container.php` registers `animation` + `animation_delay`;
 * `includes/widgets/common-base.php` registers `_animation` + `_animation_delay`.
 * `animation_duration` is spelled WITHOUT the underscore on both — the container
 * conditions it on `animation!`, the widget on `_animation!`. Getting either
 * wrong is silent: an unknown key makes `elementor-set-content` reject the whole
 * write, and a right key with an unsatisfied companion is dropped by the
 * renderer without a message.
 *
 * Elementor's own frontend handler confirms the pair is read as an either/or:
 *
 * ```js
 * getAnimation() {
 *   return this.getCurrentDeviceSetting('animation')
 *       || this.getCurrentDeviceSetting('_animation');
 * }
 * ```
 *
 * So every id here is looked up in the passed schema and reported as
 * unsupported when absent, rather than hardcoded. A future Elementor rename
 * then surfaces as a named gap in the report instead of a rejected deploy.
 *
 * @module target-v3/animation/control-names
 */

import {
  CONTAINER_SCHEMA_KEY,
  type WidgetControlMap,
  type WidgetSchemaEntry,
} from '@elconv/core';

/** Which naming family an element belongs to. */
export type AnimationControlFamily = 'container' | 'widget';

/**
 * The control ids one element actually offers.
 *
 * Every field is `undefined` when the schema does not declare it. A mapper must
 * treat `undefined` as "this target cannot do it" — never substitute a guess.
 */
export interface AnimationControlIds {
  family: AnimationControlFamily;
  /** Entrance animation, e.g. `animation` or `_animation`. */
  entrance?: string;
  /** Entrance delay in ms. */
  entranceDelay?: string;
  /**
   * Entrance duration. An ENUM of `['slow','','fast']`, never a millisecond
   * value — see `durationEnumFor`.
   */
  entranceDuration?: string;
  /** Per-breakpoint entrance variants Elementor registers as own controls. */
  entranceTablet?: string;
  entranceMobile?: string;
  /** Pro sticky controls. Absent without Elementor Pro. */
  sticky?: string;
  stickyOffset?: string;
  /** Pro motion-fx master switch (`motion_fx_motion_fx_scrolling`). */
  motionFxScrolling?: string;
  /** CSS classes control — `css_classes` on a container, `_css_classes` on a widget. */
  cssClasses?: string;
}

/**
 * One Pro motion-fx effect's controls, as the schema declares them.
 *
 * Names follow Pro's `prepare_effects()` generator:
 * `motion_fx_<effect>_effect` plus one control per declared field. Which fields
 * exist differs per effect, and the difference is measured, not assumed:
 * `translateY` has `direction/speed/affectedRange`, `scale` has
 * `direction/speed/range`, `opacity` has `direction/level/range`.
 */
export interface MotionFxEffectIds {
  effect: string;
  direction?: string;
  speed?: string;
  level?: string;
  /** `motion_fx_<effect>_affectedRange` — translate and rotate use this name. */
  affectedRange?: string;
  /** `motion_fx_<effect>_range` — scale, opacity and blur use this name. */
  range?: string;
}

/** Pro scroll effects this mapper can address. */
export type MotionFxEffectName = 'translateX' | 'translateY' | 'rotateZ' | 'scale' | 'opacity' | 'blur';

/**
 * True when the schema key addresses the container/section naming family.
 *
 * Only `__container__` resolves a schema; `section` and `column` are reported as
 * `missing` by `elementor-get-schema` (live-verified). They nonetheless use the
 * container family — `includes/elements/section.php` and `column.php` both
 * register plain `animation` + `animation_delay` + `animation_duration`, and
 * neither declares `_animation` (verified 2026-08-28 by grepping the installed
 * plugin) — so a caller validating a legacy section tree gets the right names
 * even though no schema backs them.
 */
export function isContainerFamily(schemaKey: string): boolean {
  return schemaKey === CONTAINER_SCHEMA_KEY || schemaKey === 'section' || schemaKey === 'column';
}

/**
 * Element types Pro's sticky module does NOT register `sticky` on.
 *
 * Measured from `pro-elements/modules/sticky/module.php`, which hooks exactly
 * three element types:
 *
 * ```
 * elementor/element/section/section_effects/after_section_start
 * elementor/element/container/section_effects/after_section_start
 * elementor/element/common/section_effects/after_section_start
 * ```
 *
 * `column` is absent — while motion-fx hooks all four. So a column can carry
 * scroll effects but not sticky, and since no schema is exposed for `column`
 * at all, nothing else would catch a `sticky` written onto one.
 */
export const STICKY_UNSUPPORTED_EL_TYPES: ReadonlySet<string> = new Set(['column']);

/**
 * The entrance-animation control id for a schema key, by naming family.
 *
 * Deliberately does NOT consult the schema: it answers "what would this element
 * class call it", which is what a diagnostic needs when no schema is loaded.
 * Use `resolveAnimationControlIds` when a value is about to be written.
 */
export function entranceControlId(schemaKey: string): 'animation' | '_animation' {
  return isContainerFamily(schemaKey) ? 'animation' : '_animation';
}

/**
 * Resolve every animation-related control id a single element offers.
 *
 * `entry` is the widget's schema entry. When it is `undefined` the family is
 * still derived from the key, but every id stays `undefined` — an unverified
 * name must not be written.
 */
export function resolveAnimationControlIds(
  schemaKey: string,
  entry: WidgetSchemaEntry | undefined,
): AnimationControlIds {
  const family: AnimationControlFamily = isContainerFamily(schemaKey) ? 'container' : 'widget';
  const controls = entry?.controls;
  if (!controls) {
    // `section` and `column` have NO schema entry by design — `elementor-get-schema`
    // reports them in `missing`. Treating that as "no entrance control" is wrong
    // and was measurably costly: on a real page every one of 31 measured effects
    // targeted a section, so all 31 resolved to `css-fallback` and the native
    // share was 0% instead of the ≥80% the Definition of Done asks for.
    //
    // The three core entrance controls ARE registered on both, verified in
    // `includes/elements/section.php` and `column.php` (see the module docstring).
    // So they are returned from that verification, while every PRO control stays
    // `undefined`: Pro's presence cannot be confirmed without a schema, and
    // writing `sticky` or `motion_fx_*` onto a site without Pro is an unknown key
    // that makes the server reject the entire write.
    if (schemaKey === 'section' || schemaKey === 'column') {
      return {
        family,
        entrance: 'animation',
        entranceDelay: 'animation_delay',
        entranceDuration: 'animation_duration',
      };
    }
    return { family };
  }

  const prefix = family === 'container' ? '' : '_';
  const has = (id: string): string | undefined => (id in controls ? id : undefined);

  return {
    family,
    entrance: has(`${prefix}animation`),
    entranceDelay: has(`${prefix}animation_delay`),
    // Verified: NOT prefixed on either family.
    entranceDuration: has('animation_duration'),
    entranceTablet: has(`${prefix}animation_tablet`),
    entranceMobile: has(`${prefix}animation_mobile`),
    sticky: has('sticky'),
    stickyOffset: has('sticky_offset'),
    motionFxScrolling: has('motion_fx_motion_fx_scrolling'),
    cssClasses: has(`${prefix}css_classes`),
  };
}

/**
 * Resolve one Pro motion-fx effect's controls.
 *
 * Returns `null` when the effect toggle itself is absent, which is the honest
 * answer for a site without Elementor Pro: the whole `motion_fx_*` family is
 * registered by `elementor-pro/modules/motion-fx`, so on Core-only the mapper
 * must fall back instead of writing keys the server rejects.
 */
export function resolveMotionFxIds(
  effect: MotionFxEffectName,
  controls: WidgetControlMap | undefined,
): MotionFxEffectIds | null {
  if (!controls) return null;
  const toggle = `motion_fx_${effect}_effect`;
  if (!(toggle in controls)) return null;

  const pick = (suffix: string): string | undefined => {
    const id = `motion_fx_${effect}_${suffix}`;
    return id in controls ? id : undefined;
  };
  return {
    effect: toggle,
    direction: pick('direction'),
    speed: pick('speed'),
    level: pick('level'),
    affectedRange: pick('affectedRange'),
    range: pick('range'),
  };
}

/** The three values `animation_duration` accepts, in schema order. */
export const DURATION_ENUM = ['slow', '', 'fast'] as const;

export type DurationEnumValue = (typeof DURATION_ENUM)[number];

/**
 * Map a source duration in ms onto Elementor's three-value duration enum.
 *
 * This is a real precision loss and the boundaries are derived from what the
 * enum actually renders, not from taste. `assets/css/frontend.css` on the live
 * target:
 *
 * ```css
 * .animated             { animation-duration: 1.25s }
 * .animated.animated-slow { animation-duration: 2s }
 * .animated.animated-fast { animation-duration: 0.75s }
 * ```
 *
 * So the three reachable durations are 750 / 1250 / 2000 ms and the honest
 * mapping is nearest-neighbour between them: the midpoint of 750 and 1250 is
 * 1000 ms, of 1250 and 2000 is 1625 ms. A source asking for 500 ms gets `fast`
 * and a caller who needs the exact value must go through custom CSS — which is
 * why the mapper records the delta rather than hiding it.
 */
export function durationEnumFor(durationMs: number): DurationEnumValue {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '';
  if (durationMs < 1000) return 'fast';
  if (durationMs < 1625) return '';
  return 'slow';
}

/** The millisecond duration a given enum value actually renders as. */
export function durationMsForEnum(value: DurationEnumValue): number {
  if (value === 'fast') return 750;
  if (value === 'slow') return 2000;
  return 1250;
}
