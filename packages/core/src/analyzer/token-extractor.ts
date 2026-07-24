/**
 * Token-Extractor (Phase 6 — V2-Pixel-Perfekt).
 *
 * Erweitert V1's `design-token-extractor.ts` um:
 *  - oklch-Support: jeder Color-Token wird mit oklch-Form UND hex-Form gespeichert
 *  - Shadow-Tokens (box-shadow-Parsing)
 *  - Radius-Tokens (border-radius-bucketing)
 *  - Type-Scale-Tokens (font-size-Clustering)
 *
 * Reines Pure-Function-Modul, kein Playwright/I/O.
 *
 * Plan-Referenz: UMBAUPLAN §10.2 (V3-Token-Categories).
 */

import { rgbToHex, rgbToOklch, formatOklchCss, hexToRgb } from './oklch-converter.js';
import type { StyleNode } from './color-extractor.js';
import { parsePx } from './spacing-extractor.js';

// `OklchColorToken` is canonically defined in @elconv/core contracts
// (tokens.contract.ts, identical shape). Imported + re-exported so the core
// barrel sees a single declaration and analyzer consumers are unaffected.
import type { OklchColorToken } from '../contracts/index.js';
export type { OklchColorToken };

export interface ShadowToken {
  raw: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  frequency: number;
}

export interface RadiusToken {
  value: number; // px
  frequency: number;
}

export interface TypeScaleToken {
  size: number; // px
  frequency: number;
  /** Most common line-height for elements with this font-size. */
  lineHeight: number | null;
}

export interface ExtractedTokens {
  colors: Record<string, OklchColorToken>;
  shadows: ShadowToken[];
  radii: RadiusToken[];
  typeScale: TypeScaleToken[];
  /** Detected Token-Source (Tailwind, Custom-Properties, Inline-Hex). */
  source: 'tailwind' | 'css-variables' | 'inline' | 'mixed';
}

export interface TokenExtractionOptions {
  /** Minimum frequency to keep a color (default 2). */
  minColorFrequency?: number;
  /** Minimum frequency to keep a shadow (default 1). */
  minShadowFrequency?: number;
  /** Distinct radius-bucket tolerance in px (default 2). */
  radiusBucketPx?: number;
  /** Distinct size-bucket tolerance in px (default 1). */
  sizeBucketPx?: number;
}

/** Detect primary Token-Source heuristic (Plan §10 — V3 prefers CSS-Variables). */
export function detectTokenSource(
  styles: StyleNode[],
  cssVars: Record<string, string>,
): 'tailwind' | 'css-variables' | 'inline' | 'mixed' {
  const hasTailwindClass = styles.some((n) => {
    const haystack = n.selector + ' ' + (n.styles['class'] ?? '');
    return /(?:^|[\s.])(?:bg-|text-|p-|m-|rounded-|shadow-|w-|h-|flex-|grid-)/.test(haystack);
  });
  const cssVarCount = Object.keys(cssVars).length;
  const hasInlineHex = styles.some((n) =>
    Object.values(n.styles).some((v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)),
  );

  if (hasTailwindClass && cssVarCount > 0) return 'mixed';
  if (hasTailwindClass) return 'tailwind';
  if (cssVarCount > 0 && hasInlineHex) return 'mixed';
  if (cssVarCount > 0) return 'css-variables';
  return 'inline';
}

/** Parse a single box-shadow value into components. Returns null if invalid. */
export function parseBoxShadow(value: string): Omit<ShadowToken, 'frequency'> | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'none') return null;
  // Match: offsetX offsetY blur spread? color
  const m = trimmed.match(
    /^(-?\d+(?:\.\d+)?(?:px|rem|em)?)\s+(-?\d+(?:\.\d+)?(?:px|rem|em)?)\s+(-?\d+(?:\.\d+)?(?:px|rem|em)?)(?:\s+(-?\d+(?:\.\d+)?(?:px|rem|em)?))?\s+(.+)$/,
  );
  if (!m) return null;
  return {
    raw: trimmed,
    offsetX: parsePx(m[1]),
    offsetY: parsePx(m[2]),
    blur: parsePx(m[3]),
    spread: parsePx(m[4] ?? '0'),
    color: m[5].trim(),
  };
}

/** Bucket a number into discrete groups (tolerance controls grouping). */
export function bucketize<T extends { value: number }>(
  items: T[],
  tolerance: number,
): Map<number, T & { frequency: number }> {
  const buckets = new Map<number, T & { frequency: number }>();
  for (const item of items) {
    let matched = false;
    for (const [key, bucket] of buckets) {
      if (Math.abs(key - item.value) <= tolerance) {
        bucket.frequency++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      buckets.set(item.value, { ...item, frequency: 1 });
    }
  }
  return buckets;
}

/**
 * Bucket items by a custom numeric key (no .value required).
 * Returns a list of grouped items with frequency.
 */
export function bucketizeBy<T>(
  items: T[],
  keyFn: (item: T) => number,
  tolerance: number,
  seedFn: (item: T) => Omit<T, never> = (i) => i,
): Array<T & { frequency: number }> {
  const buckets: Array<T & { frequency: number }> = [];
  for (const item of items) {
    const key = keyFn(item);
    const existing = buckets.find((b) => Math.abs(keyFn(b) - key) <= tolerance);
    if (existing) {
      existing.frequency++;
    } else {
      buckets.push({ ...seedFn(item), frequency: 1 } as T & { frequency: number });
    }
  }
  return buckets;
}

/** Extract oklch-aware Color-Tokens from styles + CSS-vars. */
export function extractOklchColorTokens(
  styles: StyleNode[],
  cssVars: Record<string, string>,
  options: { minFrequency?: number } = {},
): Record<string, OklchColorToken> {
  const minFreq = options.minFrequency ?? 2;
  const COLOR_PROPS = ['color', 'background-color', 'border-color', 'fill', 'stroke'];

  const freq = new Map<string, number>();
  for (const node of styles) {
    for (const prop of COLOR_PROPS) {
      const raw = node.styles[prop];
      if (!raw) continue;
      const hex = normalizeToHex(raw);
      if (!hex) continue;
      freq.set(hex, (freq.get(hex) ?? 0) + 1);
    }
  }

  const out: Record<string, OklchColorToken> = {};
  let index = 0;
  for (const [hex, count] of freq) {
    if (count < minFreq) continue;
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    const oklch = rgbToOklch(rgb);
    const matchedVar = Object.entries(cssVars).find(([, v]) => normalizeToHex(v) === hex)?.[0] ?? null;
    out[`color-${index++}`] = {
      hex,
      rgb,
      oklch,
      oklchCss: formatOklchCss(oklch),
      frequency: count,
      cssVar: matchedVar,
    };
  }
  return out;
}

/** Normalize a CSS color (hex / rgb / rgba / oklch) to hex. Used only for frequency-counting. */
function normalizeToHex(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      return (
        '#' +
        trimmed[1] +
        trimmed[1] +
        trimmed[2] +
        trimmed[2] +
        trimmed[3] +
        trimmed[3]
      ).toLowerCase();
    }
    return trimmed.slice(0, 7).toLowerCase();
  }
  const rgb = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (rgb) {
    const alpha = parseFloat(rgb[4] ?? '1');
    if (alpha < 0.1) return null;
    return rgbToHex({
      r: parseInt(rgb[1], 10),
      g: parseInt(rgb[2], 10),
      b: parseInt(rgb[3], 10),
    }).toLowerCase();
  }
  return null;
}

/** Extract Shadow-Tokens (top N by frequency). */
export function extractShadowTokens(
  styles: StyleNode[],
  options: { minFrequency?: number } = {},
): ShadowToken[] {
  const minFreq = options.minFrequency ?? 1;
  const freq = new Map<string, number>();
  for (const node of styles) {
    const raw = node.styles['box-shadow'];
    if (!raw || raw === 'none') continue;
    const parsed = parseBoxShadow(raw);
    if (!parsed) continue;
    freq.set(parsed.raw, (freq.get(parsed.raw) ?? 0) + 1);
  }
  const out: ShadowToken[] = [];
  for (const [raw, count] of freq) {
    if (count < minFreq) continue;
    const parsed = parseBoxShadow(raw);
    if (parsed) out.push({ ...parsed, frequency: count });
  }
  return out.sort((a, b) => b.frequency - a.frequency);
}

/** Extract Radius-Tokens (bucketed by tolerance, top N by frequency). */
export function extractRadiusTokens(
  styles: StyleNode[],
  options: { bucketPx?: number } = {},
): RadiusToken[] {
  const bucketPx = options.bucketPx ?? 2;
  const radii: number[] = [];
  for (const node of styles) {
    const raw = node.styles['border-radius'];
    if (!raw || raw === '0' || raw === '0px') continue;
    const n = parsePx(raw);
    if (n > 0) radii.push(n);
  }
  const buckets = bucketize(radii.map((v) => ({ value: v })), bucketPx);
  return [...buckets.values()].sort((a, b) => b.frequency - a.frequency);
}

/** Extract Type-Scale-Tokens (font-size cluster + matched line-height). */
export function extractTypeScaleTokens(
  styles: StyleNode[],
  options: { bucketPx?: number } = {},
): TypeScaleToken[] {
  const bucketPx = options.bucketPx ?? 1;
  const sizes: Array<{ size: number; lineHeight: number | null }> = [];
  for (const node of styles) {
    const size = parsePx(node.styles['font-size']);
    if (size <= 0) continue;
    const lhRaw = node.styles['line-height'];
    const lh = lhRaw ? parsePx(lhRaw) || null : null;
    sizes.push({ size, lineHeight: lh });
  }
  const buckets = bucketizeBy(
    sizes,
    (s) => s.size,
    bucketPx,
    (s) => ({ size: s.size, lineHeight: s.lineHeight }),
  );
  return buckets.sort((a, b) => b.frequency - a.frequency);
}

/** Master entry point: extract all token categories in one pass. */
export function extractTokens(
  styles: StyleNode[],
  cssVars: Record<string, string>,
  options: TokenExtractionOptions = {},
): ExtractedTokens {
  return {
    colors: extractOklchColorTokens(styles, cssVars, { minFrequency: options.minColorFrequency }),
    shadows: extractShadowTokens(styles, { minFrequency: options.minShadowFrequency }),
    radii: extractRadiusTokens(styles, { bucketPx: options.radiusBucketPx }),
    typeScale: extractTypeScaleTokens(styles, { bucketPx: options.sizeBucketPx }),
    source: detectTokenSource(styles, cssVars),
  };
}