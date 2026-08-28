/**
 * Single source of truth for Elementor responsive-key conventions.
 *
 * Elementor expects responsive overrides as a SUFFIX on the control id:
 *   padding_tablet, typography_font_size_mobile, flex_gap_tablet
 *
 * A PREFIX (`tablet_padding`) is silently ignored by the renderer — the setting
 * is stored in `_elementor_data` but never emitted into CSS. Because a saved
 * tree with prefixed keys looks structurally valid, the mistake is invisible
 * without an explicit check. That is what `hasBreakpointPrefix` exists for.
 *
 * Historically three call sites re-implemented `key.endsWith('_tablet')`
 * independently (target-v3 guards, qa cross-validator, target-v3 builder).
 * All breakpoint reasoning must import from here instead.
 *
 * See docs/BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md §11 (work package P5).
 */

/** Responsive breakpoints Elementor addresses via key suffix. `desktop` is the unsuffixed base. */
export const RESPONSIVE_BREAKPOINTS = ['tablet', 'mobile'] as const;

export type ResponsiveBreakpointName = (typeof RESPONSIVE_BREAKPOINTS)[number];

/** All breakpoints including the unsuffixed desktop base. */
export const ALL_BREAKPOINTS = ['desktop', ...RESPONSIVE_BREAKPOINTS] as const;

export type BreakpointName = (typeof ALL_BREAKPOINTS)[number];

/** Matches the correct Elementor form: `<control>_tablet` / `<control>_mobile`. */
export const BREAKPOINT_SUFFIX_RE = /_(tablet|mobile)$/;

/**
 * Base controls that END in a breakpoint word without being a responsive
 * override. Elementor's visibility switchers are named `hide_<breakpoint>`, so
 * a naive suffix test counts them as tablet/mobile overrides and then demands
 * a matching mobile override that must not exist.
 *
 * Live-verified against Elementor 4.2.1 on 2026-08-24 via
 * `novamira/elementor-get-schema` for `__container__` and `heading`:
 * only `hide_desktop` / `hide_tablet` / `hide_mobile` are registered
 * (t: switcher, rv: hidden-*). Additional custom breakpoints would add
 * `hide_widescreen` etc. — those do not end in tablet/mobile and need no entry.
 */
export const NON_RESPONSIVE_BREAKPOINT_SUFFIXED_CONTROLS: ReadonlySet<string> = new Set([
  'hide_tablet',
  'hide_mobile',
]);

/**
 * Matches the incorrect form: `tablet_<control>` / `mobile_<control>`.
 * Anchored at the start so a legitimate control containing the word (e.g.
 * `hide_tablet`) is not misreported.
 */
export const BREAKPOINT_PREFIX_RE = /^(tablet|mobile)_/;

/**
 * True when `key` carries a valid Elementor responsive suffix.
 * Elementor's own `hide_tablet` / `hide_mobile` switchers are excluded — see
 * `NON_RESPONSIVE_BREAKPOINT_SUFFIXED_CONTROLS`.
 */
export function hasBreakpointSuffix(key: string): boolean {
  if (NON_RESPONSIVE_BREAKPOINT_SUFFIXED_CONTROLS.has(key)) return false;
  return BREAKPOINT_SUFFIX_RE.test(key);
}

/** True when `key` uses the broken prefix form that Elementor ignores. */
export function hasBreakpointPrefix(key: string): boolean {
  return BREAKPOINT_PREFIX_RE.test(key);
}

/** True when `key` targets the given breakpoint via the valid suffix form. */
export function isBreakpointKey(key: string, breakpoint: ResponsiveBreakpointName): boolean {
  if (NON_RESPONSIVE_BREAKPOINT_SUFFIXED_CONTROLS.has(key)) return false;
  return key.endsWith(`_${breakpoint}`);
}

/** Extracts the breakpoint a key targets; `'desktop'` when unsuffixed. */
export function breakpointOf(key: string): BreakpointName {
  if (NON_RESPONSIVE_BREAKPOINT_SUFFIXED_CONTROLS.has(key)) return 'desktop';
  const match = BREAKPOINT_SUFFIX_RE.exec(key);
  return match ? (match[1] as ResponsiveBreakpointName) : 'desktop';
}

/**
 * Builds the Elementor control id for a breakpoint.
 * `desktop` returns the base key unchanged — Elementor has no `_desktop` suffix.
 *
 * @throws when `key` already carries a breakpoint suffix or the broken prefix,
 *         which would otherwise produce `padding_tablet_mobile`.
 */
export function breakpointKey(key: string, breakpoint: BreakpointName): string {
  if (hasBreakpointSuffix(key)) {
    throw new Error(
      `breakpointKey: "${key}" already carries a breakpoint suffix — pass the base control id`,
    );
  }
  if (hasBreakpointPrefix(key)) {
    throw new Error(
      `breakpointKey: "${key}" uses the invalid breakpoint prefix form — pass the base control id`,
    );
  }
  return breakpoint === 'desktop' ? key : `${key}_${breakpoint}`;
}

/** Strips a breakpoint suffix, returning the base control id. */
export function baseControlId(key: string): string {
  if (NON_RESPONSIVE_BREAKPOINT_SUFFIXED_CONTROLS.has(key)) return key;
  return key.replace(BREAKPOINT_SUFFIX_RE, '');
}

/** Every key in `settings` that uses the broken prefix form. */
export function findPrefixedBreakpointKeys(settings: Record<string, unknown>): string[] {
  return Object.keys(settings).filter(hasBreakpointPrefix);
}

/** Every key in `settings` that uses the valid suffix form. */
export function findSuffixedBreakpointKeys(settings: Record<string, unknown>): string[] {
  return Object.keys(settings).filter(hasBreakpointSuffix);
}
