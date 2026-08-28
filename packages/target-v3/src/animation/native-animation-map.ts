/**
 * Which measured motion maps onto which native Elementor capability —
 * Arbeitspaket B4 (BAUPLAN v7.0 §4.1/§4.4).
 *
 * Data only, no logic. Every row is a measured signature from the real Humeen
 * page (`tests/unit/extractors/fixtures/framer/motion-sweep-humeen.json`, 31
 * moving elements over a 7-stop scroll sweep) paired with the Elementor control
 * that reproduces it.
 *
 * ## The entrance catalogue is not invented
 *
 * `ENTRANCE_ANIMATIONS` is the exact key set of
 * `Elementor\Control_Animation::get_default_animations()`, read live from the
 * target (Elementor 4.2.1). The keys are what go into the setting; the group
 * labels are Elementor's own. A key outside this list fails the schema gate as
 * `invalid-enum`, so the list is a hard boundary, not a suggestion.
 *
 * Note `get_animations()` runs through the
 * `elementor/controls/animations/additional_animations` filter, so a site MAY
 * offer more. This module never rejects an unknown key on that basis — it only
 * guarantees that what it PICKS is always in the core set.
 *
 * ## Why fade-up maps to `fadeInUp` and not to a motion effect
 *
 * The measured signature is `opacity 0→1` together with
 * `matrix(1,0,0,1,0,50) → none`, i.e. a 50px upward travel that ends at
 * identity and stays there. That is a one-shot reveal, and Elementor's
 * `fadeInUp` keyframe is exactly that:
 *
 * ```css
 * @keyframes fadeInUp {
 *   from { opacity: 0; transform: translate3d(0, 100%, 0) }
 *   to   { opacity: 1; transform: none }
 * }
 * ```
 *
 * The travel distance differs — Framer moves a fixed 50px, Elementor moves 100%
 * of the element's own height — and that difference is recorded as a known
 * approximation rather than papered over.
 *
 * @module target-v3/animation/native-animation-map
 */

/** Entrance animation keys Elementor Core ships, grouped as Elementor groups them. */
export const ENTRANCE_ANIMATIONS = {
  Fading: ['fadeIn', 'fadeInDown', 'fadeInLeft', 'fadeInRight', 'fadeInUp'],
  Zooming: ['zoomIn', 'zoomInDown', 'zoomInLeft', 'zoomInRight', 'zoomInUp'],
  Bouncing: ['bounceIn', 'bounceInDown', 'bounceInLeft', 'bounceInRight', 'bounceInUp'],
  Sliding: ['slideInDown', 'slideInLeft', 'slideInRight', 'slideInUp'],
  Rotating: [
    'rotateIn',
    'rotateInDownLeft',
    'rotateInDownRight',
    'rotateInUpLeft',
    'rotateInUpRight',
  ],
  'Attention Seekers': [
    'bounce',
    'flash',
    'pulse',
    'rubberBand',
    'shake',
    'headShake',
    'swing',
    'tada',
    'wobble',
    'jello',
  ],
  'Light Speed': ['lightSpeedIn'],
  Specials: ['rollIn'],
} as const;

/** Flat set of every valid entrance key, for validation. */
export const ENTRANCE_ANIMATION_KEYS: ReadonlySet<string> = new Set(
  Object.values(ENTRANCE_ANIMATIONS).flat(),
);

/**
 * True when `value` is an entrance key Elementor Core registers.
 *
 * A `false` result does not prove the key is invalid on a given site (a plugin
 * may add animations through the `additional_animations` filter) — it only means
 * this mapper will not choose it.
 */
export function isKnownEntranceAnimation(value: string): boolean {
  return ENTRANCE_ANIMATION_KEYS.has(value);
}

/**
 * Direction an entrance travels FROM, derived from the measured start offset.
 *
 * Framer's offsets are signed screen deltas: a start transform of
 * `translateY(+50px)` means the element begins 50px BELOW its resting place and
 * rises, which is Elementor's `…Up` family. `translateY(-50px)` begins above and
 * descends → `…Down`. Getting this backwards produces an animation that moves in
 * the wrong direction while still passing every schema check, so the sign
 * convention is stated here once and tested.
 */
export type EntranceDirection = 'up' | 'down' | 'left' | 'right' | 'none';

/** The fade / zoom / slide key for one direction. */
export interface EntranceFamilyKeys {
  fade: string;
  zoom: string;
  slide?: string;
}

/**
 * Entrance keys per direction.
 *
 * `slideIn*` has no undirected member — Elementor registers only
 * `slideInDown/Left/Right/Up` — hence the optional field rather than a fake
 * `slideIn`.
 */
export const ENTRANCE_BY_DIRECTION: Record<EntranceDirection, EntranceFamilyKeys> = {
  up: { fade: 'fadeInUp', zoom: 'zoomInUp', slide: 'slideInUp' },
  down: { fade: 'fadeInDown', zoom: 'zoomInDown', slide: 'slideInDown' },
  left: { fade: 'fadeInLeft', zoom: 'zoomInLeft', slide: 'slideInLeft' },
  right: { fade: 'fadeInRight', zoom: 'zoomInRight', slide: 'slideInRight' },
  none: { fade: 'fadeIn', zoom: 'zoomIn' },
};

/**
 * How far Elementor's directed entrance keyframes actually travel.
 *
 * Read from `assets/lib/animations/animations.min.css` on the live target:
 * `fadeInUp` starts at `translate3d(0, 100%, 0)`. The unit is a PERCENTAGE OF
 * THE ELEMENT'S OWN SIZE, not pixels. A source that moves a fixed 50px
 * therefore cannot be reproduced exactly, and the mapper reports the mismatch
 * instead of implying a pixel-accurate match.
 */
export const ENTRANCE_TRAVEL_IS_RELATIVE = true;

/**
 * Pro motion-fx speed semantics, read from the Pro frontend handler.
 *
 * ```js
 * getElementStep(passedPercents, options) {
 *   return -(passedPercents - 50) * options.speed;   // px, translate/rotate
 * }
 * scale(actionData, passedPercents) {
 *   // 1 + speed * movePoint / 1000
 * }
 * ```
 *
 * For a translate the element therefore travels `±50 * speed` px around its
 * resting position across the effect's affected range, i.e. a TOTAL span of
 * `100 * speed` px. Inverting that is what lets a measured pixel amplitude
 * choose a speed instead of a default:
 *
 *     speed = observedRangePx / 100
 *
 * For scale, `movePoint` runs 0..100, so the maximum multiplier delta is
 * `speed * 100 / 1000 = speed / 10`:
 *
 *     speed = observedScaleDelta * 10
 *
 * For rotateZ the same translate formula applies with `deg` as the unit:
 *
 *     speed = observedDegRange / 100
 */
export const MOTION_FX_TRANSLATE_PX_PER_SPEED = 100;
export const MOTION_FX_ROTATE_DEG_PER_SPEED = 100;
export const MOTION_FX_SCALE_DELTA_PER_SPEED = 0.1;

/**
 * Slider bounds the schema declares for each speed control.
 *
 * `motion_fx_*_speed` is a slider whose `px` range Pro sets to `max: 10` with
 * `step: 0.1` (`min: -10` for scale). A value outside the range is not rejected
 * by the schema gate — sliders carry no `opts` — but the effect saturates, so a
 * required speed above the maximum means the effect is NOT natively reachable.
 */
export const MOTION_FX_SPEED_MAX = 10;

/**
 * Smallest speed the control can represent, i.e. its slider step.
 *
 * This is a real resolution floor and it bites on measured data: the four ±8°
 * card rotations need `8 / 100 = 0.08`, below the step. The nearest
 * representable value is `0.1`, which renders 10° instead of 8°. The mapper
 * snaps to the grid and records the resulting amplitude delta rather than
 * writing a value the UI cannot hold.
 */
export const MOTION_FX_SPEED_STEP = 0.1;


/** Schema defaults, so the mapper can avoid writing a value that changes nothing. */
export const MOTION_FX_DEFAULT_SPEED = {
  translateX: 4,
  translateY: 4,
  rotateZ: 1,
  scale: 4,
  opacity: 10,
  blur: 7,
} as const;

/**
 * Effects whose amplitude control is `level` rather than `speed`.
 *
 * `opacity` and `blur` declare `level` (1..10 / 1..15); the transform effects
 * declare `speed`. Writing `speed` on an opacity effect is an unknown key.
 */
export const MOTION_FX_LEVEL_EFFECTS: ReadonlySet<string> = new Set(['opacity', 'blur']);

/**
 * Effects whose viewport window control is `range`, not `affectedRange`.
 *
 * Measured from the schema: `translateX/translateY/rotateZ` use
 * `affectedRange` (default 0..100%), while `scale/opacity/blur` use `range`
 * (default 20..80%). The two are not interchangeable.
 */
export const MOTION_FX_RANGE_NAMED_EFFECTS: ReadonlySet<string> = new Set([
  'scale',
  'opacity',
  'blur',
]);

/**
 * `direction` option sets, which differ per effect family and are easy to swap.
 *
 * The transform effects take `'' | 'negative'` (a binary flip); the
 * level-based effects take a four-way `out-in | in-out | in-out-in |
 * out-in-out`. Sending `'negative'` to a scale effect is an `invalid-enum`.
 */
export const MOTION_FX_FLIP_DIRECTIONS = ['', 'negative'] as const;
export const MOTION_FX_PHASE_DIRECTIONS = ['out-in', 'in-out', 'in-out-in', 'out-in-out'] as const;

/**
 * The four classes of measured motion that Elementor cannot reproduce natively.
 *
 * Kept as data so the residual generator and the report share one definition of
 * "not native", and so a future Elementor feature removes a row here rather than
 * requiring a rewrite. Counts are from the real page.
 *
 * `detectedAutomatically` is the honest part: the mapper only recognises rows
 * whose obstacle is visible in a single element's own amplitude. A row marked
 * `false` needs a human or a future coupling analysis — the mapper will map its
 * halves individually and the lockstep relationship is silently not preserved.
 */
export const NON_NATIVE_MOTION: ReadonlyArray<{
  id: string;
  measuredCount: number;
  signature: string;
  why: string;
  detectedAutomatically: boolean;
}> = [
  {
    id: 'horizontal-run',
    measuredCount: 1,
    signature: 'translateX 1900px → -1050px over one section',
    why:
      'a 2950px span needs speed 29.5, far past the slider max of 10, and the ' +
      'travel is pinned to a section rather than to the viewport',
    // The amplitude alone exceeds MOTION_FX_SPEED_MAX, so the mapper sees it.
    detectedAutomatically: true,
  },
  {
    id: 'card-stack',
    measuredCount: 2,
    signature: 'translateY 365px → 0 on a Content-box, paired with -365px on its sibling',
    why: 'two elements move in opposite directions in lockstep; motion-fx has no coupling',
    // Each half maps on its own; nothing in a single element's data reveals the
    // pairing, so the mapper cannot detect this and does not claim to.
    detectedAutomatically: false,
  },
  {
    id: 'odometer',
    measuredCount: 1,
    signature: 'numeric text counting up, driven by a Framer code component',
    why: 'text content changes over time; no Elementor control animates text content',
    // Nothing moves, so the scroll sweep never reports it as motion at all.
    detectedAutomatically: false,
  },
  {
    id: 'scale-from-zero',
    measuredCount: 1,
    signature: 'matrix(0,0,0,0,0,0) → none with opacity 0 → 1',
    why:
      'a zero-scale start is not reachable: zoomIn begins at scale 0.3 and ' +
      'motion-fx scale is a multiplier around 1',
    // Mapped as a zoomIn entrance with the 0 → 0.3 gap reported as precision loss.
    detectedAutomatically: true,
  },
];
