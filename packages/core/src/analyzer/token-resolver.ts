/**
 * Token-Resolver (Phase 6 — V2-Pixel-Perfekt).
 *
 * Resolution-Pipeline für Token-Lookup zur Builder-Zeit:
 *
 *   resolveToken(name) ─→ 1. semantic override (user-supplied)
 *                        2. CSS-Variable (--brand-primary etc.)
 *                        3. Extracted Token (Phase 6 oklch-aware)
 *                        4. Hardcoded V3-Fallback (deprecated path)
 *
 * Plus: resolvedRgb(name) liefert den finalen RGB-Wert (hex),
 *       sourceOf(name) liefert die Provenance für QA-Reports.
 *
 * Plan-Referenz: UMBAUPLAN §10.4 (oklch-CSS-Fallback für V3-Settings).
 */

import type { ExtractedTokens, OklchColorToken } from './token-extractor.js';
import { hexToRgb, oklchToRgb, rgbToHex, type Rgb } from './oklch-converter.js';

export type TokenSource =
  | 'override'
  | 'css-variable'
  | 'extracted'
  | 'fallback'
  | 'unknown';

export interface ResolvedToken {
  name: string;
  hex: string;
  rgb: Rgb;
  oklchCss: string | null;
  source: TokenSource;
  /** Original CSS-var name if source is 'css-variable'. */
  cssVar: string | null;
}

export interface ResolverContext {
  extracted: ExtractedTokens;
  /** User-supplied semantic overrides (highest priority). */
  overrides?: Record<string, string>;
  /** CSS-variable map (--brand-primary → value). */
  cssVariables: Record<string, string>;
}

/** Build a stable lookup-name from a semantic role key. */
export function normalizeRoleName(role: string): string {
  return role.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
}

/** Pick the best-matching extracted color for a semantic role. */
export function findExtractedForRole(
  extracted: ExtractedTokens,
  role: string,
): OklchColorToken | null {
  const target = normalizeRoleName(role);

  // 1) Direct css-var match
  const direct = Object.values(extracted.colors).find(
    (c) => c.cssVar && normalizeRoleName(c.cssVar) === target,
  );
  if (direct) return direct;

  // 2) Heuristic role-name match on common tokens
  const roleHints: Record<string, string[]> = {
    primary: ['primary', 'brand', 'cta'],
    secondary: ['secondary'],
    background: ['background', 'bg'],
    surface: ['surface', 'card', 'panel'],
    text: ['text', 'foreground'],
    'text-muted': ['muted', 'subtle'],
    border: ['border', 'divider'],
    accent: ['accent'],
  };
  const hints = roleHints[target];
  if (!hints) return null;
  const hintMatch = Object.values(extracted.colors).find((c) =>
    c.cssVar && hints.some((h) => normalizeRoleName(c.cssVar!).includes(h)),
  );
  return hintMatch ?? null;
}

/** Resolve a token by role → full token info (hex, rgb, oklch, source). */
export function resolveToken(role: string, ctx: ResolverContext): ResolvedToken {
  const name = normalizeRoleName(role);
  const overrides = ctx.overrides ?? {};

  // 1) User override
  const overrideValue = overrides[name];
  if (overrideValue) {
    const rgb = hexToRgb(overrideValue);
    if (rgb) {
      return {
        name,
        hex: overrideValue.toLowerCase(),
        rgb,
        oklchCss: null,
        source: 'override',
        cssVar: null,
      };
    }
  }

  // 2) CSS-variable direct match
  for (const [varName, value] of Object.entries(ctx.cssVariables)) {
    if (normalizeRoleName(varName) === name || varName === `--${name}`) {
      const hex = normalizeHex(value);
      if (hex) {
        const rgb = hexToRgb(hex);
        if (rgb) {
          return {
            name,
            hex,
            rgb,
            oklchCss: null,
            source: 'css-variable',
            cssVar: varName,
          };
        }
      }
    }
  }

  // 3) Extracted-token match
  const extracted = findExtractedForRole(ctx.extracted, role);
  if (extracted) {
    return {
      name,
      hex: extracted.hex,
      rgb: extracted.rgb,
      oklchCss: extracted.oklchCss,
      source: 'extracted',
      cssVar: extracted.cssVar,
    };
  }

  // 4) Fallback: V3-safe defaults (gray-500 ish)
  const fallback = '#6b7280';
  const fallbackRgb = hexToRgb(fallback)!;
  return {
    name,
    hex: fallback,
    rgb: fallbackRgb,
    oklchCss: null,
    source: 'fallback',
    cssVar: null,
  };
}

/** Convenience: resolve and return only the hex value. */
export function resolvedHex(role: string, ctx: ResolverContext): string {
  return resolveToken(role, ctx).hex;
}

/** Convenience: resolve and return only the rgb tuple. */
export function resolvedRgb(role: string, ctx: ResolverContext): Rgb {
  return resolveToken(role, ctx).rgb;
}

/** Provenance: which source fed the resolved value. */
export function sourceOf(role: string, ctx: ResolverContext): TokenSource {
  return resolveToken(role, ctx).source;
}

/** Build the custom_css block (Plan §10.4) for V3 page_css injection. */
export function buildCustomCssForTokens(ctx: ResolverContext, roles: string[]): string {
  const lines: string[] = [':root {'];
  for (const role of roles) {
    const t = resolveToken(role, ctx);
    lines.push(`  --${t.name}: ${t.hex};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** Normalize a CSS color string to hex (delegate to oklch-converter's helpers if needed). */
function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(trimmed)) {
    if (trimmed.length === 4) {
      return '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
    }
    return trimmed.slice(0, 7);
  }
  const rgb = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (rgb) {
    return rgbToHex({
      r: parseInt(rgb[1], 10),
      g: parseInt(rgb[2], 10),
      b: parseInt(rgb[3], 10),
    }).toLowerCase();
  }
  return null;
}

/** Oklch-aware expansion: for V3-Settings where oklch is preferred. */
export function resolvedOklchCss(role: string, ctx: ResolverContext): string | null {
  return resolveToken(role, ctx).oklchCss;
}

/** Bulk-resolve for QA-Reports (returns map role → ResolvedToken). */
export function resolveAll(roles: string[], ctx: ResolverContext): Record<string, ResolvedToken> {
  const out: Record<string, ResolvedToken> = {};
  for (const role of roles) {
    out[role] = resolveToken(role, ctx);
  }
  return out;
}

// oklchToRgb re-export (consumers may want to inject oklch back via custom_css).
export { oklchToRgb };