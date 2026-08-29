/**
 * Schema gate — validate a V3 element tree against the live Elementor control
 * schema BEFORE a deploy is attempted (work package P2).
 *
 * Why this exists: `novamira/elementor-set-content` validates server-side and
 * rejects the whole write on an unknown control id, returning the compact
 * schema inline in the error. A real build in this repo failed with
 * "110 unknown key(s)" — every one of them knowable before the first request.
 * This module moves that class of failure from the deploy into the build.
 *
 * Design rule: EVERY verdict is derived from the schema, never from a
 * hand-maintained table that could drift. In particular companion requirements
 * come from each control's own `if` condition, which is why the gate correctly
 * distinguishes two live-verified cases that a hardcoded table gets wrong:
 *
 *   - `__container__.background_color` has `if: {background_background: [...]}`
 *     and `background_background` has NO default → the companion is REQUIRED.
 *   - `button.background_color` has the same condition, but `button`'s
 *     `background_background` defaults to `'classic'` → NOT required.
 *
 * See docs/BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md §8.
 */

import {
  baseControlId,
  breakpointOf,
  hasBreakpointSuffix,
} from '../breakpoints.js';
import {
  NON_CONTROL_SETTING_KEYS,
  SCHEMA_UNAVAILABLE_EL_TYPES,
  schemaKeyForElement,
  type WidgetControlMap,
  type WidgetControlSchema,
  type WidgetSchemaEntry,
  type WidgetSchemaMap,
} from './widget-schema-types.js';

// ============================================================================
// Violation model
// ============================================================================

export type SchemaViolationKind =
  /** The control id does not exist for this widget — the server would reject the write. */
  | 'unknown-key'
  /** The control id is unknown, but the schema for this widget is incomplete — cannot judge. */
  | 'unverified-key'
  /** Value is outside the control's declared `opts`. */
  | 'invalid-enum'
  /** A sibling control the `if` condition requires is entirely absent. */
  | 'missing-companion'
  /** The required sibling exists but holds a value the `if` condition rejects. */
  | 'unsatisfied-condition'
  /** `<control>_tablet` on a control that declares no responsive capability. */
  | 'non-responsive-suffix'
  /** The value does not match the control type's required shape. */
  | 'wrong-shape'
  /** Elementor exposes no schema for this element type (legacy section/column). */
  | 'schema-unavailable';

export interface SchemaViolation {
  /** The element's id in the tree. */
  elementId: string;
  /** Position in the tree, e.g. `[0].elements[2]` — survives duplicate ids. */
  path: string;
  /** The schema key that was validated against (`heading`, `__container__`, …). */
  widgetType: string;
  /** The offending settings key ('' for element-level findings). */
  key: string;
  kind: SchemaViolationKind;
  /**
   * `error` fails the gate. `warning` is reported but does not fail — used
   * where the schema itself is not authoritative enough to justify a block.
   */
  severity: 'error' | 'warning';
  detail: string;
  /** Closest known control id, when one is near enough to be useful. */
  suggestion?: string;
  /** For companion findings: the sibling key and a value that satisfies the condition. */
  fix?: { key: string; value: unknown };
  /**
   * True when `--skip-schema-gate` and `--force` must NOT be able to wave this
   * finding through. See `isUnskippableViolation`.
   */
  unskippable?: true;
}

/**
 * True when a violation describes a loss the user cannot see and the CLI must
 * therefore refuse to override.
 *
 * The override flags exist for a real reason: a stale snapshot must not block a
 * deploy, and a guard threshold is a judgement call. But they are the wrong tool
 * for a control Elementor stores and never renders, because the failure mode is
 * a page that reports "deploy successful" and shows nothing.
 *
 * Animation, motion-fx and sticky controls are exactly that class, and the
 * mechanism is documented in Elementor's own source: `animation_delay` is
 * conditioned on `animation!: ""`, every `motion_fx_*` effect on
 * `motion_fx_motion_fx_scrolling: "yes"`, every `sticky_*` on `sticky!: ""`.
 * An unsatisfied condition is dropped silently by the renderer — no error, no
 * log line, no visual hint. `--force` on such a finding does not accept a known
 * risk; it hides the only signal there was.
 *
 * Restricted to `missing-companion` and `unsatisfied-condition` on purpose. An
 * `unknown-key` in the same family is already fatal in a way the user WILL see:
 * `elementor-set-content` rejects the whole write. That one stays overridable,
 * because a stale snapshot can produce it falsely.
 */
export function isUnskippableViolation(violation: SchemaViolation): boolean {
  if (violation.kind !== 'missing-companion' && violation.kind !== 'unsatisfied-condition') {
    return false;
  }
  return isSilentLossControl(violation.key);
}

/**
 * True for a control whose unsatisfied condition produces a silent no-op.
 *
 * Matched on the control id rather than a list of exact names: Elementor
 * registers the breakpoint variants (`_animation_mobile`, `sticky_offset_tablet`)
 * as controls in their own right, and a hand-listed set would miss them.
 */
function isSilentLossControl(key: string): boolean {
  const id = baseControlId(key);
  return (
    id === 'animation'
    || id === '_animation'
    || id.startsWith('animation_')
    || id.startsWith('_animation_')
    || id.startsWith('motion_fx_')
    || id === 'sticky'
    || id.startsWith('sticky_')
  );
}

export interface SchemaGateReport {
  /** True when no `error`-severity violation was found. */
  ok: boolean;
  violations: SchemaViolation[];
  errorCount: number;
  warningCount: number;
  /**
   * Errors that `--skip-schema-gate` / `--force` must not be able to wave
   * through — see `isUnskippableViolation`.
   */
  unskippableCount: number;
  /** Elements visited (including those without a schema). */
  elementsChecked: number;
  /** Settings keys visited across all elements. */
  settingsChecked: number;
  /** Widget types in the tree that the schema did not cover. */
  missingWidgetTypes: string[];
}

// ============================================================================
// Public entry point
// ============================================================================

/** Minimal element shape the gate needs — structurally compatible with V3Element. */
export interface SchemaGateElement {
  id?: string;
  elType?: string;
  widgetType?: string;
  settings?: Record<string, unknown>;
  elements?: SchemaGateElement[];
}

/**
 * Every schema key the tree references, sorted.
 * This is the exact `widget_types` list to request from the server, so a fetch
 * never pulls schemas the tree does not need (the server warns that broad
 * style reads are very large).
 */
export function collectSchemaKeys(tree: readonly SchemaGateElement[]): string[] {
  const keys = new Set<string>();
  const walk = (elements: readonly SchemaGateElement[]): void => {
    for (const el of elements) {
      if (!isElementRecord(el)) continue;
      const key = schemaKeyForElement(el.elType ?? '', el.widgetType);
      if (key !== null) keys.add(key);
      if (Array.isArray(el.elements)) walk(el.elements);
    }
  };
  walk(Array.isArray(tree) ? tree : []);
  return [...keys].sort();
}

/**
 * True when a tree entry is shaped like an element at all.
 *
 * The gate reads trees that came from `JSON.parse` of a pipeline artifact, so a
 * `null` row or a bare string is reachable input, not a type-system
 * impossibility. Both entry points must survive it — see the "Never throws"
 * contract on `validateSettingsAgainstSchema`.
 */
function isElementRecord(value: unknown): value is SchemaGateElement {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface SchemaGateOptions {
  /**
   * When true, an unrecognized key is reported as `unverified-key` (warning)
   * instead of `unknown-key` (error) even for a widget marked complete. Set
   * this for a snapshot-sourced schema so a stale artifact cannot fail a build
   * for a control that exists live.
   */
  degraded?: boolean;
}

/**
 * Validate every element's settings against the schema.
 *
 * Never throws. An element whose schema is unavailable yields exactly ONE
 * `schema-unavailable` warning rather than one finding per key — a legacy
 * `section` tree must stay auditable, not drown in noise.
 */
export function validateSettingsAgainstSchema(
  tree: readonly SchemaGateElement[],
  schema: WidgetSchemaMap,
  options: SchemaGateOptions = {},
): SchemaGateReport {
  const violations: SchemaViolation[] = [];
  const missingWidgetTypes = new Set<string>();
  let elementsChecked = 0;
  let settingsChecked = 0;

  const walk = (elements: readonly SchemaGateElement[], parentPath: string): void => {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const path = `${parentPath}[${i}]`;
      elementsChecked++;
      // A tree row that is not an object at all (null, string, number) comes
      // from a malformed artifact. It is a finding, not a crash.
      if (!isElementRecord(el)) {
        violations.push({
          elementId: '(not an element)',
          path,
          widgetType: '(none)',
          key: '',
          kind: 'schema-unavailable',
          severity: 'warning',
          detail: `tree entry is not an element object (got ${el === null ? 'null' : typeof el})`,
        });
        continue;
      }
      const elementId = el.id ?? '(no id)';
      const elType = el.elType ?? '';
      // Same reasoning for a non-object `settings`: read nothing rather than
      // enumerating string indices as if they were control ids.
      const settings = isElementRecord(el.settings) ? el.settings : {};
      settingsChecked += Object.keys(settings).length;

      const children = Array.isArray(el.elements) ? el.elements : undefined;

      const schemaKey = schemaKeyForElement(elType, el.widgetType);
      if (schemaKey === null) {
        if (SCHEMA_UNAVAILABLE_EL_TYPES.has(elType)) {
          violations.push({
            elementId,
            path,
            widgetType: elType,
            key: '',
            kind: 'schema-unavailable',
            severity: 'warning',
            detail:
              `Elementor exposes no control schema for elType "${elType}" ` +
              `(elementor-get-schema reports it as missing), so its ${Object.keys(settings).length} ` +
              'setting(s) cannot be verified. Prefer elType "container".',
          });
        } else {
          violations.push({
            elementId,
            path,
            widgetType: elType || '(none)',
            key: '',
            kind: 'schema-unavailable',
            severity: 'warning',
            detail: el.widgetType === undefined && elType === 'widget'
              ? 'widget element carries no widgetType — no schema can be resolved'
              : `no schema key can be resolved for elType "${elType}"`,
          });
        }
        if (children) walk(children, `${path}.elements`);
        continue;
      }

      const entry = schema[schemaKey];
      if (entry === undefined) {
        missingWidgetTypes.add(schemaKey);
        violations.push({
          elementId,
          path,
          widgetType: schemaKey,
          key: '',
          kind: 'schema-unavailable',
          severity: 'warning',
          detail:
            `no schema was loaded for widget type "${schemaKey}" — its ` +
            `${Object.keys(settings).length} setting(s) were not verified`,
        });
        if (children) walk(children, `${path}.elements`);
        continue;
      }

      validateElementSettings({
        elementId,
        path,
        entry,
        settings,
        degraded: options.degraded === true,
        violations,
      });

      if (children) walk(children, `${path}.elements`);
    }
  };

  walk(Array.isArray(tree) ? tree : [], '');

  // Mark the findings no override may wave through, then count them. Done here
  // rather than at each push site so the rule lives in exactly one place and
  // cannot be forgotten by a future check.
  for (const violation of violations) {
    if (violation.severity === 'error' && isUnskippableViolation(violation)) {
      violation.unskippable = true;
    }
  }

  const errorCount = violations.filter((v) => v.severity === 'error').length;
  return {
    ok: errorCount === 0,
    violations,
    errorCount,
    warningCount: violations.length - errorCount,
    unskippableCount: violations.filter((v) => v.unskippable === true).length,
    elementsChecked,
    settingsChecked,
    missingWidgetTypes: [...missingWidgetTypes].sort(),
  };
}

// ============================================================================
// Per-element validation
// ============================================================================

function validateElementSettings(args: {
  elementId: string;
  path: string;
  entry: WidgetSchemaEntry;
  settings: Record<string, unknown>;
  degraded: boolean;
  violations: SchemaViolation[];
}): void {
  const { elementId, path, entry, settings, degraded, violations } = args;
  const controls = entry.controls;
  const widgetType = entry.widgetType;
  const push = (v: Omit<SchemaViolation, 'elementId' | 'path' | 'widgetType'>): void => {
    violations.push({ elementId, path, widgetType, ...v });
  };

  for (const [key, value] of Object.entries(settings)) {
    if (NON_CONTROL_SETTING_KEYS.has(key)) continue;

    const resolved = resolveControl(key, controls);
    if (resolved === null) {
      const suggestion = suggestControlId(key, Object.keys(controls));
      const judgeable = entry.complete && !degraded;
      push({
        key,
        kind: judgeable ? 'unknown-key' : 'unverified-key',
        severity: judgeable ? 'error' : 'warning',
        detail: judgeable
          ? `"${key}" is not a control of ${widgetType} — elementor-set-content rejects the whole write on an unknown key`
          : `"${key}" is not in the loaded schema of ${widgetType}, but that schema is incomplete — cannot confirm it is invalid`,
        ...(suggestion ? { suggestion } : {}),
      });
      continue;
    }

    const { control, baseKey, breakpoint } = resolved;

    if (breakpoint !== null && control.r === undefined) {
      push({
        key,
        kind: 'non-responsive-suffix',
        severity: 'error',
        detail: `"${baseKey}" declares no responsive capability, so "${key}" is not a valid control`,
        suggestion: baseKey,
      });
      continue;
    }

    // 1. Enum membership.
    const enumViolation = checkEnum(key, value, control);
    if (enumViolation) push(enumViolation);

    // 2. Value shape.
    const shapeViolation = checkShape(key, value, control);
    if (shapeViolation) push(shapeViolation);

    // 3. Companion / condition, derived from the control's own `if`.
    for (const v of checkCondition(key, baseKey, breakpoint, control, controls, settings)) {
      push(v);
    }

    // 4. Repeater rows against their declared sub-field schema.
    if (control.fields !== undefined && Array.isArray(value)) {
      checkRepeater(key, value, control.fields, push);
    }
  }
}

// ============================================================================
// Control resolution (breakpoint-aware)
// ============================================================================

interface ResolvedControl {
  control: WidgetControlSchema;
  /** The base control id (`padding` for `padding_tablet`). */
  baseKey: string;
  /** The targeted breakpoint, or null when the key is the base form. */
  breakpoint: 'tablet' | 'mobile' | null;
}

/**
 * Resolve a settings key onto its control.
 *
 * Order matters and is live-verified: Elementor registers SOME breakpoint
 * variants as controls in their own right (`_element_width_tablet`,
 * `_animation_mobile`, `button_width_tablet`, `sticky_offset_tablet` — all with
 * `r: { max: <bp> }`), while most are implicit suffixes on an `r: 1` base. An
 * exact lookup must therefore come first, otherwise a registered variant would
 * be judged against its base and misreported.
 */
export function resolveControl(
  key: string,
  controls: WidgetControlMap,
): ResolvedControl | null {
  const exact = controls[key];
  if (exact !== undefined) {
    return { control: exact, baseKey: key, breakpoint: null };
  }
  if (!hasBreakpointSuffix(key)) return null;

  const baseKey = baseControlId(key);
  const base = controls[baseKey];
  if (base === undefined) return null;

  const bp = breakpointOf(key);
  return {
    control: base,
    baseKey,
    breakpoint: bp === 'desktop' ? null : bp,
  };
}

// ============================================================================
// Check: enum membership
// ============================================================================

/** Control types whose value must come from `opts`. */
const ENUM_CONTROL_TYPES: ReadonlySet<string> = new Set([
  'select',
  'select2',
  'choose',
  'visual_choice',
]);

function checkEnum(
  key: string,
  value: unknown,
  control: WidgetControlSchema,
): Omit<SchemaViolation, 'elementId' | 'path' | 'widgetType'> | undefined {
  if (!ENUM_CONTROL_TYPES.has(control.t)) return undefined;
  const opts = control.opts;
  if (opts === undefined || opts.length === 0) return undefined;

  // `arr: true` controls accept a scalar (wrapped server-side) or an array.
  const values = Array.isArray(value) ? value : [value];
  const invalid = values.filter((v) => !optsInclude(opts, v));
  if (invalid.length === 0) return undefined;

  return {
    key,
    kind: 'invalid-enum',
    severity: 'error',
    detail:
      `${JSON.stringify(invalid.length === 1 ? invalid[0] : invalid)} is not an allowed value for "${key}" ` +
      `(${control.t}); allowed: ${JSON.stringify(opts)}`,
  };
}

/**
 * Compare against `opts` tolerating the number/string ambiguity the server
 * itself has: `typography_font_weight` lists `[100, …, 900, "", "normal"]` as
 * numbers, `text_columns` lists `["", 1, 2, …]`, and both accept the string
 * form over the wire.
 */
function optsInclude(opts: readonly unknown[], value: unknown): boolean {
  for (const opt of opts) {
    if (opt === value) return true;
    if (
      (typeof opt === 'number' || typeof opt === 'string') &&
      (typeof value === 'number' || typeof value === 'string') &&
      String(opt) === String(value)
    ) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Check: value shape
// ============================================================================

function checkShape(
  key: string,
  value: unknown,
  control: WidgetControlSchema,
): Omit<SchemaViolation, 'elementId' | 'path' | 'widgetType'> | undefined {
  const fail = (detail: string): Omit<SchemaViolation, 'elementId' | 'path' | 'widgetType'> => ({
    key,
    kind: 'wrong-shape',
    severity: 'error',
    detail,
  });
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

  switch (control.t) {
    case 'dimensions': {
      if (!isRecord(value)) {
        return fail(`"${key}" is a dimensions control and needs { unit, top, right, bottom, left, isLinked }, got ${describe(value)}`);
      }
      if (typeof value.unit !== 'string') {
        return fail(`"${key}" (dimensions) is missing the required string "unit"`);
      }
      if (!['top', 'right', 'bottom', 'left'].some((side) => side in value)) {
        return fail(`"${key}" (dimensions) has a unit but no top/right/bottom/left value`);
      }
      return undefined;
    }
    case 'slider': {
      if (!isRecord(value)) {
        return fail(`"${key}" is a slider control and needs { size, unit }, got ${describe(value)}`);
      }
      if (!('size' in value)) return fail(`"${key}" (slider) is missing "size"`);
      if (typeof value.unit !== 'string') return fail(`"${key}" (slider) is missing the required string "unit"`);
      return undefined;
    }
    case 'gaps': {
      if (!isRecord(value)) {
        return fail(`"${key}" is a gaps control and needs { column, row, isLinked, unit }, got ${describe(value)}`);
      }
      if (!('column' in value) || !('row' in value)) {
        return fail(`"${key}" (gaps) needs both "column" and "row"`);
      }
      return undefined;
    }
    case 'switcher':
    case 'popover_toggle': {
      const on = control.rv ?? 'yes';
      if (typeof value === 'boolean') {
        return fail(`"${key}" is a ${control.t}: send "${on}" for on and "" for off, not a boolean`);
      }
      if (value !== '' && value !== on) {
        return fail(`"${key}" is a ${control.t} and accepts only "${on}" or "", got ${describe(value)}`);
      }
      return undefined;
    }
    case 'color': {
      if (typeof value !== 'string') {
        return fail(`"${key}" is a color control and needs a string like "#1c1812", got ${describe(value)}`);
      }
      return undefined;
    }
    case 'text':
    case 'textarea':
    case 'code':
    case 'wysiwyg':
    case 'font':
    case 'hover_animation':
    case 'animation': {
      if (typeof value !== 'string') {
        // css_classes as an array renders the literal string "Array" — a
        // reproduced production bug documented in AGENTS.md §6.
        return fail(`"${key}" is a ${control.t} control and needs a string, got ${describe(value)}`);
      }
      return undefined;
    }
    case 'number': {
      if (typeof value === 'number') return undefined;
      if (typeof value === 'string' && (value === '' || Number.isFinite(Number(value)))) return undefined;
      return fail(`"${key}" is a number control, got ${describe(value)}`);
    }
    case 'media': {
      if (!isRecord(value)) {
        return fail(`"${key}" is a media control and needs { url, id, size }, got ${describe(value)}`);
      }
      if (!('url' in value) && !('id' in value)) {
        return fail(`"${key}" (media) needs at least "url" or "id"`);
      }
      return undefined;
    }
    case 'url': {
      if (!isRecord(value)) {
        return fail(`"${key}" is a url control and needs { url, is_external, nofollow }, got ${describe(value)}`);
      }
      if (!('url' in value)) return fail(`"${key}" (url) is missing "url"`);
      return undefined;
    }
    case 'box_shadow': {
      if (!isRecord(value)) {
        return fail(`"${key}" is a box_shadow control and needs { horizontal, vertical, blur, spread, color }, got ${describe(value)}`);
      }
      return undefined;
    }
    case 'repeater': {
      if (!Array.isArray(value)) {
        return fail(`"${key}" is a repeater control and needs an array of rows, got ${describe(value)}`);
      }
      return undefined;
    }
    default:
      // Unknown control type: no shape assumption is defensible.
      return undefined;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array (${JSON.stringify(value).slice(0, 60)})`;
  if (typeof value === 'object') return `object ${JSON.stringify(value).slice(0, 60)}`;
  return JSON.stringify(value);
}

// ============================================================================
// Check: `if` conditions (companions)
// ============================================================================

interface ParsedConditionKey {
  controlId: string;
  subField?: string;
  negated: boolean;
}

/**
 * Parse an Elementor condition key.
 *
 * Forms live-verified in the 4.2.1 schema:
 *   `background_background`        → equality against the control
 *   `typography_typography!`       → negated
 *   `image[url]!`                  → negated, sub-field access
 *   `grid_columns_grid[unit]`      → sub-field access
 */
export function parseConditionKey(raw: string): ParsedConditionKey {
  const negated = raw.endsWith('!');
  const withoutBang = negated ? raw.slice(0, -1) : raw;
  const bracket = withoutBang.indexOf('[');
  if (bracket !== -1 && withoutBang.endsWith(']')) {
    return {
      controlId: withoutBang.slice(0, bracket),
      subField: withoutBang.slice(bracket + 1, -1),
      negated,
    };
  }
  return { controlId: withoutBang, negated };
}

/**
 * Evaluate one condition entry against the actual settings.
 *
 * Returns `'satisfied'`, `'absent'` (the sibling is not set at all — a missing
 * companion) or `'violated'` (the sibling is set to a rejected value).
 *
 * The sibling's schema default matters: Elementor renders as if the default
 * were written, so a condition satisfied by the default is satisfied by an
 * absent sibling. This is what separates `__container__.background_color`
 * (companion `background_background` has no default → required) from
 * `button.background_color` (defaults to `'classic'` → not required).
 */
function evaluateCondition(
  raw: string,
  expected: unknown,
  controls: WidgetControlMap,
  settings: Record<string, unknown>,
  breakpoint: 'tablet' | 'mobile' | null,
): { state: 'satisfied' | 'absent' | 'violated'; satisfyingValue?: unknown; controlId: string } {
  const { controlId, subField, negated } = parseConditionKey(raw);

  const suffixedKey = breakpoint === null ? undefined : `${controlId}_${breakpoint}`;
  const present =
    suffixedKey !== undefined && suffixedKey in settings
      ? { value: settings[suffixedKey] }
      : controlId in settings
        ? { value: settings[controlId] }
        : undefined;

  const siblingSchema = controls[controlId];
  const rawValue = present !== undefined ? present.value : siblingSchema?.def;
  const actual = subField === undefined
    ? rawValue
    : rawValue !== null && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)[subField]
      : undefined;

  const matches = conditionMatches(actual, expected, negated);
  if (matches) return { state: 'satisfied', controlId };

  const satisfyingValue = satisfyingValueFor(expected, negated, siblingSchema);
  return {
    state: present === undefined ? 'absent' : 'violated',
    ...(satisfyingValue !== undefined ? { satisfyingValue } : {}),
    controlId,
  };
}

function conditionMatches(actual: unknown, expected: unknown, negated: boolean): boolean {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  // An absent value behaves like the empty string in Elementor's own checks.
  const normalized = actual === undefined ? '' : actual;
  const inList = expectedList.some((e) => {
    if (e === normalized) return true;
    if (
      (typeof e === 'number' || typeof e === 'string') &&
      (typeof normalized === 'number' || typeof normalized === 'string')
    ) {
      return String(e) === String(normalized);
    }
    return false;
  });
  return negated ? !inList : inList;
}

/**
 * A value that would satisfy the condition, for the `fix` hint.
 * For a positive condition that is the first allowed value; for a negated one
 * only the schema's own default is defensible — otherwise no hint is given
 * rather than an invented value.
 */
function satisfyingValueFor(
  expected: unknown,
  negated: boolean,
  siblingSchema: WidgetControlSchema | undefined,
): unknown {
  if (!negated) {
    const list = Array.isArray(expected) ? expected : [expected];
    return list.length > 0 ? list[0] : undefined;
  }
  if (siblingSchema?.rv !== undefined) return siblingSchema.rv;
  return undefined;
}

function checkCondition(
  key: string,
  baseKey: string,
  breakpoint: 'tablet' | 'mobile' | null,
  control: WidgetControlSchema,
  controls: WidgetControlMap,
  settings: Record<string, unknown>,
): Omit<SchemaViolation, 'elementId' | 'path' | 'widgetType'>[] {
  const condition = control.if;
  if (condition === undefined) return [];

  const out: Omit<SchemaViolation, 'elementId' | 'path' | 'widgetType'>[] = [];
  for (const [raw, expected] of Object.entries(condition)) {
    const { controlId } = parseConditionKey(raw);
    // Self-referential conditions gate the panel's own visibility, not the
    // value's validity. Live examples: `heading.size` has `if: {"size!":
    // "default"}` and `_element_vertical_align` lists itself. Evaluating them
    // would flag a control for holding its own default.
    if (controlId === baseKey) continue;
    // A condition referencing a control this schema does not declare cannot be
    // evaluated; guessing would produce false positives.
    if (!(controlId in controls) && !(controlId in settings)) continue;

    const result = evaluateCondition(raw, expected, controls, settings, breakpoint);
    if (result.state === 'satisfied') continue;

    const requirement = `${raw} = ${JSON.stringify(expected)}`;
    if (result.state === 'absent') {
      out.push({
        key,
        kind: 'missing-companion',
        severity: 'error',
        detail:
          `"${key}" only applies while ${requirement}, and "${result.controlId}" is not set ` +
          `(no schema default satisfies it) — Elementor ignores "${baseKey}" silently`,
        suggestion: result.controlId,
        ...(result.satisfyingValue !== undefined
          ? { fix: { key: result.controlId, value: result.satisfyingValue } }
          : {}),
      });
    } else {
      out.push({
        key,
        kind: 'unsatisfied-condition',
        severity: 'error',
        detail:
          `"${key}" only applies while ${requirement}, but "${result.controlId}" is ` +
          `${describe(settings[result.controlId])} — Elementor ignores "${baseKey}" silently`,
        suggestion: result.controlId,
        ...(result.satisfyingValue !== undefined
          ? { fix: { key: result.controlId, value: result.satisfyingValue } }
          : {}),
      });
    }
  }
  return out;
}

// ============================================================================
// Check: repeater rows
// ============================================================================

function checkRepeater(
  key: string,
  rows: readonly unknown[],
  fields: WidgetControlMap,
  push: (v: Omit<SchemaViolation, 'elementId' | 'path' | 'widgetType'>) => void,
): void {
  const known = Object.keys(fields);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      push({
        key: `${key}[${i}]`,
        kind: 'wrong-shape',
        severity: 'error',
        detail: `repeater row ${i} of "${key}" must be an object, got ${describe(row)}`,
      });
      continue;
    }
    for (const rowKey of Object.keys(row as Record<string, unknown>)) {
      if (rowKey in fields) continue;
      const suggestion = suggestControlId(rowKey, known);
      push({
        key: `${key}[${i}].${rowKey}`,
        kind: 'unknown-key',
        severity: 'error',
        // Reproduced gotcha: accordion rows are keyed `_id`, not `id`.
        detail: `"${rowKey}" is not a field of the "${key}" repeater; known fields: ${known.join(', ')}`,
        ...(suggestion ? { suggestion } : {}),
      });
    }
  }
}

// ============================================================================
// Suggestion (Levenshtein)
// ============================================================================

/** Max edit distance still considered a plausible typo, relative to length. */
const SUGGESTION_MAX_DISTANCE = 4;

/**
 * Closest known control id to `key`, or undefined when nothing is near enough.
 *
 * Underscore-insensitive comparison so `text_color` → `title_color` and
 * `gap` → `flex_gap` are found; a substring containment shortcut catches the
 * common prefix-drop case (`gap` inside `flex_gap`) that raw edit distance
 * would rank too far.
 */
export function suggestControlId(key: string, known: readonly string[]): string | undefined {
  if (known.length === 0) return undefined;
  const normalize = (s: string): string => s.replace(/_/g, '').toLowerCase();
  const target = normalize(key);

  let best: { id: string; score: number } | undefined;
  for (const candidate of known) {
    const normalized = normalize(candidate);
    let score: number;
    if (normalized === target) {
      score = 0;
    } else if (normalized.includes(target) || target.includes(normalized)) {
      score = Math.abs(normalized.length - target.length) / 2;
    } else {
      score = levenshtein(target, normalized);
    }
    if (best === undefined || score < best.score) best = { id: candidate, score };
  }
  if (best === undefined) return undefined;
  const limit = Math.min(SUGGESTION_MAX_DISTANCE, Math.max(2, Math.ceil(target.length / 2)));
  return best.score <= limit ? best.id : undefined;
}

/** Iterative two-row Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

// ============================================================================
// Reporting
// ============================================================================

/** Human-readable gate report for CLI output. */
export function formatSchemaGateReport(report: SchemaGateReport, options: { limit?: number } = {}): string {
  const limit = options.limit ?? 25;
  const lines: string[] = [
    `Schema gate: ${report.ok ? 'PASS' : 'FAIL'} — ${report.errorCount} error(s), ` +
      `${report.warningCount} warning(s) across ${report.elementsChecked} element(s) / ` +
      `${report.settingsChecked} setting(s)`,
  ];
  if (report.unskippableCount > 0) {
    lines.push(
      `  ${report.unskippableCount} of these cannot be overridden: an animation, motion-fx or ` +
        'sticky control whose companion is missing is dropped by Elementor without any error, ' +
        'so a forced deploy would report success and show nothing.',
    );
  }
  const ordered = [
    ...report.violations.filter((v) => v.severity === 'error'),
    ...report.violations.filter((v) => v.severity === 'warning'),
  ];
  for (const v of ordered.slice(0, limit)) {
    const icon = v.severity === 'error' ? '✗' : '⚠';
    const at = v.key ? ` ${v.widgetType}.${v.key}` : ` ${v.widgetType}`;
    const lock = v.unskippable === true ? ' [not overridable]' : '';
    lines.push(`  ${icon} [${v.kind}]${at}${lock} (${v.path}) — ${v.detail}`);
    if (v.suggestion !== undefined) lines.push(`      ↳ did you mean "${v.suggestion}"?`);
    if (v.fix !== undefined) lines.push(`      ↳ add ${v.fix.key}: ${JSON.stringify(v.fix.value)}`);
  }
  if (ordered.length > limit) {
    lines.push(`  … and ${ordered.length - limit} more`);
  }
  if (report.missingWidgetTypes.length > 0) {
    lines.push(`  Schema missing for: ${report.missingWidgetTypes.join(', ')}`);
  }
  return lines.join('\n');
}
