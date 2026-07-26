/**
 * Framer CSS Token Extraction (Phase 51, Phase 2).
 * Extracts CSS tokens (variables, fonts, breakpoints) from Framer HTML
 * or published Framer page CSS.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/extract-framer-css-tokens.ts
 */

import { normalizeHex } from '../design-tokens.js';

// ============================================================================
// Types
// ============================================================================

export interface CssVariableEntry {
  name: string;
  value: string;
  hex: string | null;
}

export interface FontSource {
  weight: string;
  style: string;
  url: string | null;
  display: string;
  source: string;
}

export interface FontFamily {
  family: string;
  weights: string[];
  sources: FontSource[];
}

export interface Breakpoint {
  label: string;
  width: string;
  raw: number;
}

export interface TextStyle {
  size: string;
  weight: string;
  lineHeight: string;
  family?: string;
  color?: string;
}

export interface TokenMappingOutput {
  meta: {
    generated_at: string;
    source: string;
    source_type: string;
  };
  colors: CssVariableEntry[];
  fonts: FontFamily[];
  breakpoints: Breakpoint[];
  textStyles: Record<string, TextStyle>;
  unmapped: Array<{ token: string; value: string; hex: string }>;
}

// ============================================================================
// CSS Variable Extraction
// ============================================================================

/**
 * Extract CSS custom properties (variables) from CSS string.
 */
export function extractCssVariables(css: string): CssVariableEntry[] {
  const entries: CssVariableEntry[] = [];
  const varRe = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;

  while ((match = varRe.exec(css)) !== null) {
    const name = `--${match[1]}`;
    const value = match[2].trim();
    const hex = normalizeHex(value);
    entries.push({ name, value, hex });
  }

  return entries;
}

/**
 * Extract color variables (those with hex/rgb/hsl values).
 */
export function extractColorVariables(css: string): CssVariableEntry[] {
  return extractCssVariables(css).filter((v) => v.hex !== null);
}

// ============================================================================
// Font Extraction
// ============================================================================

/**
 * Extract @font-face rules from CSS.
 */
export function extractFontFaces(css: string): FontFamily[] {
  const families = new Map<string, FontFamily>();
  const fontFaceRe = /@font-face\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = fontFaceRe.exec(css)) !== null) {
    const block = match[1];

    const familyMatch = block.match(/font-family\s*:\s*["']?([^;"']+)["']?/);
    const weightMatch = block.match(/font-weight\s*:\s*([^;]+)/);
    const styleMatch = block.match(/font-style\s*:\s*([^;]+)/);
    const urlMatch = block.match(/url\(["']?([^"')]+)["']?\)/);
    const displayMatch = block.match(/font-display\s*:\s*([^;]+)/);

    if (!familyMatch) continue;

    const family = familyMatch[1].trim();
    const weight = weightMatch?.[1]?.trim() || '400';
    const style = styleMatch?.[1]?.trim() || 'normal';
    const url = urlMatch?.[1] || null;
    const display = displayMatch?.[1]?.trim() || 'swap';

    if (!families.has(family)) {
      families.set(family, { family, weights: [], sources: [] });
    }

    const fam = families.get(family)!;
    if (!fam.weights.includes(weight)) fam.weights.push(weight);
    fam.sources.push({ weight, style, url, display, source: 'css-font-face' });
  }

  return [...families.values()];
}

// ============================================================================
// Breakpoint Extraction
// ============================================================================

const BREAKPOINT_LABELS: Array<{ max: number; label: string }> = [
  { max: 480, label: 'mobile' },
  { max: 768, label: 'tablet' },
  { max: 1024, label: 'laptop' },
  { max: 1440, label: 'desktop' },
  { max: Infinity, label: 'wide' },
];

/**
 * Extract media query breakpoints from CSS.
 */
export function extractBreakpoints(css: string): Breakpoint[] {
  const breakpoints: Breakpoint[] = [];
  const seen = new Set<number>();
  const mediaRe = /@media[^{]*\(\s*(?:max|min)-width\s*:\s*(\d+)px\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = mediaRe.exec(css)) !== null) {
    const raw = parseInt(match[1], 10);
    if (seen.has(raw)) continue;
    seen.add(raw);

    const labelEntry = BREAKPOINT_LABELS.find((b) => raw <= b.max);
    breakpoints.push({
      label: labelEntry?.label || 'custom',
      width: `${raw}px`,
      raw,
    });
  }

  return breakpoints.sort((a, b) => a.raw - b.raw);
}

// ============================================================================
// Text Style Extraction
// ============================================================================

/**
 * Extract text styles from CSS rules targeting heading/paragraph selectors.
 */
export function extractTextStyles(css: string): Record<string, TextStyle> {
  const styles: Record<string, TextStyle> = {};
  const textSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', '.framer-text', '[data-framer-name]'];

  for (const selector of textSelectors) {
    const ruleRe = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]+)\\}`, 'g');
    let match: RegExpExecArray | null;

    while ((match = ruleRe.exec(css)) !== null) {
      const block = match[1];
      const sizeMatch = block.match(/font-size\s*:\s*([^;]+)/);
      const weightMatch = block.match(/font-weight\s*:\s*([^;]+)/);
      const lineHeightMatch = block.match(/line-height\s*:\s*([^;]+)/);
      const familyMatch = block.match(/font-family\s*:\s*([^;]+)/);
      const colorMatch = block.match(/(?<!-)color\s*:\s*([^;]+)/);

      if (sizeMatch || weightMatch) {
        styles[selector] = {
          size: sizeMatch?.[1]?.trim() || 'inherit',
          weight: weightMatch?.[1]?.trim() || '400',
          lineHeight: lineHeightMatch?.[1]?.trim() || 'normal',
          family: familyMatch?.[1]?.trim(),
          color: colorMatch?.[1]?.trim(),
        };
      }
    }
  }

  return styles;
}

// ============================================================================
// Main Extraction
// ============================================================================

/**
 * Extract all CSS tokens from HTML string.
 */
export function extractCssTokensFromHtml(html: string, source = 'html'): TokenMappingOutput {
  // Extract CSS from <style> blocks
  const cssBlocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html)) !== null) cssBlocks.push(m[1]);
  const css = cssBlocks.join('\n');

  const colors = extractColorVariables(css);
  const fonts = extractFontFaces(css);
  const breakpoints = extractBreakpoints(css);
  const textStyles = extractTextStyles(css);

  // Find unmapped color tokens (CSS vars that look like tokens but have no hex)
  const allVars = extractCssVariables(css);
  const unmapped = allVars
    .filter((v) => v.hex === null && /token|color|bg|text|accent/i.test(v.name))
    .map((v) => ({ token: v.name, value: v.value, hex: '' }));

  return {
    meta: {
      generated_at: new Date().toISOString(),
      source,
      source_type: 'html',
    },
    colors,
    fonts,
    breakpoints,
    textStyles,
    unmapped,
  };
}

/**
 * Extract CSS tokens from raw CSS string.
 */
export function extractCssTokensFromCss(css: string, source = 'css'): TokenMappingOutput {
  const colors = extractColorVariables(css);
  const fonts = extractFontFaces(css);
  const breakpoints = extractBreakpoints(css);
  const textStyles = extractTextStyles(css);

  const allVars = extractCssVariables(css);
  const unmapped = allVars
    .filter((v) => v.hex === null && /token|color|bg|text|accent/i.test(v.name))
    .map((v) => ({ token: v.name, value: v.value, hex: '' }));

  return {
    meta: {
      generated_at: new Date().toISOString(),
      source,
      source_type: 'css',
    },
    colors,
    fonts,
    breakpoints,
    textStyles,
    unmapped,
  };
}
