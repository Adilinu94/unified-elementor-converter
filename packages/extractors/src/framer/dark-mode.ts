/**
 * Framer Dark-Mode Extraction (Phase 51, GAP-Q).
 * Extracts `@media (prefers-color-scheme: dark)` CSS blocks from Framer HTML/CSS
 * and produces a Dark-Mode variable set for V4 Global Variables, optionally
 * matched against a light-mode token set.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/extract-framer-dark-mode.ts.
 */
import { normalizeHex, rgbToHexNorm } from '../design-tokens.js';

export interface CssDeclaration {
  property: string;
  value: string;
}

export interface DarkBlock {
  selector: string;
  declarations: CssDeclaration[];
}

export interface ColorOverride {
  selector: string;
  property: string;
  value: string;
  hex: string | null;
}

export interface LightColorEntry {
  hex?: string;
  raw?: string;
  gv_id?: string;
}

export interface LightTokens {
  colors?: {
    unique?: LightColorEntry[];
  };
}

export interface DarkVariable {
  selector: string;
  property: string;
  dark_value: string;
  dark_hex: string | null;
  light_value: string | null;
  light_hex: string | null;
  gv_id: string | null;
  token_name: string;
}

export interface DarkModeVariableSet {
  mode: 'dark';
  variables: Array<{
    token_name: string;
    selector: string;
    property: string;
    dark_value: string;
    dark_hex: string | null;
    light_mapping: {
      light_value: string | null;
      light_hex: string | null;
      gv_id: string | null;
    };
  }>;
  summary: {
    total_variables: number;
    unique_selectors: number;
    unique_properties: number;
    matched_with_light_tokens: number;
  };
}

const COLOR_PROPS = new Set([
  'color', 'background-color', 'background',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color',
  'fill', 'stroke', 'outline-color', 'text-decoration-color',
]);

/** Extract the rule bodies of every `@media (prefers-color-scheme: dark)` block. */
export function extractDarkModeBlocks(css: string): DarkBlock[] {
  const darkBlocks: DarkBlock[] = [];
  const startRe = /@media\s*\(prefers-color-scheme\s*:\s*dark\)\s*\{/gi;
  let startMatch: RegExpExecArray | null;

  while ((startMatch = startRe.exec(css)) !== null) {
    const openPos = startMatch.index + startMatch[0].length - 1;
    let depth = 1;
    let closePos = openPos + 1;

    while (closePos < css.length && depth > 0) {
      const ch = css[closePos];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0) closePos++;
    }
    if (depth !== 0) continue;

    const block = css.slice(openPos + 1, closePos);
    const ruleRe = /([^{}]+)\{([^}]+)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = ruleRe.exec(block)) !== null) {
      const selector = ruleMatch[1].trim();
      const body = ruleMatch[2];
      const declarations: CssDeclaration[] = [];
      const propRe = /([\w-]+)\s*:\s*([^;!\n]+)/g;
      let propMatch: RegExpExecArray | null;
      while ((propMatch = propRe.exec(body)) !== null) {
        declarations.push({ property: propMatch[1].trim(), value: propMatch[2].trim() });
      }
      if (declarations.length > 0) {
        darkBlocks.push({ selector, declarations });
      }
    }
  }
  return darkBlocks;
}

function rgbaToHex(value: string): string | null {
  const m = value.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? rgbToHexNorm(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)) : null;
}

/** Pull out color-related declarations from dark-mode blocks, resolving hex where possible. */
export function extractColorOverrides(darkBlocks: DarkBlock[]): ColorOverride[] {
  const overrides: ColorOverride[] = [];

  for (const block of darkBlocks) {
    for (const decl of block.declarations) {
      const prop = decl.property.replace(/^--/, '');
      if (!COLOR_PROPS.has(prop) && !decl.property.startsWith('--')) continue;

      let value = decl.value.trim();
      let hex: string | null = null;

      if (value.startsWith('#')) {
        hex = normalizeHex(value);
      } else if (value.startsWith('rgb')) {
        hex = rgbaToHex(value);
      } else if (value.startsWith('var(')) {
        const fb = value.match(/var\([^,]+,\s*([^)]+)\)/);
        if (fb) {
          value = fb[1].trim();
          hex = normalizeHex(value) || rgbaToHex(value);
        }
      }
      overrides.push({ selector: block.selector, property: decl.property, value, hex });
    }
  }
  return overrides;
}

function suggestDarkTokenName(property: string, selector: string): string {
  const isBg = property.includes('background');
  const isText = property === 'color';
  const base = isBg ? 'surface' : isText ? 'text' : 'color';
  const cleanSelector = selector
    .replace(/[.#[\]:>\s,]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const cleanProperty = property
    .replace(/^--/, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 20);
  return `dark-${base}-${cleanSelector}-${cleanProperty}`;
}

/** Match dark-mode color overrides against a light-mode token set (by hex value), when provided. */
export function matchLightTokens(overrides: ColorOverride[], lightTokens?: LightTokens): DarkVariable[] {
  const lightColors = lightTokens?.colors?.unique ?? [];
  const hexToLight = new Map<string, LightColorEntry>();
  for (const entry of lightColors) {
    if (entry.hex) hexToLight.set(entry.hex, entry);
  }

  return overrides.map((override) => {
    const lightMatch = override.hex ? hexToLight.get(override.hex) : undefined;
    return {
      selector: override.selector,
      property: override.property,
      dark_value: override.value,
      dark_hex: override.hex,
      light_value: lightMatch?.raw ?? null,
      light_hex: lightMatch?.hex ?? null,
      gv_id: lightMatch?.gv_id ?? null,
      token_name: suggestDarkTokenName(override.property, override.selector),
    };
  });
}

function buildDarkModeVariableSet(variables: DarkVariable[]): DarkModeVariableSet {
  return {
    mode: 'dark',
    variables: variables.map((v) => ({
      token_name: v.token_name,
      selector: v.selector,
      property: v.property,
      dark_value: v.dark_value,
      dark_hex: v.dark_hex,
      light_mapping: { light_value: v.light_value, light_hex: v.light_hex, gv_id: v.gv_id },
    })),
    summary: {
      total_variables: variables.length,
      unique_selectors: new Set(variables.map((v) => v.selector)).size,
      unique_properties: new Set(variables.map((v) => v.property)).size,
      matched_with_light_tokens: variables.filter((v) => v.gv_id).length,
    },
  };
}

/**
 * Extract a Dark-Mode variable set from Framer CSS (or HTML containing `<style>` blocks),
 * optionally matched against a light-mode token set.
 */
export function extractDarkModeVariables(css: string, lightTokens?: LightTokens): DarkModeVariableSet {
  const darkBlocks = extractDarkModeBlocks(css);
  const overrides = extractColorOverrides(darkBlocks);
  const variables = matchLightTokens(overrides, lightTokens);
  return buildDarkModeVariableSet(variables);
}
