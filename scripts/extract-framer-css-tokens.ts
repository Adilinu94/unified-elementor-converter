#!/usr/bin/env node
/**
 * extract-framer-css-tokens.ts — Phase 2: Dual-Source CSS Extraction
 *
 * Extrahiert CSS-Tokens (Variables, Fonts, Breakpoints) aus der
 * PUBLIZIERTEN Framer-Seite (live fetch) ODER aus FramerExport HTML.
 *
 * Output: token-mapping.json mit:
 *   - colors: UUID-Tokens → hex + style-path-Mapping (via Heuristik)
 *   - textStyles: Style-Pfade → font-family/size/weight/color
 *   - fonts: @font-face-Regeln mit Framer-CDN-URLs
 *   - breakpoints: Media-Query-Werte
 *   - unmapped: Nicht gemappte Token-UUIDs
 *
 * Usage:
 *   node --import tsx scripts/extract-framer-css-tokens.ts \
 *     --url https://hilarious-workshops-284047.framer.app/ \
 *     --output token-mapping.json
 *
 *   node --import tsx scripts/extract-framer-css-tokens.ts \
 *     --html FramerExport/index.html \
 *     --output token-mapping.json
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeHex } from './lib/framer-utils.js';
import type { DesignToken } from '../src/shared-schemas/design-tokens.js';

// ─── Typen ─────────────────────────────────────────────────────────────────────

interface CssVariable {
  name: string;
  value: string;
  alternatives: string[];
}

interface CssVariableEntry {
  name: string;
  value: string;
  hex: string | null;
}

interface FontEntry {
  family: string;
  weight: string;
  style: string;
  url: string | null;
  display: string;
  source: string;
}

interface FontSource {
  weight: string;
  style: string;
  url: string | null;
  display: string;
  source: string;
}

interface FontFamily {
  family: string;
  weights: string[];
  sources: FontSource[];
}

interface Breakpoint {
  label: string;
  width: string;
  raw: number;
}

interface UnmappedToken {
  token: string;
  value: string;
  hex: string;
  possible_paths?: string[];
}

interface StyleRefColor {
  expectedColor?: string;
}

interface StyleRefs {
  colors?: Record<string, StyleRefColor>;
}

interface TokenMappingOutput {
  meta: {
    generated_at: string;
    source: string | boolean | undefined;
    source_type: string;
  };
  colors: DesignToken[];
  // Not extracted by this script (no size-token parsing here yet) — kept
  // as an empty array so the file satisfies the shared DesignTokenSet contract.
  sizes: DesignToken[];
  textStyles: Record<string, { size: string; weight: string; lineHeight: string }>;
  fonts: FontFamily[];
  breakpoints: Breakpoint[];
  css_variables: {
    total: number;
    color_tokens: number;
    color_tokens_list: CssVariableEntry[];
  };
  unmapped_tokens: UnmappedToken[];
}

// ─── CLI-Args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    url:           { type: 'string' },
    html:          { type: 'string' },
    'style-refs':  { type: 'string' },   // Unframer style-refs JSON
    output:        { type: 'string' },
    verbose:       { type: 'boolean', default: false },
  },
  strict: false,
});

const log  = (...m: string[]) => {
  if (args.verbose) process.stderr.write('[css-tokens] ' + m.join(' ') + '\n');
};
const warn = (m: string) =>
  process.stderr.write(`[warn] ${m}\n`);

// ─────────────────────────────────────────────
// FETCH
// ─────────────────────────────────────────────

// Funktionen unten sind exportiert (Sprint 20 Konsolidierung), damit
// css-fallback-extractor.js sie wiederverwendet statt eigene, abweichende
// Regex-Implementierungen zu pflegen (insb. fetchPageHtml inkl. externer
// Stylesheet-Auflösung war zuvor in css-fallback-extractor.js dupliziert).
export async function fetchPageHtml(url: string): Promise<string> {
  log('Fetching:', url);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  let html = await res.text();

  // Fetch external stylesheets too (Framer often splits CSS across files)
  const linkRe = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const externalCss: string[] = [];
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) !== null) {
    const href = lm[1];
    // Convert relative URLs to absolute
    const cssUrl = href.startsWith('http') ? href : new URL(href, url).href;
    try {
      log('  Fetching external CSS:', cssUrl.slice(0, 80));
      const cssRes = await fetch(cssUrl, { signal: AbortSignal.timeout(15000) });
      if (cssRes.ok) {
        const cssText = await cssRes.text();
        externalCss.push(cssText);
        log(`    Got ${cssText.length} bytes`);
      }
    } catch (e) {
      warn(`External CSS fetch failed: ${cssUrl.slice(0,80)} — ${(e as Error).message}`);
    }
  }

  // Append external CSS as inline style blocks so extractors find them
  if (externalCss.length > 0) {
    html += '\n<style id="extracted-external">\n' + externalCss.join('\n') + '\n</style>';
    log(`Inlined ${externalCss.length} external stylesheets`);
  }

  return html;
}

// ─────────────────────────────────────────────
// EXTRACT STYLE BLOCKS
// ─────────────────────────────────────────────

export function extractStyleBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  return blocks;
}

// ─────────────────────────────────────────────
// EXTRACT CSS VARIABLES (from all style blocks)
// ─────────────────────────────────────────────

export function extractCssVariables(styleBlocks: string[]): CssVariable[] {
  const vars = new Map<string, CssVariable>(); // tokenName → { name, value, alternatives }
  const allCss = styleBlocks.join('\n');
  const re = /(--[\w-]+)\s*:\s*([^;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allCss)) !== null) {
    const name = m[1].trim();
    const value = m[2].trim();
    if (!vars.has(name)) vars.set(name, { name, value, alternatives: [] });
    else vars.get(name)!.alternatives.push(value);
  }
  return [...vars.values()];
}

// ─────────────────────────────────────────────
// EXTRACT @FONT-FACE
// ─────────────────────────────────────────────

function extractFontFaces(styleBlocks: string[]): FontEntry[] {
  const fonts: FontEntry[] = [];
  const allCss = styleBlocks.join('\n');
  const re = /@font-face\s*\{([^}]+)\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allCss)) !== null) {
    const inner = m[1];
    const familyM  = inner.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/i);
    const weightM  = inner.match(/font-weight\s*:\s*([^;]+)/i);
    const styleM   = inner.match(/font-style\s*:\s*([^;]+)/i);
    const srcM     = inner.match(/src\s*:[^;]*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
    const displayM = inner.match(/font-display\s*:\s*([^;]+)/i);

    if (!familyM) continue;
    const family = familyM[1].trim();
    const weight = weightM ? weightM[1].trim() : '400';
    const style  = styleM  ? styleM[1].trim()  : 'normal';
    const url    = srcM    ? srcM[1].trim()    : null;
    const display = displayM ? displayM[1].trim() : 'swap';

    // Detect source
    let source = 'custom-upload';
    if (url?.includes('fonts.gstatic.com') || url?.includes('fonts.googleapis.com')) source = 'google-fonts';
    if (url?.includes('framerusercontent.com')) source = 'framer-cdn';

    fonts.push({ family, weight, style, url, display, source });
  }
  return fonts;
}

// ─────────────────────────────────────────────
// EXTRACT BREAKPOINTS
// ─────────────────────────────────────────────

export function extractBreakpoints(styleBlocks: string[]): Breakpoint[] {
  const breakpoints: Breakpoint[] = [];
  const allCss = styleBlocks.join('\n');
  const re = /@media\s*\(max-width\s*:\s*(\d+)px\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allCss)) !== null) {
    const width = parseInt(m[1]);
    if (!breakpoints.find(b => b.raw === width)) {
      let label = 'custom';
      if (width >= 1000) label = 'desktop';
      else if (width >= 700) label = 'tablet';
      else label = 'mobile';
      breakpoints.push({ label, width: `${width}px`, raw: width });
    }
  }
  return breakpoints.sort((a, b) => b.raw - a.raw);
}

// ─────────────────────────────────────────────
// COLOR-BASED HEURISTIK: UUID-Token → Style-Ref
// ─────────────────────────────────────────────

/**
 * Versucht, UUID-Tokens mit Unframer-Style-Pfaden zu matchen.
 *
 * Heuristik 1: Farbwert-Vergleich
 *   Wenn ein Token den Hex-Wert #061d13 hat und ein Unframer-Style-Ref
 *   "/Theme/Very Dark Green" als erwarteten Farbwert hat → Match.
 *
 * Heuristik 2: Token-Label-Parsing
 *   Manche Tokens haben menschenlesbare Labels in ihren Namen.
 *   (Selten bei UUID-Tokens, aber Versuch wert)
 */
function mapTokensToStyleRefs(
  cssVars: CssVariable[],
  styleRefs: StyleRefs | null,
): { mapped: DesignToken[]; unmapped: UnmappedToken[] } {
  const mapped: DesignToken[] = [];
  const unmapped: UnmappedToken[] = [];

  // Step 1: Alle Farb-Tokens identifizieren
  const colorTokens = cssVars.filter(v => {
    const hex = normalizeHex(v.value);
    return hex !== null;
  });

  // Step 2: Wenn Style-Refs vorhanden, Farbwert-Matching versuchen
  if (styleRefs?.colors) {
    const refHexMap = new Map<string, string>(); // hex → stylePath
    for (const [stylePath, refData] of Object.entries(styleRefs.colors)) {
      if (refData.expectedColor) {
        const hex = normalizeHex(refData.expectedColor);
        if (hex) refHexMap.set(hex, stylePath);
      }
    }

    for (const token of colorTokens) {
      const hex = normalizeHex(token.value);
      if (!hex) continue;

      const stylePath = refHexMap.get(hex);
      if (stylePath) {
        mapped.push({
          id: stylePath,
          hex,
          occurrences: 0,
          gv_id: null,
          label: stylePath,
          css_var: token.name,
        });
      } else {
        unmapped.push({
          token: token.name,
          value: token.value,
          hex,
          possible_paths: [],
        });
      }
    }
  } else {
    // Ohne Style-Refs: alle als unmapped markieren
    for (const token of colorTokens) {
      const hex = normalizeHex(token.value);
      if (!hex) continue;
      unmapped.push({
        token: token.name,
        value: token.value,
        hex,
      });
    }
  }

  return { mapped, unmapped };
}

// ─────────────────────────────────────────────
// GROUP FONTS BY FAMILY
// ─────────────────────────────────────────────

function groupFontsByFamily(fontFaces: FontEntry[]): FontFamily[] {
  const families = new Map<string, FontFamily>();
  for (const font of fontFaces) {
    if (!families.has(font.family)) {
      families.set(font.family, {
        family: font.family,
        weights: [],
        sources: [],
      });
    }
    const f = families.get(font.family)!;
    if (!f.weights.includes(font.weight)) f.weights.push(font.weight);
    f.sources.push({
      weight: font.weight,
      style: font.style,
      url: font.url,
      display: font.display,
      source: font.source,
    });
  }
  return [...families.values()];
}

// ─────────────────────────────────────────────
// BUILD TEXT-STYLE FALLBACKS
// ─────────────────────────────────────────────

// Aus der RESEARCH: Die Unframer-Style-Referenzen wie "/Heading/Heading 1"
// muessen in Phase 2 aufgeloest werden. Hier legen wir Basis-Daten an,
// die in Phase 3 mit echten CSS-Werten gefuellt werden.

const TEXT_STYLE_DEFAULTS: Record<string, { size: string; weight: string; lineHeight: string }> = {
  '/Heading/Heading 1': { size: '68px', weight: '700', lineHeight: '1.1' },
  '/Heading/Heading 2': { size: '48px', weight: '600', lineHeight: '1.2' },
  '/Heading/Heading 3': { size: '32px', weight: '600', lineHeight: '1.3' },
  '/Heading/Heading 4': { size: '24px', weight: '600', lineHeight: '1.4' },
  '/Body/Body-20px-Medium': { size: '20px', weight: '500', lineHeight: '1.5' },
  '/Body/Body-16px-Medium': { size: '16px', weight: '500', lineHeight: '1.6' },
  '/Body/Body S': { size: '14px', weight: '400', lineHeight: '1.6' },
};

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  let htmlContent = '';

  if (args.url) {
    htmlContent = await fetchPageHtml(args.url as string);
    log(`Fetched ${htmlContent.length} bytes from ${args.url}`);
  } else if (args.html) {
    const htmlPath = args.html as string;
    if (!fs.existsSync(htmlPath)) {
      process.stderr.write(`Error: HTML not found: ${htmlPath}\n`);
      process.exit(2);
    }
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
    log(`Read ${htmlContent.length} bytes from ${htmlPath}`);
  } else {
    process.stderr.write('Error: --url or --html required\n');
    process.exit(2);
  }

  // ── Extract style blocks ──
  const styleBlocks = extractStyleBlocks(htmlContent);
  log(`Found ${styleBlocks.length} style blocks`);

  // ── Extract CSS variables ──
  const cssVars = extractCssVariables(styleBlocks);
  const colorVars = cssVars.filter(v => normalizeHex(v.value) !== null);
  log(`Found ${cssVars.length} CSS variables (${colorVars.length} color tokens)`);

  // ── Extract @font-face ──
  const fontFaces = extractFontFaces(styleBlocks);
  const fontFamilies = groupFontsByFamily(fontFaces);
  log(`Found ${fontFaces.length} @font-face entries (${fontFamilies.length} families)`);

  // ── Extract breakpoints ──
  const breakpoints = extractBreakpoints(styleBlocks);
  log(`Found ${breakpoints.length} breakpoints`);

  // ── Load style-refs if provided ──
  let styleRefs: StyleRefs | null = null;
  if (args['style-refs']) {
    const refsPath = args['style-refs'] as string;
    if (fs.existsSync(refsPath)) {
      styleRefs = JSON.parse(fs.readFileSync(refsPath, 'utf8'));
      log(`Loaded style-refs with ${Object.keys(styleRefs?.colors || {}).length} color paths`);
    }
  }

  // ── Token mapping ──
  const { mapped, unmapped } = mapTokensToStyleRefs(cssVars, styleRefs);
  log(`Mapped ${mapped.length} tokens, ${unmapped.length} unmapped`);

  // ── Build output ──
  const output: TokenMappingOutput = {
    meta: {
      generated_at: new Date().toISOString(),
      source: args.url || args.html,
      source_type: args.url ? 'live-fetch' : 'framer-export-html',
    },
    colors: mapped,
    sizes: [],
    textStyles: TEXT_STYLE_DEFAULTS,
    fonts: fontFamilies,
    breakpoints,
    css_variables: {
      total: cssVars.length,
      color_tokens: colorVars.length,
      color_tokens_list: colorVars.slice(0, 100).map(v => ({
        name: v.name,
        value: v.value,
        hex: normalizeHex(v.value),
      })),
    },
    unmapped_tokens: unmapped,
  };

  const outputJson = JSON.stringify(output, null, 2);

  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output as string)), { recursive: true });
    fs.writeFileSync(args.output as string, outputJson, 'utf8');
    process.stderr.write(`✓ token-mapping.json → ${args.output}\n`);
  } else {
    process.stdout.write(outputJson + '\n');
  }

  process.stderr.write([
    `✓ ${cssVars.length} CSS variables`,
    `✓ ${fontFamilies.length} font families`,
    `✓ ${breakpoints.length} breakpoints`,
    `✓ ${mapped.length} color mappings`,
    `⚠ ${unmapped.length} unmapped tokens`,
  ].join(', ') + '\n');

  // Let Node exit naturally — avoids Windows libuv UV_HANDLE_CLOSING race
  // that process.exit(0) triggers when fetch() handles are still closing.
  // Node exits with code 0 when the event loop drains, which is safe.
}

// Nur ausführen wenn direkt aufgerufen, nicht wenn als Modul importiert
// (Sprint 20: css-fallback-extractor.js importiert fetchPageHtml/
// extractStyleBlocks/extractCssVariables/extractBreakpoints von hier).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => {
    process.stderr.write(`FATAL: ${(e as Error).message}\n`);
    // Brief delay avoids UV_HANDLE_CLOSING race on Windows — same root cause
    // as the natural-exit approach in the success path: process.exit() while
    // libuv is tearing down fetch handles triggers the assertion.
    setTimeout(() => process.exit(2), 50);
  });
}
