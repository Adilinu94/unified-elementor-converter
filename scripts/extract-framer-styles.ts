#!/usr/bin/env node
/**
 * extract-framer-styles.ts  —  Phase 2: Framer CSS Style Extraction
 *
 * Extrahiert CSS-Properties aus dem Framer HTML-Export (<style> Blöcke + Inline-Styles)
 * und strukturiert sie als JSON für V4-Variable/Class-Erstellung.
 *
 * Usage:
 *   node --import tsx scripts/extract-framer-styles.ts \
 *     --html FramerExport/framer-passionate-papaya-042575/index.html \
 *     --output FramerExport/tokens/extracted-styles.json
 */

import fs   from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface FontVariant {
  style: string;
  weight: string;
  url?: string;
  format?: string;
}

interface FontFamilyEntry {
  family: string;
  variants: FontVariant[];
  source: string;
  usage_hint: string | null;
}

interface CssDeclaration {
  selector: string;
  property: string;
  value: string;
  breakpoint: string | null;
}

interface CssVariableEntry {
  name: string;
  values: string[];
  occurrences: number;
}

interface ColorEntry {
  hex: string;
  raw: string;
  occurrences: number;
  properties: string[];
}

interface SemiTransparentEntry {
  rgba: string;
  hex_approx: string | null;
  opacity: number;
  occurrences: number;
}

interface ColorResult {
  unique: ColorEntry[];
  semi_transparent: SemiTransparentEntry[];
}

interface TypoEntry {
  value: string;
  occurrences: number;
  context: string | null;
}

interface TypographyResult {
  font_families: TypoEntry[];
  font_sizes: TypoEntry[];
  line_heights: TypoEntry[];
  letter_spacings: TypoEntry[];
  font_weights: TypoEntry[];
}

interface SpacingEntry {
  value: string;
  occurrences: number;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

interface SpacingResult {
  paddings: SpacingEntry[];
  margins: SpacingEntry[];
  gaps: SpacingEntry[];
  border_radii: SpacingEntry[];
  max_widths: SpacingEntry[];
}

interface LayoutEntry {
  value: string;
  occurrences: number;
}

interface LayoutResult {
  displays: LayoutEntry[];
  flex_directions: LayoutEntry[];
  justify_content: LayoutEntry[];
  align_items: LayoutEntry[];
}

interface ExtractionResult {
  source: string;
  extracted_at: string;
  fonts: FontFamilyEntry[];
  colors: ColorResult;
  typography: TypographyResult;
  spacing: SpacingResult;
  layout: LayoutResult;
  css_variables: CssVariableEntry[];
  summary: {
    total_rules: number;
    unique_colors: number;
    semi_transparent: number;
    unique_font_families: number;
    unique_font_sizes: number;
    unique_spacing_values: number;
    css_variables: number;
  };
}

// ─────────────────────────────────────────────
// CLI ARGS
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    html:           { type: 'string' },
    css:            { type: 'string' },
    'element-tree': { type: 'string' },
    output:         { type: 'string' },
    format:         { type: 'string', default: 'json' },
    verbose:        { type: 'boolean', default: false },
  },
  strict: false,
});

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node --import tsx scripts/extract-framer-styles.ts --html <file> [--output <file>]');
  process.exit(0);
}

const log = (...msg: string[]) => { if (args.verbose) process.stderr.write('[verbose] ' + msg.join(' ') + '\n'); };

if (!args.html && !args.css) {
  process.stderr.write('Error: --html or --css required\n');
  process.exit(2);
}

// ─────────────────────────────────────────────
// HEX NORMALIZATION
// ─────────────────────────────────────────────

function normalizeHex(val: string): string | null {
  if (!val) return null;
  val = val.trim().toLowerCase();
  if (val.startsWith('#')) val = val.slice(1);
  if (val.length === 3) val = val[0] + val[0] + val[1] + val[1] + val[2] + val[2];
  if (/^[0-9a-f]{6}$/.test(val)) return '#' + val;
  const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  return null;
}

function parseRgba(val: string): { hex_approx: string | null; opacity: number } | null {
  const m = val.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i);
  if (m) return { hex_approx: normalizeHex(val), opacity: parseFloat(m[4]) };
  return null;
}

// ─────────────────────────────────────────────
// CSS EXTRACTION FROM HTML
// ─────────────────────────────────────────────

function extractCssFromHtml(html: string): string {
  const blocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html)) !== null) {
    blocks.push(m[1]);
  }
  return blocks.join('\n');
}

// ─────────────────────────────────────────────
// PARSE @font-face
// ─────────────────────────────────────────────

function parseFontFaces(css: string): FontFamilyEntry[] {
  const familyMap = new Map<string, FontFamilyEntry>();
  const blockRe = /@font-face\s*\{([^}]+)\}/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css)) !== null) {
    const inner = block[1];
    const familyM = inner.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/i);
    const weightM = inner.match(/font-weight\s*:\s*([^;]+)/i);
    const styleM  = inner.match(/font-style\s*:\s*([^;]+)/i);
    const srcM    = inner.match(/src\s*:[^;]*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
    const fmtM    = inner.match(/format\(['"]?([^'"]+)['"]?\)/i);

    if (!familyM) continue;
    const family = familyM[1].trim();
    const weight = weightM ? weightM[1].trim() : '400';
    const style  = styleM  ? styleM[1].trim()  : 'normal';
    const url    = srcM    ? srcM[1].trim()    : null;
    const format = fmtM    ? fmtM[1].trim()    : null;

    let source = 'custom-upload';
    if (url && url.includes('fonts.gstatic.com'))  source = 'google-fonts';
    if (url && url.includes('fonts.googleapis.com')) source = 'google-fonts';
    if (url && url.includes('framerusercontent.com')) source = 'framer-cdn';

    const variant: FontVariant = { style, weight };
    if (url) variant.url = url;
    if (format) variant.format = format;

    if (!familyMap.has(family)) {
      familyMap.set(family, { family, variants: [], source, usage_hint: null });
    }
    const entry = familyMap.get(family)!;
    entry.variants.push(variant);
    if (source === 'framer-cdn') entry.source = source;
  }
  return [...familyMap.values()];
}

// ─────────────────────────────────────────────
// INLINE STYLE EXTRACTION
// ─────────────────────────────────────────────

function extractInlineStyles(html: string): CssDeclaration[] {
  const decls: CssDeclaration[] = [];
  const inlineRe = /style=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(html)) !== null) {
    const style = m[1];
    const propRe = /([\w-]+)\s*:\s*([^;!\n]+)/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(style)) !== null) {
      decls.push({
        selector: '[inline]',
        property: pm[1].trim(),
        value:    pm[2].trim(),
        breakpoint: null,
      });
    }
  }
  return decls;
}

// ─────────────────────────────────────────────
// CSS VARIABLE EXTRACTION
// ─────────────────────────────────────────────

function extractCssVariables(decls: CssDeclaration[]): CssVariableEntry[] {
  const vars = new Map<string, { values: Set<string>; occurrences: number }>();

  for (const { property, value } of decls) {
    if (!property.startsWith('--')) continue;
    const val = value.trim();
    if (vars.has(property)) {
      const e = vars.get(property)!;
      e.values.add(val);
      e.occurrences++;
    } else {
      vars.set(property, { values: new Set([val]), occurrences: 1 });
    }
  }

  const result: CssVariableEntry[] = [];
  for (const [name, data] of vars) {
    if (name.startsWith('--framer-') && !name.startsWith('--framer-text-color')) continue;
    result.push({
      name,
      values: [...data.values],
      occurrences: data.occurrences,
    });
  }

  return result.sort((a, b) => b.occurrences - a.occurrences);
}

// ─────────────────────────────────────────────
// COLLECT ALL CSS RULE DECLARATIONS
// ─────────────────────────────────────────────

function parseRuleDeclarations(css: string): CssDeclaration[] {
  const decls: CssDeclaration[] = [];

  const noFontFace = css.replace(/@font-face\s*\{[^}]+\}/gi, '');

  const processBlock = (block: string, breakpoint: string | null) => {
    const ruleRe = /([^{}]+)\{([^}]+)\}/g;
    let rm: RegExpExecArray | null;
    while ((rm = ruleRe.exec(block)) !== null) {
      const selector = rm[1].trim();
      const body = rm[2];
      const propRe = /([\w-]+)\s*:\s*([^;!\n]+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = propRe.exec(body)) !== null) {
        decls.push({ selector, property: pm[1].trim(), value: pm[2].trim(), breakpoint });
      }
    }
  };

  const mediaRe2 = /@media[^{]*(?:max-width|min-width)\s*:\s*(\d+)px[^{]*\{([\s\S]*?)\}(?=\s*[\r\n]*(?:@|\.|#|[a-zA-Z*]|$))/g;
  let mediaMatch: RegExpExecArray | null;
  while ((mediaMatch = mediaRe2.exec(noFontFace)) !== null) {
    const bpVal = parseInt(mediaMatch[1]);
    const bp = bpVal <= 420 ? 'mobile' : bpVal <= 900 ? 'tablet' : 'desktop';
    processBlock(mediaMatch[2], bp);
  }

  const noMedia = noFontFace.replace(/@media[^{]*\{[\s\S]*?\}(?=\s*[\r\n]*(?:@|\.|#|[a-zA-Z*]|$))/g, '');
  processBlock(noMedia, null);

  return decls;
}

// ─────────────────────────────────────────────
// COLOR PROPERTIES
// ─────────────────────────────────────────────

const COLOR_PROPS = new Set([
  'color', 'background-color', 'background', 'border-color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'fill', 'stroke',
]);

function extractVarFallback(val: string): string | null {
  const m = val.match(/var\([^,]+,\s*([^)]+)\)/);
  if (m) return m[1].trim();
  return null;
}

function extractColors(decls: CssDeclaration[]): ColorResult {
  const colorMap = new Map<string, ColorEntry>();
  const semiTransparent: SemiTransparentEntry[] = [];

  for (const { property, value } of decls) {
    if (!COLOR_PROPS.has(property) && !property.startsWith('--framer-text-color') && !property.startsWith('--extracted-')) continue;

    let val = value.trim();

    if (val.startsWith('var(')) {
      const fallback = extractVarFallback(val);
      if (fallback) {
        val = fallback;
      } else {
        continue;
      }
    }

    if (/rgba\s*\(/.test(val)) {
      const parsed = parseRgba(val);
      if (parsed) {
        const key = val.replace(/\s+/g, '');
        const existing = semiTransparent.find(s => s.rgba.replace(/\s+/g, '') === key);
        if (existing) {
          existing.occurrences++;
        } else {
          semiTransparent.push({ rgba: val, hex_approx: parsed.hex_approx, opacity: parsed.opacity, occurrences: 1 });
        }
      }
      continue;
    }

    const hex = normalizeHex(val);
    if (!hex) continue;

    const propName = property.replace('background-color', 'background-color')
                             .replace('background', 'background-color');

    if (colorMap.has(hex)) {
      const e = colorMap.get(hex)!;
      e.occurrences++;
      if (!e.properties.includes(propName)) e.properties.push(propName);
    } else {
      colorMap.set(hex, { hex, raw: val, occurrences: 1, properties: [propName] });
    }
  }

  const unique = [...colorMap.values()].sort((a, b) => b.occurrences - a.occurrences);
  return { unique, semi_transparent: semiTransparent };
}

// ─────────────────────────────────────────────
// TYPOGRAPHY
// ─────────────────────────────────────────────

function extractTypography(decls: CssDeclaration[]): TypographyResult {
  const fontSizes     = new Map<string, TypoEntry>();
  const lineHeights   = new Map<string, TypoEntry>();
  const letterSpacings = new Map<string, TypoEntry>();
  const fontWeights   = new Map<string, TypoEntry>();
  const fontFamilies  = new Map<string, TypoEntry>();

  const inc = (map: Map<string, TypoEntry>, key: string) => {
    if (map.has(key)) map.get(key)!.occurrences++;
    else map.set(key, { value: key, occurrences: 1, context: null });
  };

  for (const { property, value } of decls) {
    let v = value.trim();

    if (v.startsWith('var(')) {
      const fallback = extractVarFallback(v);
      if (fallback) v = fallback;
      else continue;
    }

    switch (property) {
      case 'font-size':     inc(fontSizes,      v);   break;
      case 'line-height':   inc(lineHeights,    v);   break;
      case 'letter-spacing':inc(letterSpacings, v);   break;
      case 'font-weight':   inc(fontWeights,    v);   break;
      case 'font-family': {
        const family = v.split(',')[0].replace(/['"]/g, '').trim();
        inc(fontFamilies, family);
        break;
      }
    }
  }

  const sizeList = [...fontSizes.values()].sort((a, b) => {
    const pa = parseFloat(a.value) || 0;
    const pb = parseFloat(b.value) || 0;
    return pb - pa;
  });
  const contexts = ['H1', 'H2', 'H3', 'H4', 'H5', 'Body', 'Small', 'XSmall'];
  sizeList.forEach((s, i) => { s.context = contexts[i] || null; });

  return {
    font_families:  [...fontFamilies.values()],
    font_sizes:     sizeList,
    line_heights:   [...lineHeights.values()].sort((a, b) => b.occurrences - a.occurrences),
    letter_spacings:[...letterSpacings.values()],
    font_weights:   [...fontWeights.values()].sort((a, b) => b.occurrences - a.occurrences),
  };
}

// ─────────────────────────────────────────────
// SPACING
// ─────────────────────────────────────────────

function expandShorthand4(val: string): { top?: string; right?: string; bottom?: string; left?: string } {
  const parts = val.trim().split(/\s+/);
  switch (parts.length) {
    case 1: return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
    case 2: return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
    case 3: return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
    case 4: return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
    default:return {};
  }
}

function extractSpacing(decls: CssDeclaration[]): SpacingResult {
  const paddings     = new Map<string, SpacingEntry>();
  const margins      = new Map<string, SpacingEntry>();
  const gaps         = new Map<string, SpacingEntry>();
  const borderRadii  = new Map<string, SpacingEntry>();
  const maxWidths    = new Map<string, SpacingEntry>();

  const inc = (map: Map<string, SpacingEntry>, val: string, extra: Record<string, string | undefined> = {}) => {
    if (map.has(val)) map.get(val)!.occurrences++;
    else map.set(val, { value: val, occurrences: 1, ...extra });
  };

  for (const { property, value } of decls) {
    let v = value.trim();

    if (v.startsWith('var(')) {
      const fallback = extractVarFallback(v);
      if (fallback) v = fallback;
      else continue;
    }

    switch (property) {
      case 'padding':
        inc(paddings, v, expandShorthand4(v));
        break;
      case 'margin':
        inc(margins, v, expandShorthand4(v));
        break;
      case 'gap': case 'row-gap': case 'column-gap':
        inc(gaps, v);
        break;
      case 'border-radius':
        inc(borderRadii, v);
        break;
      case 'max-width':
        inc(maxWidths, v);
        break;
    }
  }

  const sort = (map: Map<string, SpacingEntry>) => [...map.values()].sort((a, b) => b.occurrences - a.occurrences);
  return {
    paddings:     sort(paddings),
    margins:      sort(margins),
    gaps:         sort(gaps),
    border_radii: sort(borderRadii),
    max_widths:   sort(maxWidths),
  };
}

// ─────────────────────────────────────────────
// LAYOUT
// ─────────────────────────────────────────────

function extractLayout(decls: CssDeclaration[]): LayoutResult {
  const flexDirs       = new Map<string, LayoutEntry>();
  const justifyContent = new Map<string, LayoutEntry>();
  const alignItems     = new Map<string, LayoutEntry>();
  const displays       = new Map<string, LayoutEntry>();

  const inc = (map: Map<string, LayoutEntry>, val: string) => {
    if (map.has(val)) map.get(val)!.occurrences++;
    else map.set(val, { value: val, occurrences: 1 });
  };

  for (const { property, value } of decls) {
    let v = value.trim();

    if (v.startsWith('var(')) {
      const fallback = extractVarFallback(v);
      if (fallback) v = fallback;
      else continue;
    }
    switch (property) {
      case 'flex-direction':   inc(flexDirs,       v); break;
      case 'justify-content':  inc(justifyContent, v); break;
      case 'align-items':      inc(alignItems,     v); break;
      case 'display':          inc(displays,       v); break;
    }
  }

  const sort = (map: Map<string, LayoutEntry>) =>
    [...map.values()].sort((a, b) => b.occurrences - a.occurrences);

  return {
    displays:        sort(displays),
    flex_directions: sort(flexDirs),
    justify_content: sort(justifyContent),
    align_items:     sort(alignItems),
  };
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

let cssContent = '';
let sourcePath = '';
let htmlContent = '';

const htmlPath = args.html as string | undefined;
const cssPath = args.css as string | undefined;

if (htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    process.stderr.write(`Error: HTML file not found: ${htmlPath}\n`);
    process.exit(2);
  }
  log('Reading HTML:', htmlPath);
  htmlContent = fs.readFileSync(htmlPath, 'utf8');
  cssContent = extractCssFromHtml(htmlContent);
  sourcePath = htmlPath;
  log(`  Extracted ${cssContent.length} chars of CSS from style blocks`);
} else if (cssPath) {
  if (!fs.existsSync(cssPath)) {
    process.stderr.write(`Error: CSS file not found: ${cssPath}\n`);
    process.exit(2);
  }
  log('Reading CSS file:', cssPath);
  cssContent = fs.readFileSync(cssPath, 'utf8');
  sourcePath = cssPath;
}

const fonts = parseFontFaces(cssContent);
log(`  Found ${fonts.length} font families`);

let decls = parseRuleDeclarations(cssContent);

if (htmlContent) {
  const inlineDecls = extractInlineStyles(htmlContent);
  log(`  Extracted ${inlineDecls.length} inline style declarations`);
  decls = decls.concat(inlineDecls);
}

log(`  Parsed ${decls.length} CSS declarations total`);

const colors     = extractColors(decls);
const typography = extractTypography(decls);
const spacing    = extractSpacing(decls);
const layout     = extractLayout(decls);
const cssVars    = extractCssVariables(decls);
log(`  Found ${cssVars.length} CSS variables`);

if (colors.unique.length === 0) {
  process.stderr.write('⚠ Warning: No colors found. CSS may be empty or use only CSS variables.\n');
}
if (fonts.length === 0) {
  process.stderr.write('⚠ Warning: No @font-face declarations found. Fonts may be in a separate file.\n');
}

const totalRules = new Set(decls.map(d => d.selector)).size;
const result: ExtractionResult = {
  source:       sourcePath,
  extracted_at: new Date().toISOString(),
  fonts,
  colors,
  typography,
  spacing,
  layout,
  css_variables: cssVars,
  summary: {
    total_rules:          totalRules,
    unique_colors:        colors.unique.length,
    semi_transparent:     colors.semi_transparent.length,
    unique_font_families: fonts.length,
    unique_font_sizes:    typography.font_sizes.length,
    unique_spacing_values:
      spacing.paddings.length + spacing.gaps.length + spacing.border_radii.length,
    css_variables:        cssVars.length,
  },
};

const output = JSON.stringify(result, null, 2);

const outputPath = args.output as string | undefined;
if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf8');
  process.stderr.write(`Saved to ${outputPath}\n`);
} else {
  process.stdout.write(output + '\n');
}

const hasErrors   = colors.unique.length === 0;
const hasWarnings = fonts.length === 0;

process.stderr.write([
  `✓ ${fonts.length} font families`,
  `✓ ${colors.unique.length} unique colors`,
  `✓ ${typography.font_sizes.length} font sizes`,
  `✓ ${spacing.paddings.length + spacing.gaps.length + spacing.border_radii.length} spacing values`,
].join(', ') + '\n');

process.exit(hasErrors ? 2 : hasWarnings ? 1 : 0);
