/**
 * Per-widget control capabilities for the CSS → V3 control mapping, offline.
 *
 * ## Why a table at all
 *
 * `resolveCssControl` needs a `WidgetControlMap` for the widget it is writing.
 * With a live or snapshot-backed `ResolvedWidgetSchema` that map is the real
 * thing. But the V3 emitter is deliberately offline-capable — `elconv convert`
 * runs with no credentials and no transport — and without any map at all the
 * emitter would fall back to exactly the behaviour that produced 724
 * `unknown-key` errors against the live schema: one control id per CSS property
 * regardless of widget.
 *
 * So this table is the offline floor, not a convenience. It is a strict subset
 * of the committed snapshot, restricted to the control ids the CSS mapping can
 * ever choose, and `v3-control-capabilities.test.ts` pins every entry against
 * `schemas/elementor-v3-controls.snapshot.json` — a control that changes type,
 * loses `r: 1`, or disappears fails the build. Same convention as
 * `KNOWN_ABILITIES` in @elconv/mcp: a generated constant plus a drift gate,
 * never a hand-maintained list.
 *
 * ## What it is NOT
 *
 * It is not a schema and must not be passed to the schema gate. Every entry
 * omits `if` conditions, so companion resolution against this table falls back
 * to `COMPANION_FALLBACK`, which encodes the three live-verified style-enabling
 * conditions by name. A real schema always wins when one is available.
 *
 * ## Why some live controls are deliberately absent
 *
 * A control whose live `if` condition names a RENDERING-MODE sibling is omitted
 * from this table on purpose, so the offline path drops the property for
 * "no control" exactly where the live path drops it for "unsafe companion". The
 * two paths must agree on the OUTCOME; only the reported reason differs.
 * Omitted for this reason, each verified in the snapshot:
 *
 *   - `__container__.width` — `if: { content_width: 'full' }`. Satisfying it
 *     switches the container out of boxed layout.
 *   - `divider.border_radius` / `text_color` / `primary_color` /
 *     `typography_*` — all conditioned on `look` (`line` | `line_text` |
 *     `line_icon`) or `icon_view`. Satisfying `look` turns a plain rule into a
 *     line-with-text, which for a textless divider renders broken.
 *   - `icon.border_radius`, `icon-box.border_radius` — `if: { "view!":
 *     "default" }`. Satisfying it wraps the icon in a framed/stacked shape.
 *   - `image.text_color` — the caption colour, gated on `caption_source !=
 *     'none'`. Writing it would turn captions on.
 *
 * `v3-control-capabilities.test.ts` asserts this property directly: no entry in
 * this table may carry a snapshot `if` naming a companion outside
 * `SAFE_COMPANION_CONTROL_IDS`.
 *
 * Captured from Elementor 4.2.1 + Pro 4.1.0.
 */

import type { WidgetControlMap } from './widget-schema-types.js';

/**
 * Control ids the CSS mapping can select, per schema key.
 *
 * Only `t` (control type) and `r` (responsive capability) are recorded, because
 * those are the only two facts the mapping reads: `t` decides the value shape,
 * `r` decides whether a `_tablet` / `_mobile` suffix is legal.
 */
export const V3_CONTROL_CAPABILITIES: Readonly<Record<string, WidgetControlMap>> = {
  __container__: {
    padding: { t: 'dimensions', r: 1 },
    margin: { t: 'dimensions', r: 1 },
    border_radius: { t: 'dimensions', r: 1 },
    background_color: { t: 'color' },
    background_background: { t: 'choose' },
    // `width` is omitted: live `if: { content_width: 'full' }`.
    min_height: { t: 'slider', r: 1 },
    // The container's own max width. Conditioned on `content_width: 'boxed'`,
    // which its default satisfies and which `emitSection` writes explicitly.
    boxed_width: { t: 'slider', r: 1 },
    // The flex group. All conditioned on `container_type: ['flex']`, which its
    // own `def: 'flex'` satisfies — so no companion is needed and dropping them
    // was pure loss: 69 `gap`, 81 `align-items` and 63 `justify-content`
    // declarations discarded on one measured page.
    flex_direction: { t: 'choose', r: 1 },
    flex_gap: { t: 'gaps', r: 1 },
    flex_justify_content: { t: 'choose', r: 1 },
    flex_align_items: { t: 'choose', r: 1 },
    flex_wrap: { t: 'choose', r: 1 },
    overflow: { t: 'select' },
  },
  accordion: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    title_color: { t: 'color' },
  },
  button: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    border_radius: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    background_color: { t: 'color' },
    _background_color: { t: 'color' },
    background_background: { t: 'choose' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    align: { t: 'choose', r: 1 },
    button_text_color: { t: 'color' },
    typography_typography: { t: 'popover_toggle' },
    typography_font_family: { t: 'font' },
    typography_font_size: { t: 'slider', r: 1 },
    typography_font_weight: { t: 'select' },
    typography_line_height: { t: 'slider', r: 1 },
    typography_letter_spacing: { t: 'slider', r: 1 },
  },
  divider: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    // `border_radius` is omitted: live `if: { look: 'line_icon', "icon_view!":
    // 'default' }`. On divider it is also a slider, not a box — a second reason
    // the generic `border-radius` mapping must never reach it.
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    width: { t: 'slider', r: 1 },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    align: { t: 'choose', r: 1 },
    // `text_color`, `primary_color` and every `typography_*` are omitted: all
    // are gated on `look`, which selects what the divider renders.
    // The line colour is the `color` control, which the emitter writes
    // explicitly from `background-color` in its divider branch.
  },
  form: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    button_text_color: { t: 'color' },
  },
  heading: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    align: { t: 'choose', r: 1 },
    title_color: { t: 'color' },
    typography_typography: { t: 'popover_toggle' },
    typography_font_family: { t: 'font' },
    typography_font_size: { t: 'slider', r: 1 },
    typography_font_weight: { t: 'select' },
    typography_line_height: { t: 'slider', r: 1 },
    typography_letter_spacing: { t: 'slider', r: 1 },
  },
  html: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
  },
  icon: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    // `border_radius` is omitted: live `if: { "view!": 'default' }` — satisfying
    // it would wrap the icon in a framed/stacked shape.
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    align: { t: 'choose', r: 1 },
    primary_color: { t: 'color' },
  },
  'icon-box': {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    // `border_radius` omitted for the same `view!` reason as `icon`.
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    title_color: { t: 'color' },
    // `primary_color` is omitted: live `if: { "selected_icon[value]!": '' }`,
    // which is about the icon the caller chose, not a defaultable sibling.
  },
  image: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    width: { t: 'slider', r: 1 },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    align: { t: 'choose', r: 1 },
    // `text_color` is omitted: it is the CAPTION colour, gated on
    // `caption_source != 'none'`. Writing it would turn captions on.
    space: { t: 'slider', r: 1 },
  },
  spacer: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    space: { t: 'slider', r: 1 },
  },
  'text-editor': {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
    align: { t: 'choose', r: 1 },
    text_color: { t: 'color' },
    typography_typography: { t: 'popover_toggle' },
    typography_font_family: { t: 'font' },
    typography_font_size: { t: 'slider', r: 1 },
    typography_font_weight: { t: 'select' },
    typography_line_height: { t: 'slider', r: 1 },
    typography_letter_spacing: { t: 'slider', r: 1 },
  },
  video: {
    _padding: { t: 'dimensions', r: 1 },
    _margin: { t: 'dimensions', r: 1 },
    _border_radius: { t: 'dimensions', r: 1 },
    _background_color: { t: 'color' },
    _background_background: { t: 'choose' },
    _element_custom_width: { t: 'slider', r: 1 },
    _element_width: { t: 'select', r: 1 },
  },
};

/**
 * Companion requirements by control id, for the offline path only.
 *
 * `V3_CONTROL_CAPABILITIES` carries no `if` conditions, so
 * `requiredCompanions()` cannot derive anything from it. These are the
 * style-enabling conditions that matter for the CSS mapping, each live-verified
 * and each one a documented silent-loss bug when omitted (AGENTS.md §6):
 *
 *   - `typography_*` without `typography_typography: 'custom'` is stored and
 *     never rendered.
 *   - a background colour without its `*_background: 'classic'` companion is
 *     stored and never rendered.
 *   - `_element_custom_width` without `_element_width: 'initial'` is ignored.
 *
 * A real schema supersedes this entirely: `resolveCssControl` reads `control.if`
 * and never consults this map.
 */
export const COMPANION_FALLBACK: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  typography_font_family: { typography_typography: 'custom' },
  typography_font_size: { typography_typography: 'custom' },
  typography_font_weight: { typography_typography: 'custom' },
  typography_line_height: { typography_typography: 'custom' },
  typography_letter_spacing: { typography_typography: 'custom' },
  background_color: { background_background: 'classic' },
  _background_color: { _background_background: 'classic' },
  _element_custom_width: { _element_width: 'initial' },
};

/**
 * Controls for the legacy `section` and `column` element types.
 *
 * NOT schema-derived, and the only table here that cannot be: Elementor 4.x
 * reports `section` and `column` as `missing` from `elementor-get-schema`
 * (live-verified — see `SCHEMA_UNAVAILABLE_EL_TYPES`). They still render, and
 * the V3 emitter still wraps every section in one, so the mapping needs SOME
 * answer for them.
 *
 * The entries are therefore restricted to exactly the control ids the
 * production V3 cloner (`site-clone-to-v3`) has deployed and rendered against a
 * live Elementor, and no more. This is deliberately narrower than what a
 * section probably accepts: an unverifiable control id added here would be
 * indistinguishable from a guess, and the gate cannot catch it because it
 * reports every section key as `schema-unavailable` rather than validating it.
 *
 * Note the naming family: a section uses the BARE control ids (`padding`,
 * `background_color`), like `__container__` and unlike every widget.
 */
export const V3_LEGACY_ELEMENT_CONTROLS: Readonly<Record<string, WidgetControlMap>> = {
  section: {
    padding: { t: 'dimensions', r: 1 },
    margin: { t: 'dimensions', r: 1 },
    background_color: { t: 'color' },
    background_background: { t: 'choose' },
    min_height: { t: 'slider', r: 1 },
    // Elementor 4.x omits legacy sections from elementor-get-schema, but these
    // two bare ids are present in the committed control snapshot and were
    // live-verified on Elementor 4.2.3. They preserve an absolutely-positioned
    // Framer header wrapper; without them the adopted header becomes normal flow
    // at the page bottom.
    position: { t: 'select', opts: ['', 'absolute', 'fixed'] },
    z_index: { t: 'number', r: 1 },
  },
  column: {
    padding: { t: 'dimensions', r: 1 },
    margin: { t: 'dimensions', r: 1 },
    background_color: { t: 'color' },
    background_background: { t: 'choose' },
  },
};

/**
 * The control map to resolve CSS against for one schema key, offline.
 *
 * Returns `undefined` for a key with no table entry, which the caller reports as
 * an unmapped element rather than guessing a naming family.
 */
export function offlineControlsFor(schemaKey: string): WidgetControlMap | undefined {
  return V3_CONTROL_CAPABILITIES[schemaKey] ?? V3_LEGACY_ELEMENT_CONTROLS[schemaKey];
}
