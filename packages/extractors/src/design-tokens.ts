/**
 * Design Token Extractor.
 * Extracts color, font, and spacing tokens from CSS/HTML sources.
 * Produces a DesignTokenSet with semantic role classification.
 */

import type { DesignTokenSet, DesignToken, SemanticRole } from '@elconv/core';
import { EMPTY_DESIGN_TOKEN_SET } from '@elconv/core';

/** Color classification by luminance and saturation */
const ROLE_PATTERNS: Array<{ test: (hex: string) => boolean; role: SemanticRole }> = [
  { test: (h) => luminance(h) < 0.15, role: 'text' },
  { test: (h) => luminance(h) > 0.92, role: 'background' },
  { test: (h) => saturation(h) > 0.6 && luminance(h) > 0.35 && luminance(h) < 0.65, role: 'primary' },
  { test: (h) => saturation(h) > 0.4 && luminance(h) > 0.55, role: 'accent' },
  { test: (h) => luminance(h) > 0.75 && luminance(h) <= 0.92, role: 'surface' },
  { test: (h) => saturation(h) < 0.1 && luminance(h) > 0.3 && luminance(h) < 0.7, role: 'text-muted' },
];

/**
 * Extract design tokens from raw CSS text.
 * Identifies repeated colors, font families, and spacing values.
 */
export function extractDesignTokens(css: string): DesignTokenSet {
  const colors = extractColorTokens(css);
  const fonts = extractFontTokens(css);
  const sizes = extractSizeTokens(css);
  return { colors, fonts, sizes };
}

/**
 * Merge multiple token sets (e.g. from different pages).
 * Deduplicates by hex/family/px and sums occurrences.
 */
export function mergeTokenSets(...sets: DesignTokenSet[]): DesignTokenSet {
  const colorMap = new Map<string, DesignToken>();
  const fontMap = new Map<string, DesignToken>();
  const sizeMap = new Map<string, DesignToken>();

  for (const set of sets) {
    for (const t of set.colors) {
      const key = t.hex ?? t.id;
      const existing = colorMap.get(key);
      if (existing) existing.occurrences += t.occurrences;
      else colorMap.set(key, { ...t });
    }
    for (const t of set.fonts) {
      const key = t.family ?? t.id;
      const existing = fontMap.get(key);
      if (existing) existing.occurrences += t.occurrences;
      else fontMap.set(key, { ...t });
    }
    for (const t of set.sizes) {
      const key = `${t.px}`;
      const existing = sizeMap.get(key);
      if (existing) existing.occurrences += t.occurrences;
      else sizeMap.set(key, { ...t });
    }
  }

  return {
    colors: [...colorMap.values()].sort((a, b) => b.occurrences - a.occurrences),
    fonts: [...fontMap.values()].sort((a, b) => b.occurrences - a.occurrences),
    sizes: [...sizeMap.values()].sort((a, b) => b.occurrences - a.occurrences),
  };
}

/**
 * Assign semantic roles to color tokens based on frequency and luminance.
 * Top color → primary, second → secondary, etc.
 */
export function classifyTokenRoles(tokens: DesignTokenSet): DesignTokenSet {
  const colors = tokens.colors.map((t, idx) => {
    if (!t.hex) return t;
    const role = t.role ?? classifyColor(t.hex, idx);
    return { ...t, role };
  });
  return { ...tokens, colors };
}

/**
 * Map tokens to CSS custom properties for Elementor global styles.
 */
export function tokensToCssVars(tokens: DesignTokenSet): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const t of tokens.colors) {
    if (t.hex && t.role) {
      vars[`--elconv-color-${t.role}`] = t.hex;
    }
  }
  for (const t of tokens.fonts) {
    if (t.family) {
      vars[`--elconv-font-${t.id}`] = t.family;
    }
  }
  return vars;
}

// --- Internal ---

function extractColorTokens(css: string): DesignToken[] {
  const counts = new Map<string, number>();
  const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;
  let m: RegExpExecArray | null;

  while ((m = hexRegex.exec(css)) !== null) {
    const hex = normalizeHex(m[0].toLowerCase());
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  // Also match rgb/rgba
  const rgbRegex = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  while ((m = rgbRegex.exec(css)) !== null) {
    const hex = rgbToHexNorm(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  const tokens: DesignToken[] = [];
  for (const [hex, count] of counts) {
    if (count >= 2) {
      tokens.push({ id: `dt_${hex.slice(1)}`, hex, occurrences: count, gv_id: null });
    }
  }
  return tokens.sort((a, b) => b.occurrences - a.occurrences);
}

function extractFontTokens(css: string): DesignToken[] {
  const counts = new Map<string, number>();
  const fontRegex = /font-family\s*:\s*([^;}{]+)/g;
  let m: RegExpExecArray | null;

  while ((m = fontRegex.exec(css)) !== null) {
    const family = m[1].split(',')[0].trim().replace(/['"]/g, '');
    if (family && !family.startsWith('var(')) {
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
  }

  const tokens: DesignToken[] = [];
  for (const [family, count] of counts) {
    tokens.push({ id: `font_${slugify(family)}`, family, occurrences: count, gv_id: null });
  }
  return tokens.sort((a, b) => b.occurrences - a.occurrences);
}

function extractSizeTokens(css: string): DesignToken[] {
  const counts = new Map<number, number>();
  const sizeRegex = /(?:font-size|gap|padding|margin)\s*:\s*(\d+(?:\.\d+)?)px/g;
  let m: RegExpExecArray | null;

  while ((m = sizeRegex.exec(css)) !== null) {
    const px = parseFloat(m[1]);
    if (px > 0) counts.set(px, (counts.get(px) ?? 0) + 1);
  }

  const tokens: DesignToken[] = [];
  for (const [px, count] of counts) {
    if (count >= 2) {
      tokens.push({ id: `size_${px}`, px, occurrences: count, gv_id: null });
    }
  }
  return tokens.sort((a, b) => b.occurrences - a.occurrences);
}

function classifyColor(hex: string, idx: number): SemanticRole {
  for (const { test, role } of ROLE_PATTERNS) {
    if (test(hex)) return role;
  }
  // Fallback by frequency rank
  if (idx === 0) return 'primary';
  if (idx === 1) return 'secondary';
  return 'accent';
}

function normalizeHex(raw: string): string | null {
  const h = raw.replace('#', '');
  if (h.length === 3) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  if (h.length === 6) return `#${h}`;
  if (h.length === 8) return `#${h.slice(0, 6)}`; // strip alpha
  return null;
}

function rgbToHexNorm(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
