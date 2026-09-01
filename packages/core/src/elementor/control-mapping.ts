/**
 * CSS property → Elementor V3 control resolution, per widget type.
 *
 * ## Why this exists
 *
 * The V3 emitter used to map a CSS property onto ONE control id regardless of
 * which widget it was writing. Measured against the LIVE schema of a real page
 * (rundmund.local, Elementor 4.2.3): **724 `unknown-key` errors**.
 * `elementor-set-content` rejects the WHOLE write on a single unknown key, so
 * that tree could never have deployed — every element would have been lost, not
 * just the offending keys.
 *
 * The offline gate had passed the same tree. Not a snapshot staleness problem:
 * a snapshot-sourced schema is flagged `degraded`, and `degraded` downgrades
 * every `unknown-key` to `unverified-key` (warning) by design, so 724 real
 * errors sat in the warning stream. The lesson is the charter's: a passed
 * offline check is not evidence.
 *
 * ## What the live schema actually says
 *
 * Elementor names the same property differently per element family, and the
 * differences are not cosmetic:
 *
 *   - **Wrapper controls are underscore-prefixed on widgets, bare on the
 *     container.** A widget has `_padding`, `_margin`, `_border_radius`,
 *     `_background_color`; `__container__` has `padding`, `margin`,
 *     `border_radius`, `background_color`. Verified universal: all 13 captured
 *     widget types declare the `_`-prefixed set, none declares the bare one
 *     (except where it means something else — see `border_radius` below).
 *   - **`border_radius` without the underscore exists on some widgets and is a
 *     DIFFERENT control.** On `button`/`icon`/`icon-box` it is a `dimensions`
 *     control styling the widget itself; on `divider` it is a `slider`. Writing
 *     a box shape into the divider's slider is a `wrong-shape` error.
 *   - **Typography exists on 4 of 13 widgets only** — `heading`, `text-editor`,
 *     `button`, `divider`. On `image`, `spacer`, `html`, `icon` and the
 *     container there is no `typography_*` control at all. 75 of the measured
 *     errors were typography keys on spacers.
 *   - **The text colour has four different names**: `title_color` (heading),
 *     `text_color` (text-editor), `button_text_color` (button),
 *     `primary_color` (icon). `image.text_color` also exists but is the
 *     *caption* colour, so mapping a node's `color` onto it would be silently
 *     wrong rather than merely rejected.
 *   - **`min_height` and `text-align`/`align` do not exist on every family.**
 *     The container has no `align`; widgets have no `min_height`.
 *
 * ## Design rule
 *
 * Every verdict is derived from a control schema, never from a hand-written
 * key list. Candidate ids are ordered and resolved against the schema of the
 * widget being written, so a control that does not exist is simply not chosen.
 * Companion requirements (`typography_typography: 'custom'`,
 * `_background_background: 'classic'`, `_element_width: 'initial'`) come from
 * each control's own `if` condition — the same source the gate validates
 * against, read in the opposite direction.
 *
 * `V3_CONTROL_CAPABILITIES` is the offline fallback for callers that pass no
 * schema. It is generated from the committed snapshot and pinned by a drift
 * test, following the same convention as `KNOWN_ABILITIES` in @elconv/mcp.
 */

import type { WidgetControlMap, WidgetControlSchema } from './widget-schema-types.js';
import { CONTAINER_SCHEMA_KEY } from './widget-schema-types.js';
import { COMPANION_FALLBACK } from './v3-control-capabilities.js';

// ============================================================================
// CSS property → candidate control ids
// ============================================================================

/**
 * Ordered candidate control ids per CSS property, most specific first.
 *
 * Order encodes a real preference, not a guess:
 *   - `background-color` prefers the bare `background_color` because on a
 *     `button` that is the button's own fill, while `_background_color` is the
 *     wrapper behind it. On every other widget only the wrapper form exists, so
 *     the fallback is what gets chosen.
 *   - `border-radius` prefers the bare form for the same reason: on a button the
 *     rounded thing is the button, not its wrapper.
 *   - `width` prefers `width` (the image's own display width, the container's
 *     width) and falls back to `_element_custom_width`, which needs the
 *     `_element_width: 'initial'` companion the generic mechanism supplies.
 *
 * The flex group (`gap`, `justify-content`, `align-items`, `flex-wrap`) exists
 * because dropping it was a measured, invisible loss: on one converted page the
 * emitter discarded 69 `gap`, 81 `align-items` and 63 `justify-content`
 * declarations, all on containers that declare `flex_gap`,
 * `flex_align_items` and `flex_justify_content`. Those controls are conditioned
 * on `container_type: ['flex']`, which their own `def: 'flex'` satisfies, so no
 * companion is needed — the properties were simply never looked up.
 */
const CSS_CONTROL_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  'background-color': ['background_color', '_background_color'],
  padding: ['padding', '_padding'],
  margin: ['margin', '_margin'],
  'border-radius': ['border_radius', '_border_radius'],
  width: ['width', '_element_custom_width'],
  // `boxed_width` is the container's own max width and is conditioned on
  // `content_width: 'boxed'`, which its default satisfies and which
  // `emitSection` writes explicitly.
  'max-width': ['boxed_width'],
  'min-height': ['min_height'],
  'text-align': ['align'],
  gap: ['flex_gap'],
  'justify-content': ['flex_justify_content'],
  'align-items': ['flex_align_items'],
  'flex-wrap': ['flex_wrap'],
  'flex-direction': ['flex_direction'],
  overflow: ['overflow'],
  position: ['position'],
  'z-index': ['z_index', '_z_index'],
  'font-family': ['typography_font_family'],
  'font-size': ['typography_font_size'],
  'font-weight': ['typography_font_weight'],
  'line-height': ['typography_line_height'],
  'letter-spacing': ['typography_letter_spacing'],
};

/**
 * The control a node's `color` maps onto, per schema key.
 *
 * Deliberately a per-widget map rather than a candidate list: `image` and
 * `divider` both declare `text_color`, but on `image` it is the caption colour
 * and on `divider` it only applies while `look: 'line_text'`. Resolving `color`
 * by "first candidate that exists" would write a colour that either styles the
 * wrong thing or is silently ignored — the failure mode the charter calls out
 * as worse than a rejection.
 *
 * `divider` is absent on purpose: its line colour is the `color` control, which
 * the emitter's divider branch writes explicitly from `background-color`.
 */
const COLOR_CONTROL_BY_SCHEMA_KEY: Readonly<Record<string, string>> = {
  heading: 'title_color',
  'text-editor': 'text_color',
  button: 'button_text_color',
  icon: 'primary_color',
  'icon-box': 'title_color',
  accordion: 'title_color',
};

/**
 * Declarations the target already satisfies, keyed by property then value.
 *
 * `display: flex` is the loudest case: `__container__.container_type` declares
 * `def: 'flex'`, so an Elementor container IS a flexbox before anything is
 * written. On one measured page 209 of these were reported as dropped styling —
 * noise that made the 40 genuinely lost `opacity` declarations impossible to
 * find.
 *
 * Value-keyed on purpose. `display: grid` is a real change (it needs
 * `container_type: 'grid'` plus the whole `grid_*` group) and must keep being
 * reported as unmapped, so only the exact no-op values are listed.
 */
const NO_OP_DECLARATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  display: {
    flex: 'an Elementor container is a flexbox by default (container_type defaults to "flex")',
  },
  // A wrapper that fills its parent is the default box behaviour; only a
  // constrained width is a real instruction, and that arrives as `max-width`.
  width: { '100%': 'a container fills its parent by default' },
  'max-width': { '100%': 'a container fills its parent by default' },
};

/**
 * CSS `text-align` values that need a rename for Elementor's `align` control.
 *
 * `align` declares `opts: ["start","center","end","justify"]` (live-verified on
 * heading). A computed style routinely reports `left` / `right`, which are not
 * in that list and would be reported as `invalid-enum`.
 */
const TEXT_ALIGN_ALIASES: Readonly<Record<string, string>> = {
  left: 'start',
  right: 'end',
  'start': 'start',
  'end': 'end',
  center: 'center',
  justify: 'justify',
};

// ============================================================================
// Resolution
// ============================================================================

export interface ResolvedCssControl {
  /** The control id to write. */
  controlId: string;
  /** The control's schema, so the caller can coerce the value to its shape. */
  control: WidgetControlSchema;
  /**
   * Sibling settings that must be written alongside, derived from the control's
   * own `if` condition. Empty when the condition is already satisfied by a
   * schema default.
   */
  companions: Record<string, unknown>;
  /** True when the control declares `r: 1` and accepts `_tablet` / `_mobile`. */
  responsive: boolean;
}

/**
 * Why a CSS property was not mapped.
 *
 * All are legitimate outcomes, not errors — but they are different fidelity
 * facts and the caller reports them separately. `no-op` and `source-variable`
 * are not losses at all, which is why they are distinguished: reporting them as
 * dropped styling buries the real gaps. On one measured page that was 209
 * `display: flex` declarations (the container's own default) and 80
 * `--framer-prop-*` custom properties, against 40 genuinely unsupported
 * `opacity` declarations.
 */
export interface UnmappedCssProperty {
  reason:
    | 'no-control'
    | 'unsafe-companion'
    | 'unsatisfiable-condition'
    /** The target already behaves this way; writing the control would change nothing. */
    | 'no-op'
    /** A source-internal custom property, never a target style. */
    | 'source-variable';
  detail: string;
}

export type CssControlResolution = ResolvedCssControl | UnmappedCssProperty;

/** Narrow a resolution to the mapped case. */
export function isResolvedCssControl(
  resolution: CssControlResolution,
): resolution is ResolvedCssControl {
  return 'controlId' in resolution;
}

/**
 * Companion control ids the mapping is allowed to write on its own initiative.
 *
 * The REQUIREMENT always comes from the control's `if` condition; this list is
 * only the permission to satisfy it, and it exists because not every condition
 * is a style enabler. Two live-verified shapes sit behind the same mechanism:
 *
 *   - `heading.typography_font_size` has `if: { "typography_typography!": "" }`.
 *     `typography_typography` is a `popover_toggle` whose only job is to turn the
 *     custom-typography group on. Writing it changes nothing visually except
 *     making the size apply — exactly the intent.
 *   - `divider.typography_font_size` has
 *     `if: { look: "line_text", "typography_typography!": "" }`. `look` is a
 *     `choose` over `["line","line_text","line_icon"]` that selects what the
 *     divider RENDERS. Satisfying it would turn a plain rule into a
 *     line-with-text — a divider that has no text, so it would render broken.
 *
 * A schema cannot tell those apart: both are ordinary `if` conditions. So a
 * condition naming anything outside this list means the property is dropped and
 * reported, rather than a rendering mode being invented.
 */
const SAFE_COMPANION_CONTROL_IDS: ReadonlySet<string> = new Set([
  'typography_typography',
  'background_background',
  '_background_background',
  '_element_width',
]);

/**
 * Resolve a CSS property onto a control of `controls`.
 *
 * An unmapped property is a legitimate, expected answer — a spacer genuinely has
 * no font size. The caller records it as a dropped property, which is a fidelity
 * fact worth reporting, not a build error.
 */
export function resolveCssControl(
  cssProperty: string,
  schemaKey: string,
  controls: WidgetControlMap,
  cssValue?: unknown,
): CssControlResolution {
  const property = cssProperty.trim().toLowerCase();

  // A Framer custom property (`--framer-prop-fkZfzWqjL`) is source-internal
  // plumbing: the value it holds is already reflected in the resolved computed
  // styles the extractor also captured. It has no target equivalent by design,
  // not by omission.
  if (property.startsWith('--')) {
    return {
      reason: 'source-variable',
      detail: `"${property}" is a source-internal custom property with no target control`,
    };
  }

  if (typeof cssValue === 'string') {
    const noOp = NO_OP_DECLARATIONS[property]?.[cssValue.trim().toLowerCase()];
    if (noOp !== undefined) {
      return { reason: 'no-op', detail: `${property}: ${cssValue} — ${noOp}` };
    }
  }

  const candidates = property === 'color'
    ? colorCandidates(schemaKey, controls)
    : CSS_CONTROL_CANDIDATES[property];
  if (candidates === undefined) {
    return { reason: 'no-control', detail: `${schemaKey} has no control for CSS "${property}"` };
  }

  // Kept so a rejection explains the LAST real obstacle rather than reporting
  // "no control" for a control that plainly exists.
  let rejection: UnmappedCssProperty | undefined;
  for (const controlId of candidates) {
    const control = controls[controlId];
    if (control === undefined) continue;

    const { companions, blockers } = companionRequirements(controlId, control, controls);

    if (blockers.length > 0) {
      rejection = {
        reason: 'unsatisfiable-condition',
        detail:
          `${schemaKey}.${controlId} only applies while ${blockers.join(', ')}, and the schema ` +
          'offers no value that satisfies it — Elementor would store the setting and never render it',
      };
      continue;
    }

    const unsafe = Object.keys(companions).filter((id) => !SAFE_COMPANION_CONTROL_IDS.has(id));
    if (unsafe.length > 0) {
      rejection = {
        reason: 'unsafe-companion',
        detail:
          `${schemaKey}.${controlId} only applies while ${unsafe
            .map((id) => `${id}=${JSON.stringify(companions[id])}`)
            .join(', ')}, which selects what the widget renders rather than ` +
          'enabling a style — the property was dropped instead of changing the widget',
      };
      continue;
    }

    return { controlId, control, companions, responsive: control.r === 1 };
  }
  return (
    rejection ?? {
      reason: 'no-control',
      detail:
        `${schemaKey} declares none of ${candidates.join(', ')} — ` +
        `CSS "${property}" has no equivalent on this widget`,
    }
  );
}

/**
 * The `color` candidates for one schema key.
 *
 * Falls back to `primary_color` when the widget declares it and nothing else
 * matched, because a widget whose only colour control is `primary_color` (icon)
 * uses it for exactly the thing CSS `color` describes.
 */
function colorCandidates(schemaKey: string, controls: WidgetControlMap): readonly string[] | undefined {
  const mapped = COLOR_CONTROL_BY_SCHEMA_KEY[schemaKey];
  if (mapped !== undefined) return [mapped];
  // The container renders no text of its own, and `__container__` declares no
  // colour control at all — inheriting is the correct behaviour here.
  if (schemaKey === CONTAINER_SCHEMA_KEY) return undefined;
  if ('primary_color' in controls) return ['primary_color'];
  return undefined;
}

/**
 * Coerce a CSS value for the resolved control, or reject it.
 *
 * Returns `{ ok: false, reason }` rather than a best-effort value: a slider
 * given `normal`, or a `select` given a value outside its `opts`, is a hard
 * schema-gate error and therefore a rejected write. Dropping the key lets
 * Elementor apply its own default, which is what the keyword meant.
 */
export function coerceControlValue(
  controlId: string,
  control: WidgetControlSchema,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const coerced = shapeValue(control, value);
  if (!coerced.ok) return coerced;

  if (ENUM_CONTROL_TYPES.has(control.t) && control.opts !== undefined && control.opts.length > 0) {
    const candidate = coerced.value;
    if (!control.opts.some((opt) => sameScalar(opt, candidate))) {
      return {
        ok: false,
        reason:
          `${JSON.stringify(candidate)} is not an allowed value for ${controlId} (${control.t}); ` +
          `allowed: ${JSON.stringify(control.opts)}`,
      };
    }
  }
  return { ok: true, value: coerced.value };
}

const ENUM_CONTROL_TYPES: ReadonlySet<string> = new Set(['select', 'select2', 'choose', 'visual_choice']);

function sameScalar(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const scalar = (v: unknown): boolean => typeof v === 'number' || typeof v === 'string';
  return scalar(a) && scalar(b) && String(a) === String(b);
}

function shapeValue(
  control: WidgetControlSchema,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (typeof value !== 'string') return { ok: true, value };
  const raw = value.trim();

  switch (control.t) {
    case 'dimensions': {
      const box = toBoxValue(raw);
      return box === undefined
        ? { ok: false, reason: `"${raw}" is not a box of lengths, so a dimensions control cannot take it` }
        : { ok: true, value: box };
    }
    case 'slider': {
      const dimension = toDimensionValue(raw);
      return dimension === undefined
        ? { ok: false, reason: `"${raw}" is not a numeric length, and a slider control rejects a keyword` }
        : { ok: true, value: dimension };
    }
    case 'gaps': {
      const gaps = toGapsValue(raw);
      return gaps === undefined
        ? { ok: false, reason: `"${raw}" is not one or two lengths, so a gaps control cannot take it` }
        : { ok: true, value: gaps };
    }
    case 'number': {
      // A computed style is always a string; Elementor's number control stores a
      // number. Writing "10" produces a `wrong-shape` gate error (measured: 156
      // of them, all z_index), so the numeric form is required, not cosmetic.
      const numeric = Number(raw);
      return raw !== '' && Number.isFinite(numeric)
        ? { ok: true, value: numeric }
        : { ok: false, reason: `"${raw}" is not a number, and a number control rejects a keyword` };
    }
    case 'choose':
    case 'select':
    case 'select2':
    case 'visual_choice':
      // `align` is the only choose control reached from a CSS property whose
      // vocabulary differs from Elementor's; the alias table is applied here so
      // the enum check downstream sees a value that can actually pass.
      return { ok: true, value: TEXT_ALIGN_ALIASES[raw.toLowerCase()] ?? raw };
    default:
      return { ok: true, value: raw };
  }
}

// ============================================================================
// Companions, derived from each control's own `if`
// ============================================================================

/**
 * The sibling settings a control needs in order to apply at all.
 *
 * Read from `control.if`, so this stays correct as the schema changes. Three
 * live cases it resolves, all previously hardcoded or missing:
 *
 *   - `typography_font_size` has `if: { "typography_typography!": "" }` and
 *     `typography_typography.rv === 'custom'` → `typography_typography:
 *     'custom'`. Without it Elementor stores the size and never renders it.
 *   - `_background_color` has `if: { _background_background: [...] }` with no
 *     default → `_background_background: 'classic'`.
 *   - `_element_custom_width` has `if: { _element_width: 'initial' }` →
 *     `_element_width: 'initial'`.
 *
 * A condition already satisfied by the sibling's schema default yields nothing:
 * `divider.color` requires `style != 'none'` and `style` defaults to `'solid'`,
 * so writing a companion there would be noise.
 */
export function requiredCompanions(
  controlId: string,
  control: WidgetControlSchema,
  controls: WidgetControlMap,
): Record<string, unknown> {
  return companionRequirements(controlId, control, controls).companions;
}

/** What a control's `if` condition demands, split by whether it can be met. */
export interface CompanionRequirements {
  /** Siblings to write, and the value to write. */
  companions: Record<string, unknown>;
  /**
   * Conditions the schema offers NO satisfying value for, as
   * `key=expected` strings. A control with a blocker can never render the value
   * written to it, so the property is dropped rather than stored invisibly.
   */
  blockers: string[];
}

/**
 * Companion requirements split into satisfiable ones and dead ends.
 *
 * A `blocker` is a condition the schema offers NO value for. The live case:
 * `icon.border_radius` has `if: { "view!": "default" }`, and `view` is a
 * `select` over `["default","stacked","framed"]` with `def: "default"` and no
 * `rv`. The condition is therefore unsatisfied by the default and there is no
 * schema-declared value to satisfy it with — `stacked` and `framed` both wrap
 * the icon in a shape, which is a rendering decision, not a style enabler.
 *
 * Silently treating that as "no companion needed" is what made the offline and
 * live paths disagree: offline dropped `border-radius` on an icon (the table
 * omits the control), live wrote it and Elementor would have stored it without
 * ever rendering it. Reporting it as a blocker makes both paths drop it.
 *
 * A condition the sibling's DEFAULT already satisfies yields neither — it is
 * simply met. That is why the container's whole flex group is mappable despite
 * being gated on `container_type: ['flex']`: `container_type` defaults to
 * `'flex'`.
 */
export function companionRequirements(
  controlId: string,
  control: WidgetControlSchema,
  controls: WidgetControlMap,
): CompanionRequirements {
  const condition = control.if;
  // No condition can mean two very different things: the control genuinely has
  // none, or the map is `V3_CONTROL_CAPABILITIES`, which records only `t` and
  // `r`. Distinguishing them by whether ANY control in the map declares an `if`
  // is what keeps the offline path from silently dropping the three companions
  // that decide whether a style renders at all.
  if (condition === undefined) {
    const fallback = controlsCarryConditions(controls) ? {} : { ...COMPANION_FALLBACK[controlId] };
    return { companions: fallback, blockers: [] };
  }

  const companions: Record<string, unknown> = {};
  const blockers: string[] = [];
  for (const [rawKey, expected] of Object.entries(condition)) {
    const negated = rawKey.endsWith('!');
    const withoutBang = negated ? rawKey.slice(0, -1) : rawKey;
    const bracket = withoutBang.indexOf('[');
    // A sub-field condition (`image[url]!`) is about the value the caller is
    // already writing, not about a sibling that could be defaulted.
    if (bracket !== -1) continue;
    const siblingId = withoutBang;
    // Self-referential conditions gate panel visibility, not validity.
    if (siblingId === controlId) continue;

    const sibling = controls[siblingId];
    if (sibling === undefined) continue;

    if (conditionSatisfied(sibling.def, expected, negated)) continue;

    const value = satisfyingValue(expected, negated, sibling);
    if (value === undefined) {
      blockers.push(`${rawKey}=${JSON.stringify(expected)}`);
      continue;
    }
    companions[siblingId] = value;
  }
  return { companions, blockers };
}

/**
 * True when this control map carries `if` conditions at all.
 *
 * A real schema always has some; `V3_CONTROL_CAPABILITIES` has none by
 * construction. Probing the map rather than taking a flag keeps the caller from
 * having to know which kind it holds.
 */
function controlsCarryConditions(controls: WidgetControlMap): boolean {
  for (const control of Object.values(controls)) {
    if (control.if !== undefined) return true;
  }
  return false;
}

function conditionSatisfied(actual: unknown, expected: unknown, negated: boolean): boolean {
  const list = Array.isArray(expected) ? expected : [expected];
  const normalized = actual === undefined ? '' : actual;
  const inList = list.some((entry) => sameScalar(entry, normalized));
  return negated ? !inList : inList;
}

/**
 * A value that satisfies the condition, or `undefined` when none is defensible.
 *
 * For a positive condition the first allowed value is the schema's own answer.
 * For a negated one only the sibling's `rv` ("on" value) is defensible —
 * inventing a value that merely differs from the rejected one would be a guess.
 */
function satisfyingValue(
  expected: unknown,
  negated: boolean,
  sibling: WidgetControlSchema,
): unknown {
  if (!negated) {
    const list = Array.isArray(expected) ? expected : [expected];
    return list.length > 0 ? list[0] : undefined;
  }
  return sibling.rv;
}

// ============================================================================
// Which control ids count as "visual"
// ============================================================================

/**
 * True when a control id styles the element rather than filling it with content.
 *
 * Derived from the same candidate tables the CSS mapping uses, which is the
 * point: a guard that counts styled elements must count the ids the emitter can
 * actually write. `G_SUBSTANCE_STYLED` used a hand-written prefix list
 * (`background_*`, `typography_*`, `padding`, `margin`, `*_color`) and therefore
 * scored a tree at 39% while missing 81 `flex_align_items`, 80
 * `flex_direction`, 69 `flex_gap`, 63 `flex_justify_content`, 27 `boxed_width`,
 * 48 `border_radius`/`_border_radius` and every `_padding` on a widget — all
 * real, all rendering.
 *
 * Content keys (`title`, `editor`, `html`, `image`, `link`) and structural
 * metadata (`_element_id`, `_column_size`, `content_width`) are deliberately not
 * visual: an element carrying only those is exactly what the guard is looking
 * for.
 */
export function isVisualControlId(controlId: string): boolean {
  const baseId = controlId.replace(/_(tablet|mobile)$/, '');
  if (VISUAL_CONTROL_IDS.has(baseId)) return true;
  // Prefix families cover the variants the tables do not enumerate:
  // `background_overlay_*`, `typography_text_transform`, `_background_hover_*`.
  return (
    baseId.startsWith('background_')
    || baseId.startsWith('_background_')
    || baseId.startsWith('typography_')
    || baseId.endsWith('_color')
  );
}

/**
 * Every control id the CSS mapping can select, plus the ones widget branches
 * write directly (`space` on a spacer, `weight`/`color` on a divider).
 *
 * Built from `CSS_CONTROL_CANDIDATES` and `COLOR_CONTROL_BY_SCHEMA_KEY` so it
 * cannot drift from what the emitter writes.
 */
const VISUAL_CONTROL_IDS: ReadonlySet<string> = new Set([
  ...Object.values(CSS_CONTROL_CANDIDATES).flat(),
  ...Object.values(COLOR_CONTROL_BY_SCHEMA_KEY),
  'primary_color',
  // Written by the structural-leaf branches rather than resolved from CSS.
  'space',
  'weight',
  'color',
  'style',
]);

// ============================================================================
// Length parsing
// ============================================================================

const LENGTH_PATTERN = /^(-?\d+(?:\.\d+)?)(px|%|em|rem|vw|vh)?$/i;

/** `"16px"` → `{ size: 16, unit: 'px' }`; `undefined` for a keyword. */
export function toDimensionValue(value: string): { size: number; unit: string } | undefined {
  const match = LENGTH_PATTERN.exec(value.trim());
  if (match === null) return undefined;
  return { size: Number(match[1]), unit: match[2]?.toLowerCase() ?? 'px' };
}

/**
 * CSS shorthand → Elementor's dimensions shape, or `undefined`.
 *
 * Elementor stores ONE unit for all four sides, so a genuinely mixed-unit
 * shorthand (`10px 2em`) cannot be represented and is rejected rather than
 * silently reinterpreted.
 */
export function toBoxValue(value: string): Record<string, unknown> | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0 || parts.length > 4) return undefined;

  const parsed = parts.map(toDimensionValue);
  if (parsed.some((entry) => entry === undefined)) return undefined;
  const sides = parsed as Array<{ size: number; unit: string }>;

  const unit = sides[0]!.unit;
  if (sides.some((side) => side.unit !== unit)) return undefined;

  const [first, second, third, fourth] = sides;
  const top = first!.size;
  const right = second?.size ?? top;
  const bottom = third?.size ?? top;
  const left = fourth?.size ?? right;
  return { unit, top, right, bottom, left, isLinked: false };
}

/**
 * CSS `gap` → Elementor's `gaps` control shape, or `undefined`.
 *
 * `gap: 24px` sets both axes; `gap: 8px 24px` is `row column` in CSS, and
 * Elementor stores the pair as `{ row, column }` with a single shared unit. The
 * shape is `{ column, row, isLinked, unit }` — verified against
 * `__container__.flex_gap`'s own `def`.
 */
export function toGapsValue(value: string): Record<string, unknown> | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0 || parts.length > 2) return undefined;

  const parsed = parts.map(toDimensionValue);
  if (parsed.some((entry) => entry === undefined)) return undefined;
  const lengths = parsed as Array<{ size: number; unit: string }>;

  const unit = lengths[0]!.unit;
  if (lengths.some((length) => length.unit !== unit)) return undefined;

  const row = lengths[0]!.size;
  const column = lengths[1]?.size ?? row;
  return { column, row, isLinked: lengths.length === 1, unit };
}
