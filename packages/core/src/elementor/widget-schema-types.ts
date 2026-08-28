/**
 * Shared types for the Elementor control-schema gate (work package P2).
 *
 * The shapes mirror the compact payload of `novamira/elementor-get-schema`
 * (`action: 'get'`), live-verified against Elementor 4.2.1 + Pro 4.1.0 on
 * testseite.nick-webdesign.de (2026-08-24):
 *
 * ```json
 * { "flex_gap": { "t": "gaps", "def": {...}, "if": {"container_type":["flex"]}, "r": 1 },
 *   "hide_tablet": { "t": "switcher", "rv": "hidden-tablet" },
 *   "sticky_on": { "t": "select2", "opts": ["desktop","tablet","mobile"], "arr": true } }
 * ```
 *
 * These types live in @elconv/core (not @elconv/mcp) because the validator is
 * transport-independent: it works against a live fetch, a disk cache or the
 * committed snapshot alike. @elconv/mcp imports them for the fetch path.
 *
 * See docs/BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md §8 (work package P2).
 */

/**
 * A single Elementor control as the server describes it.
 *
 * Field names are the server's abbreviations — kept verbatim so a live payload
 * can be fed into the validator without a translation layer that could drift.
 */
export interface WidgetControlSchema {
  /** Control type: `select` | `choose` | `slider` | `dimensions` | `gaps` | `color` | `switcher` | … */
  t: string;
  /** Allowed values for `select` / `choose` / `select2` / `visual_choice`. */
  opts?: readonly unknown[];
  /** Default value the renderer uses when the setting is absent. */
  def?: unknown;
  /**
   * Visibility condition. `{ "background_background": ["classic"] }` means the
   * control only applies when that sibling holds one of those values;
   * a trailing `!` negates (`{ "typography_typography!": "" }`).
   * A key may address a sub-field: `{ "image[url]!": "" }`.
   *
   * This is also the authoritative companion requirement — see
   * `evaluateControlCondition` in `schema-gate.ts`.
   */
  if?: Record<string, unknown>;
  /**
   * Responsive capability. `1` = every breakpoint; `{ max: 'tablet' }` = the
   * control IS the breakpoint variant and only exists up to that viewport.
   */
  r?: 1 | { min?: string; max?: string };
  /** When true a scalar is wrapped into a 1-element array server-side. */
  arr?: boolean;
  /** The "on" value of a `switcher` / `popover_toggle` (e.g. `'yes'`, `'custom'`). */
  rv?: string;
  /** Repeater sub-field schemas (e.g. `accordion.tabs`). */
  fields?: Record<string, WidgetControlSchema>;
}

/** Every control of one widget type, keyed by control id. */
export type WidgetControlMap = Record<string, WidgetControlSchema>;

/**
 * One widget type's schema plus the honesty flag that decides how hard an
 * unrecognized key is judged.
 */
export interface WidgetSchemaEntry {
  /** The schema key as the server addresses it (`heading`, `__container__`, …). */
  widgetType: string;
  controls: WidgetControlMap;
  /**
   * True only when every control of every tab was captured. A partial entry
   * downgrades an unrecognized key from `unknown-key` (error) to
   * `unverified-key` (warning) — a partial snapshot must never fail a build
   * for a control it simply never saw.
   */
  complete: boolean;
}

/** Widget type → schema entry. */
export type WidgetSchemaMap = Record<string, WidgetSchemaEntry>;

/** Where a schema came from. Reported so a degraded run is never silent. */
export type WidgetSchemaSource = 'live' | 'cache' | 'snapshot';

/** A schema plus its provenance. */
export interface ResolvedWidgetSchema {
  schema: WidgetSchemaMap;
  source: WidgetSchemaSource;
  /**
   * True when the schema cannot support hard `unknown-key` verdicts for every
   * widget in the tree — either because it came from the partial snapshot or
   * because a widget type is missing entirely.
   */
  degraded: boolean;
  /** Human-readable reasons for `degraded` (empty when not degraded). */
  degradedReasons: string[];
}

/**
 * Elementor 4.x exposes no control schema for the legacy `section` and
 * `column` element types — `elementor-get-schema` reports them as `missing`
 * (live-verified 2026-08-24: requesting `section`, `column`, `container`
 * returns `missing: ["section","column","container"]`, only `__container__`
 * resolves). They still render, so a tree using them is not invalid; the gate
 * reports them as `schema-unavailable` instead of flagging every key.
 */
export const SCHEMA_UNAVAILABLE_EL_TYPES: ReadonlySet<string> = new Set(['section', 'column']);

/** The schema key Elementor uses for the flexbox container element. */
export const CONTAINER_SCHEMA_KEY = '__container__';

/**
 * Settings keys that are structural metadata rather than controls. Elementor
 * writes them into `_elementor_data` itself, so they must never be reported as
 * unknown.
 *
 * `__globals__` maps a control id onto a global-kit reference
 * (`globals/colors?id=primary`); `_id` is the repeater-row identity.
 */
export const NON_CONTROL_SETTING_KEYS: ReadonlySet<string> = new Set([
  '_id',
  '__globals__',
  '__dynamic__',
]);

/**
 * Resolve a V3 element onto its schema key.
 * Returns `null` for element types Elementor exposes no schema for.
 */
export function schemaKeyForElement(
  elType: string,
  widgetType?: string,
): string | null {
  if (elType === 'container') return CONTAINER_SCHEMA_KEY;
  if (elType === 'widget') return widgetType ?? null;
  return null;
}
