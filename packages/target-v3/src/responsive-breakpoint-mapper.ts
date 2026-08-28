/**
 * Responsive Breakpoint Mapper (#4)
 *
 * Framer has Desktop / Tablet / Phone variants in the page XML. Currently
 * the builder writes a hand-crafted `@media (max-width: 768px)` CSS block.
 * This mapper reads Framer's Tablet/Phone variant settings and emits
 * Elementor responsive settings (`typography_font_size_mobile`, `padding_mobile`,
 * `flex_direction_mobile`) so the Elementor editor shows the mobile view
 * correctly — no manual CSS needed for responsive overrides.
 *
 * Elementor addresses responsive overrides with a SUFFIX on the control id
 * (`padding_tablet`, `typography_font_size_mobile`). A prefix (`tablet_padding`)
 * is stored but never rendered. The suffix is built by `breakpointKey()` from
 * `@elconv/core` so this file cannot drift from the guards that check it.
 *
 * @example
 * import { applyResponsiveOverrides } from './responsive-breakpoint-mapper.js';
 * applyResponsiveOverrides(tree, { mobile: mobileVariants });
 */

import { breakpointKey } from '@elconv/core';
import type { V3Tree, V3Element, SettingsMap } from './v3-tree-types.js';

/** A Framer variant override for one element (keyed by element id or class). */
export interface FramerVariant {
  /** Element id from Framer XML, or css class selector. */
  selector: string;
  /** Settings that differ from desktop. */
  overrides: SettingsMap;
}

export interface ResponsiveOverrides {
  /** Tablet variant overrides (Elementor tablet breakpoint ~1024px). */
  tablet?: FramerVariant[];
  /** Phone/mobile variant overrides (Elementor mobile breakpoint ~767px). */
  mobile?: FramerVariant[];
}

export interface ResponsiveReport {
  applied: number;
  skipped: number;
  byBreakpoint: { tablet: number; mobile: number };
  /**
   * Override keys that were dropped because they already carried a breakpoint
   * marker (suffix or the invalid prefix form). Reported instead of silently
   * producing `padding_mobile_tablet`.
   */
  rejectedKeys: string[];
}

/**
 * Apply Framer Tablet/Phone variant overrides to the V3 tree as Elementor
 * responsive settings. For each variant, find the matching element (by id
 * or css_classes) and set the `_tablet` / `_mobile` suffixed settings.
 */
export function applyResponsiveOverrides(tree: V3Tree, variants: ResponsiveOverrides): ResponsiveReport {
  let applied = 0;
  let skipped = 0;
  const byBreakpoint = { tablet: 0, mobile: 0 };
  const rejectedKeys: string[] = [];

  for (const bp of ['tablet', 'mobile'] as const) {
    const list = variants[bp] ?? [];
    for (const v of list) {
      const targets = findElements(tree, v.selector);
      if (targets.length === 0) {
        skipped++;
        continue;
      }
      for (const el of targets) {
        el.settings = el.settings ?? {};
        for (const [key, value] of Object.entries(v.overrides)) {
          let respKey: string;
          try {
            respKey = breakpointKey(key, bp);
          } catch {
            // Already breakpoint-marked — never double-suffix.
            if (!rejectedKeys.includes(key)) rejectedKeys.push(key);
            continue;
          }
          el.settings[respKey] = value;
        }
        applied++;
        byBreakpoint[bp]++;
      }
    }
  }

  return { applied, skipped, byBreakpoint, rejectedKeys };
}

function findElements(tree: V3Tree, selector: string): V3Element[] {
  const out: V3Element[] = [];
  for (const el of walk(tree)) {
    // Match by element id
    if (el.id === selector) {
      out.push(el);
      continue;
    }
    // Match by css_classes (container only — widget css_classes don't render)
    if (el.elType === 'container' || el.elType === 'section') {
      const cls = el.settings?.css_classes;
      if (typeof cls === 'string' && cls.split(/\s+/).includes(selector)) {
        out.push(el);
      }
    }
  }
  return out;
}

function* walk(tree: V3Tree): Generator<V3Element> {
  for (const el of tree) yield* walkEl(el);
}

function* walkEl(el: V3Element): Generator<V3Element> {
  yield el;
  if (el.elements) for (const c of el.elements) yield* walkEl(c);
}

/**
 * Generate a fallback @media CSS block for overrides that don't have a native
 * Elementor responsive setting (e.g. custom flex child widths). Use this when
 * the Elementor responsive settings are insufficient.
 */
export function generateResponsiveCss(variants: ResponsiveOverrides, pageId?: number): string {
  const lines: string[] = [];
  const guard = pageId ? `body.page-id-${pageId} ` : '';

  for (const bp of ['tablet', 'mobile'] as const) {
    const list = variants[bp] ?? [];
    if (!list.length) continue;
    const maxWidth = bp === 'tablet' ? '1024px' : '767px';
    lines.push(`@media (max-width: ${maxWidth}) {`);
    for (const v of list) {
      for (const [key, value] of Object.entries(v.overrides)) {
        const css = settingToCss(key, value, v.selector);
        if (css) lines.push(`  ${guard}${css}`);
      }
    }
    lines.push('}');
  }
  return lines.join('\n');
}

function settingToCss(key: string, value: unknown, selector: string): string | null {
  // Common responsive overrides → CSS
  switch (key) {
    case 'typography_font_size': {
      const v = value as { unit?: string; size?: number };
      return `.${selector} h2, .${selector} h1, .${selector} p { font-size: ${v.size}${v.unit ?? 'px'} !important; }`;
    }
    case 'padding': {
      const v = value as { top?: number; right?: number; bottom?: number; left?: number; unit?: string };
      const u = v.unit ?? 'px';
      return `.${selector} { padding: ${v.top}${u} ${v.right}${u} ${v.bottom}${u} ${v.left}${u} !important; }`;
    }
    case 'flex_direction': {
      return `.${selector} { flex-direction: ${value} !important; }`;
    }
    case 'flex_gap': {
      const v = value as { unit?: string; size?: number };
      return `.${selector} { gap: ${v.size}${v.unit ?? 'px'} !important; }`;
    }
    default:
      return null;
  }
}
