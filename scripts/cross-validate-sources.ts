#!/usr/bin/env node
/**
 * cross-validate-sources.ts
 * Framer Dual-Source Cross-Validation Tool
 * Vergleicht MCP-extrahierte Tokens gegen lokalen Framer CSS-Export.
 *
 * Usage:
 *   node --import tsx scripts/cross-validate-sources.ts \
 *     --mcp-json FramerExport/tokens/mcp-colors.json \
 *     --export-dir FramerExport/papaya-export/ \
 *     --format markdown \
 *     --output reports/cross-validation.md
 */

import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface CliArgs {
  'mcp-json'?: string | true;
  'export-dir'?: string | true;
  format?: string | true;
  output?: string | true;
  only?: string | true;
  verbose?: string | true;
  help?: boolean;
  h?: boolean;
  'design-system'?: string | true;
  tree?: string | true;
  [key: string]: string | boolean | true | undefined;
}

interface MCPColor {
  name?: string;
  label?: string;
  id?: string;
  hex?: string;
  value?: string;
  color?: string;
  path?: string;
}

interface MCPFont {
  selector?: string;
  name?: string;
  family?: string;
  weight?: number;
}

interface MCPData {
  colors?: MCPColor[];
  fonts?: MCPFont[];
  breakpoints?: Partial<Record<string, number>>;
}

interface FontFaceEntry {
  family: string | null;
  weight: number | null;
  display: string | null;
}

interface DecodedFont {
  family: string;
  weight: number;
}

// ── Check Result Types ──

interface ColorMatchResult {
  check: 'COLOR_MATCH';
  token: string;
  mcp_path: string | null;
  mcp_hex: string | null;
  css_property: string;
  css_value: string;
  result: 'MATCH';
}

interface ColorMismatchResult {
  check: 'COLOR_MISMATCH';
  token: string;
  mcp_path: string | null;
  mcp_hex: string | null;
  css_property: string;
  css_value: string;
  css_hex: string | null;
  result: 'MISMATCH';
  note: string;
}

interface ColorMissingResult {
  check: 'COLOR_MISSING_IN_EXPORT';
  token: string;
  mcp_path: string | null;
  mcp_hex: string | null;
  result: 'MISSING_IN_EXPORT';
  note: string;
}

type ColorCheckResult = ColorMatchResult | ColorMismatchResult | ColorMissingResult;

interface UnmatchedCSSToken {
  css_property: string;
  css_value: string;
  css_hex: string | null;
  note: string;
}

interface FontExistsResult {
  check: 'FONT_EXISTS';
  selector: string;
  family: string;
  weight: number;
  expected_file: string;
  found: boolean;
  found_as: string | null;
  result: 'MATCH' | 'MISSING_IN_EXPORT';
}

interface FontCssMatchOk {
  check: 'FONT_CSS_MATCH';
  family: string;
  weight: number;
  css_display: string | null;
  result: 'MATCH';
  warning: string | null;
}

interface FontCssMatchMissing {
  check: 'FONT_CSS_MATCH';
  family: string;
  weight: number;
  result: 'MISSING_IN_CSS';
  note: string;
}

type FontCheckResult = FontExistsResult | FontCssMatchOk | FontCssMatchMissing;

interface UnmatchedFontFile {
  file: string;
  note: string;
}

interface BreakpointResult {
  check: 'BREAKPOINT_MATCH';
  name: string;
  mcp_value: number;
  css_value: number | null;
  result: 'MATCH' | 'MISSING_IN_EXPORT';
  note: string | null;
}

interface GvIdDriftResult {
  check: 'GV_ID_DRIFT';
  id?: string;
  result: 'DRIFT' | 'OK' | 'SKIPPED' | 'NO_REFS';
  note?: string;
}

interface ReportMeta {
  generated: string;
  mcp_colors: number;
  mcp_fonts: number;
  css_tokens_found: number;
  css_fonts_found: number;
  matches: number;
  mismatches: number;
  missing_in_export: number;
  missing_in_mcp: number;
}

interface Report {
  meta: ReportMeta;
  colors: ColorCheckResult[];
  fonts: FontCheckResult[];
  breakpoints: BreakpointResult[];
  unmatched_css_tokens: UnmatchedCSSToken[];
  gv_id_drift: GvIdDriftResult[];
  unmatched_font_files: UnmatchedFontFile[];
}

// ─────────────────────────────────────────────
// CLI ARGS
// ─────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;  // boolean flag
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (args['help'] || args['h']) {
  console.log('Usage: node --import tsx scripts/cross-validate-sources.ts --mcp-json <path> --export-dir <dir> [options]');
  console.log('');
  console.log('  --mcp-json <path>      MCP project JSON (required)');
  console.log('  --export-dir <path>    Framer export directory (required)');
  console.log('  --format <json|md>     Output format (default: json)');
  console.log('  --output <path>        Write results to file');
  console.log('  --only <check>         Run only: colors | fonts | breakpoints | gv-ids | all');
  console.log('  --design-system <path> adrians-export-design-system output JSON (fuer GV-ID Check)');
  console.log('  --tree <path>          V4 Tree JSON (fuer GV-ID Drift Detection)');
  console.log('  --verbose              Extra debug output');
  console.log('');
  console.log('Runs 7 cross-validation checks between MCP, CSS export and Elementor design system.');
  console.log('');
  console.log('Example:');
  console.log('  node --import tsx scripts/cross-validate-sources.ts \\');
  console.log('    --mcp-json FramerExport/mcp/project.json \\');
  console.log('    --export-dir FramerExport/');
  process.exit(0);
}

const mcpJsonPath  = args['mcp-json'] as string;
const exportDir    = args['export-dir'] as string;
const format       = (args['format'] as string) || 'json';
const outputPath   = (args['output'] as string) || null;
const only            = (args['only'] as string) || 'all';
const verbose         = !!(args['verbose']);
const designSystemPath = (args['design-system'] as string) || null;
const treePath         = (args['tree'] as string) || null;

if (!mcpJsonPath || !exportDir) {
  console.error('Usage: node --import tsx cross-validate-sources.ts --mcp-json <path> --export-dir <dir> [--format json|markdown] [--output <path>] [--only colors|fonts|breakpoints|all] [--verbose]');
  process.exit(1);
}

function log(...msg: string[]): void {
  if (verbose) process.stderr.write('[verbose] ' + msg.join(' ') + '\n');
}

// ─────────────────────────────────────────────
// HEX NORMALIZATION
// ─────────────────────────────────────────────

function normalizeHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  hex = hex.trim().toLowerCase();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (/^[0-9a-f]{6}$/.test(hex)) return '#' + hex;
  // rgb() / rgba()
  const m = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

// ─────────────────────────────────────────────
// FONT FILENAME RESOLUTION
// ─────────────────────────────────────────────

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light',
  400: 'Regular', 500: 'Medium',  600: 'SemiBold',
  700: 'Bold',  800: 'ExtraBold', 900: 'Black'
};

function expectedFontFilenames(family: string, weight: number): string[] {
  const familyClean = family.replace(/\s+/g, '');
  const weightName  = WEIGHT_NAMES[weight] ?? String(weight);
  const candidates  = [
    `${familyClean}-${weightName}.woff2`,
    `${familyClean}-${weightName}.woff`,
    `${familyClean}-${weightName}.ttf`,
  ];
  // Special case: weight 400 can be "Regular" or bare family name
  if (weight === 400) {
    candidates.push(`${familyClean}.woff2`, `${familyClean}.woff`);
  }
  return candidates;
}

function decodeFontSelector(selector: string): DecodedFont {
  // FR;InterDisplay-SemiBold  → { family: 'Inter Display', weight: 600 }
  // GF;Roboto-700             → { family: 'Roboto', weight: 700 }
  // Inter-Medium              → { family: 'Inter', weight: 500 }
  // Inter                     → { family: 'Inter', weight: 400 }

  const weightMap: Record<string, number> = {
    thin: 100, extralight: 200, light: 300, regular: 400,
    medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900
  };

  let sel = selector;

  if (sel.startsWith('FR;')) { sel = sel.slice(3); }
  else if (sel.startsWith('GF;')) { sel = sel.slice(3); }

  // Split on last hyphen or numeric suffix
  const numericMatch = sel.match(/^(.+?)-(\d{3})$/);
  if (numericMatch) {
    const rawFamily = numericMatch[1];
    const weight    = parseInt(numericMatch[2]);
    return { family: rawFamily.replace(/([A-Z])/g, ' $1').trim(), weight };
  }

  const parts = sel.split('-');
  if (parts.length >= 2) {
    const weightPart = parts[parts.length - 1].toLowerCase();
    const w = weightMap[weightPart];
    if (w !== undefined) {
      const familyRaw = parts.slice(0, -1).join('');
      // Insert spaces before capitals for display: "InterDisplay" → "Inter Display"
      const family = familyRaw.replace(/([a-z])([A-Z])/g, '$1 $2');
      return { family, weight: w };
    }
  }

  // No weight suffix → Regular
  const family = sel.replace(/([a-z])([A-Z])/g, '$1 $2');
  return { family, weight: 400 };
}

// ─────────────────────────────────────────────
// CSS PARSING HELPERS
// ─────────────────────────────────────────────

function extractCSSTokens(css: string): Record<string, string> {
  // --token-<hash>: <value>
  const tokens: Record<string, string> = {};
  const re = /--token-([a-f0-9_-]+)\s*:\s*([^;}\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const prop  = `--token-${m[1]}`;
    const value = m[2].trim();
    tokens[prop] = value;
  }
  return tokens;
}

function extractFontFaces(css: string): FontFaceEntry[] {
  const faces: FontFaceEntry[] = [];
  const blockRe = /@font-face\s*\{([^}]+)\}/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css)) !== null) {
    const inner = block[1];
    const familyM = inner.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/i);
    const weightM = inner.match(/font-weight\s*:\s*(\d+)/i);
    const displayM = inner.match(/font-display\s*:\s*([^;]+)/i);
    faces.push({
      family:  familyM ? familyM[1].trim() : null,
      weight:  weightM ? parseInt(weightM[1]) : null,
      display: displayM ? displayM[1].trim() : null,
    });
  }
  return faces;
}

function extractBreakpoints(css: string): number[] {
  const bps = new Set<number>();
  const re = /@media[^{]*(?:min-width|max-width)\s*:\s*([\d.]+)px/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    bps.add(parseFloat(m[1]));
  }
  return [...bps].sort((a, b) => a - b);
}

// ─────────────────────────────────────────────
// LOAD INPUTS
// ─────────────────────────────────────────────

log('Loading MCP JSON:', mcpJsonPath);
const mcpData: MCPData = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));

// Find CSS file in export dir (index.html or *.css)
let cssContent = '';
const cssFile  = path.join(exportDir, 'index.html');
const altCSS   = fs.readdirSync(exportDir)
  .filter(f => f.endsWith('.css'))
  .map(f => path.join(exportDir, f));

if (fs.existsSync(cssFile)) {
  log('Reading CSS from index.html');
  cssContent = fs.readFileSync(cssFile, 'utf8');
} else if (altCSS.length > 0) {
  log('Reading CSS from', altCSS[0]);
  cssContent = fs.readFileSync(altCSS[0], 'utf8');
} else {
  console.error(`No index.html or .css file found in ${exportDir}`);
  process.exit(1);
}

// Font files
const fontsDir   = path.join(exportDir, 'assets', 'fonts');
const fontFiles  = fs.existsSync(fontsDir)
  ? fs.readdirSync(fontsDir).map(f => f.toLowerCase())
  : [];
log('Font files found:', String(fontFiles.length));

// ─────────────────────────────────────────────
// CHECK 1: COLOR_MATCH
// ─────────────────────────────────────────────

function checkColors(mcpColors: MCPColor[], cssTokens: Record<string, string>): ColorCheckResult[] {
  const results: ColorCheckResult[] = [];
  const cssEntries = Object.entries(cssTokens); // [ [prop, value], ... ]

  for (const color of mcpColors) {
    const colorName = color.name ?? color.label ?? color.id ?? 'unnamed-color';
    const mcpHex = normalizeHex(color.hex ?? color.value ?? color.color);
    log('Checking color:', colorName, mcpHex ?? 'null');

    // Try to find a CSS token with matching hex value
    let found: { prop: string; value: string; cssHex: string } | null = null;
    for (const [prop, value] of cssEntries) {
      const cssHex = normalizeHex(value);
      if (cssHex && mcpHex && cssHex === mcpHex) {
        found = { prop, value, cssHex };
        break;
      }
    }

    if (found) {
      results.push({
        check: 'COLOR_MATCH',
        token: colorName,
        mcp_path: color.path || null,
        mcp_hex: mcpHex,
        css_property: found.prop,
        css_value: found.value,
        result: 'MATCH',
      });
    } else {
      // Try fuzzy: look for color name in property name (if comments embedded)
      const namePart = colorName.toLowerCase().replace(/\s+/g, '');
      const fuzzy = cssEntries.find(([p]) => p.toLowerCase().includes(namePart));

      if (fuzzy) {
        const cssHex = normalizeHex(fuzzy[1]);
        results.push({
          check: 'COLOR_MISMATCH',
          token: colorName,
          mcp_path: color.path || null,
          mcp_hex: mcpHex,
          css_property: fuzzy[0],
          css_value: fuzzy[1],
          css_hex: cssHex,
          result: 'MISMATCH',
          note: 'MCP und CSS liefern unterschiedliche Farbwerte. MCP gewinnt als Design-Intent.',
        });
      } else {
        results.push({
          check: 'COLOR_MISSING_IN_EXPORT',
          token: colorName,
          mcp_path: color.path || null,
          mcp_hex: mcpHex,
          result: 'MISSING_IN_EXPORT',
          note: 'Farbe im MCP definiert, aber kein passendes CSS-Token gefunden.',
        });
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// CHECK 5: COLOR_MISSING_IN_MCP
// ─────────────────────────────────────────────

function checkUnmatchedCSSTokens(mcpColors: MCPColor[], cssTokens: Record<string, string>): UnmatchedCSSToken[] {
  const results: UnmatchedCSSToken[] = [];
  const mcpHexSet = new Set(
    mcpColors
      .map(c => normalizeHex(c.hex ?? c.value ?? c.color))
      .filter((h): h is string => h !== null)
  );

  for (const [prop, value] of Object.entries(cssTokens)) {
    const cssHex = normalizeHex(value);
    if (cssHex && !mcpHexSet.has(cssHex)) {
      results.push({
        css_property: prop,
        css_value: value,
        css_hex: cssHex,
        note: 'Kein MCP-Token gefunden. Möglicherweise interne Framer-Farbe.',
      });
    }
  }
  return results;
}

// ─────────────────────────────────────────────
// CHECK 2+3: FONT_EXISTS + FONT_CSS_MATCH
// ─────────────────────────────────────────────

function checkFonts(mcpFonts: MCPFont[], fontFiles: string[], cssFontFaces: FontFaceEntry[]): FontCheckResult[] {
  const results: FontCheckResult[] = [];

  for (const font of mcpFonts) {
    const decoded  = decodeFontSelector(font.selector || font.name || '');
    const family   = font.family  || decoded.family;
    const weight   = font.weight  || decoded.weight;
    const expected = expectedFontFilenames(family, weight);

    log('Checking font:', font.name ?? font.selector ?? '?', family, String(weight), '→', expected[0]);

    const foundFile = expected.find(f => fontFiles.includes(f.toLowerCase()));

    results.push({
      check: 'FONT_EXISTS',
      selector: font.selector || font.name || '',
      family,
      weight,
      expected_file: expected[0],
      found: !!foundFile,
      found_as: foundFile || null,
      result: foundFile ? 'MATCH' : 'MISSING_IN_EXPORT',
    });

    // CHECK 3: Font-face CSS consistency
    const faceMatch = cssFontFaces.find(
      f => f.family && f.family.toLowerCase() === family.toLowerCase() && f.weight === weight
    );
    if (faceMatch) {
      results.push({
        check: 'FONT_CSS_MATCH',
        family,
        weight,
        css_display: faceMatch.display,
        result: 'MATCH',
        warning: faceMatch.display !== 'swap' ? 'font-display: swap fehlt (Performance)' : null,
      });
    } else {
      results.push({
        check: 'FONT_CSS_MATCH',
        family,
        weight,
        result: 'MISSING_IN_CSS',
        note: 'Kein @font-face im CSS fuer diesen Font/Weight gefunden.',
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// CHECK 6: FONT_MISSING_IN_MCP
// ─────────────────────────────────────────────

function checkUnmatchedFonts(mcpFonts: MCPFont[], fontFiles: string[]): UnmatchedFontFile[] {
  const results: UnmatchedFontFile[] = [];
  const knownFiles = new Set<string>(
    mcpFonts.flatMap(f => {
      const decoded = decodeFontSelector(f.selector || f.name || '');
      return expectedFontFilenames(f.family || decoded.family, f.weight || decoded.weight)
        .map(n => n.toLowerCase());
    })
  );
  for (const file of fontFiles) {
    if (!knownFiles.has(file.toLowerCase())) {
      results.push({
        file,
        note: 'Font-Datei ohne MCP-Pendant. Pruefen ob in Framer-Seiten verwendet.',
      });
    }
  }
  return results;
}

// ─────────────────────────────────────────────
// CHECK 4: BREAKPOINT_MATCH
// ─────────────────────────────────────────────

function checkBreakpoints(mcpBreakpoints: Partial<Record<string, number>>, cssBPs: number[]): BreakpointResult[] {
  const results: BreakpointResult[] = [];
  const expected: Record<string, number> = {
    desktop: mcpBreakpoints.desktop || 1440,
    tablet:  mcpBreakpoints.tablet  || 810,
    mobile:  mcpBreakpoints.mobile  || 390,
  };

  for (const [name, val] of Object.entries(expected)) {
    if (name === 'desktop') continue; // desktop usually has no explicit @media
    const found = cssBPs.find(bp => bp === val || Math.abs(bp - val) <= 10);
    results.push({
      check: 'BREAKPOINT_MATCH',
      name,
      mcp_value: val,
      css_value: found || null,
      result: found ? 'MATCH' : 'MISSING_IN_EXPORT',
      note: found
        ? null
        : `Breakpoint ${val}px im CSS nicht gefunden. Gefundene: ${cssBPs.join(', ')}`,
    });
  }

  return results;
}

// ─────────────────────────────────────────────
// CHECK 7: GV-ID DRIFT DETECTION
// Nutzt adrians-export-design-system Output um sicherzustellen
// dass alle e-gv-* IDs im V4-Tree noch im Kit existieren.
// ─────────────────────────────────────────────

function checkGvIdDrift(designSystemExport: Record<string, unknown> | null, v4Tree: unknown | null): GvIdDriftResult[] {
  const results: GvIdDriftResult[] = [];
  if (!designSystemExport || !v4Tree) {
    return [{ check: 'GV_ID_DRIFT', result: 'SKIPPED', note: '--design-system und --tree benoetigt' }];
  }

  // Alle e-gv-* IDs aus dem Kit sammeln (aus adrians-export-design-system output)
  const kitGvIds = new Set<string>();
  const exportData = designSystemExport.export_data as Record<string, unknown> | undefined;
  const colorData = (exportData?.colors || designSystemExport.colors) as Array<{ id?: string; variableId?: string }> | undefined;
  if (colorData) {
    for (const c of colorData) {
      if (c.id && c.id.startsWith('e-gv-')) kitGvIds.add(c.id);
      if (c.variableId && c.variableId.startsWith('e-gv-')) kitGvIds.add(c.variableId);
    }
  }
  const typoData = (exportData?.typography || designSystemExport.typography) as Array<{ id?: string }> | undefined;
  if (typoData) {
    for (const t of typoData) {
      if (t.id && t.id.startsWith('e-gv-')) kitGvIds.add(t.id);
    }
  }

  log(`Kit GV-IDs gefunden: ${String(kitGvIds.size)}`);

  // Alle e-gv-* Referenzen im V4-Tree suchen
  const usedGvIds = new Set<string>();
  function scanForGvRefs(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(scanForGvRefs); return; }
    const rec = obj as Record<string, unknown>;
    if (rec['$$type'] === 'global-color-variable' && typeof rec.value === 'string') {
      usedGvIds.add(rec.value);
    }
    if (rec['$$type'] === 'global-typography-variable' && typeof rec.value === 'string') {
      usedGvIds.add(rec.value);
    }
    for (const v of Object.values(rec)) scanForGvRefs(v);
  }
  scanForGvRefs(v4Tree);

  log(`V4-Tree GV-Referenzen gefunden: ${String(usedGvIds.size)}`);

  // Drift pruefen: im Tree referenziert aber nicht im Kit
  for (const id of usedGvIds) {
    if (kitGvIds.size > 0 && !kitGvIds.has(id)) {
      results.push({
        check: 'GV_ID_DRIFT',
        id,
        result: 'DRIFT',
        note: `${id} im V4-Tree referenziert aber nicht im Kit. Wahrscheinlich nach Elementor-Update verschoben.`,
      });
    } else {
      results.push({ check: 'GV_ID_DRIFT', id, result: 'OK' });
    }
  }

  if (usedGvIds.size === 0) {
    results.push({ check: 'GV_ID_DRIFT', result: 'NO_REFS', note: 'Keine e-gv-* Referenzen im V4-Tree gefunden.' });
  }

  return results;
}

// ─────────────────────────────────────────────
// RUN ALL CHECKS
// ─────────────────────────────────────────────

const cssTokens    = extractCSSTokens(cssContent);
const cssFontFaces = extractFontFaces(cssContent);
const cssBPs       = extractBreakpoints(cssContent);

log('CSS tokens found:', String(Object.keys(cssTokens).length));
log('CSS @font-face blocks:', String(cssFontFaces.length));
log('CSS breakpoints found:', cssBPs.join(', '));

const runColors      = only === 'all' || only === 'colors';
const runFonts       = only === 'all' || only === 'fonts';
const runBreakpoints = only === 'all' || only === 'breakpoints';
const runGvIds       = only === 'all' || only === 'gv-ids';

// Design-System Export laden (optional, fuer GV-ID Drift Check)
let designSystemData: Record<string, unknown> | null = null;
if (designSystemPath && fs.existsSync(designSystemPath)) {
  try {
    designSystemData = JSON.parse(fs.readFileSync(designSystemPath, 'utf8'));
    log('Design-System Export geladen:', designSystemPath);
  } catch (e: unknown) {
    process.stderr.write(`WARN: design-system JSON konnte nicht geladen werden: ${(e as Error).message}\n`);
  }
}

// V4-Tree laden (optional, fuer GV-ID Drift Check)
let treeData: unknown = null;
if (treePath && fs.existsSync(treePath)) {
  try {
    treeData = JSON.parse(fs.readFileSync(treePath, 'utf8'));
    log('V4-Tree geladen:', treePath);
  } catch (e: unknown) {
    process.stderr.write(`WARN: tree JSON konnte nicht geladen werden: ${(e as Error).message}\n`);
  }
}

const colorResults       = runColors ? checkColors(mcpData.colors || [], cssTokens) : [];
const unmatchedCSS       = runColors ? checkUnmatchedCSSTokens(mcpData.colors || [], cssTokens) : [];
const fontResults        = runFonts  ? checkFonts(mcpData.fonts || [], fontFiles, cssFontFaces) : [];
const unmatchedFontFiles = runFonts  ? checkUnmatchedFonts(mcpData.fonts || [], fontFiles) : [];
const breakpointResults  = runBreakpoints ? checkBreakpoints(mcpData.breakpoints || {}, cssBPs) : [];
const gvIdResults        = runGvIds
  ? checkGvIdDrift(designSystemData, treeData)
  : [{ check: 'GV_ID_DRIFT' as const, result: 'SKIPPED' as const, note: 'Nicht ausgefuehrt (--only gesetzt)' }];

// ─────────────────────────────────────────────
// BUILD REPORT
// ─────────────────────────────────────────────

const colorChecks   = colorResults.filter(r => r.check === 'COLOR_MATCH' || r.check === 'COLOR_MISSING_IN_EXPORT' || r.check === 'COLOR_MISMATCH');
const matches       = colorChecks.filter(r => r.result === 'MATCH').length;
const mismatches    = colorChecks.filter(r => r.result === 'MISMATCH').length;
const missingExport = colorChecks.filter(r => r.result === 'MISSING_IN_EXPORT').length;

const fontExistChecks   = fontResults.filter((r): r is FontExistsResult => r.check === 'FONT_EXISTS');
const fontMatches       = fontExistChecks.filter(r => r.result === 'MATCH').length;
const fontMissing       = fontExistChecks.filter(r => r.result === 'MISSING_IN_EXPORT').length;

const bpMatches = breakpointResults.filter(r => r.result === 'MATCH').length;

const report: Report = {
  meta: {
    generated:         new Date().toISOString(),
    mcp_colors:        (mcpData.colors || []).length,
    mcp_fonts:         (mcpData.fonts  || []).length,
    css_tokens_found:  Object.keys(cssTokens).length,
    css_fonts_found:   fontFiles.length,
    matches,
    mismatches,
    missing_in_export: missingExport,
    missing_in_mcp:    unmatchedCSS.length,
  },
  colors:               colorResults,
  fonts:                fontResults,
  breakpoints:          breakpointResults,
  unmatched_css_tokens: unmatchedCSS,
  gv_id_drift:          gvIdResults,
  unmatched_font_files: unmatchedFontFiles,
};

// ─────────────────────────────────────────────
// MARKDOWN FORMATTER
// ─────────────────────────────────────────────

function toMarkdown(report: Report): string {
  const m = report.meta;
  const lines: string[] = [];

  lines.push('# Framer Dual-Source Cross-Validation');
  lines.push('');
  lines.push(`> Generiert: ${m.generated}`);
  lines.push('');
  lines.push('## Zusammenfassung');
  lines.push('');
  lines.push('| Check | Ergebnis |');
  lines.push('|-------|----------|');

  const bpTotal = report.breakpoints.length;
  const bpMatch = report.breakpoints.filter(r => r.result === 'MATCH').length;
  const fExist = report.fonts.filter((r): r is FontExistsResult => r.check === 'FONT_EXISTS');

  const gvDrift = gvIdResults.filter(r => r.result === 'DRIFT').length;
  const gvOk    = gvIdResults.filter(r => r.result === 'OK').length;
  const gvSkip  = gvIdResults.some(r => r.result === 'SKIPPED' || r.result === 'NO_REFS');
  if (!gvSkip) lines.push(`| GV-ID Drift (Check 7) | ${gvOk} OK, ${gvDrift} DRIFT |`);
  lines.push(`| Farben (MCP→CSS) | ${m.matches}/${m.mcp_colors} MATCH, ${m.mismatches} MISMATCH, ${m.missing_in_export} MISSING |`);
  lines.push(`| Fonts (MCP→Export) | ${fExist.filter(r => r.found).length}/${fExist.length} MATCH, ${fExist.filter(r => !r.found).length} MISSING |`);
  lines.push(`| Breakpoints | ${bpMatch}/${bpTotal} MATCH |`);
  lines.push(`| Ungleiche CSS-Tokens | ${report.unmatched_css_tokens.length} (kein MCP-Pendant) |`);
  lines.push('');

  // Color mismatches
  const colorMismatches = report.colors.filter((r): r is ColorMismatchResult => r.result === 'MISMATCH');
  if (colorMismatches.length > 0) {
    lines.push('## Farb-Mismatches');
    lines.push('');
    for (const c of colorMismatches) {
      lines.push(`### ❌ ${c.token}`);
      lines.push(`- **MCP:** \`${c.mcp_hex}\` (Pfad: ${c.mcp_path || 'n/a'})`);
      lines.push(`- **CSS:** \`${c.css_value}\` (${c.css_property})`);
      lines.push(`- **Empfehlung:** MCP-Wert als Design-Intent verwenden.`);
      lines.push('');
    }
  }

  // Missing colors
  const colorMissing = report.colors.filter((r): r is ColorMissingResult => r.result === 'MISSING_IN_EXPORT');
  if (colorMissing.length > 0) {
    lines.push('## Fehlende Farben im CSS-Export');
    lines.push('');
    for (const c of colorMissing) {
      lines.push(`### ❌ ${c.token}`);
      lines.push(`- **MCP:** \`${c.mcp_hex}\` (Pfad: ${c.mcp_path || 'n/a'})`);
      lines.push(`- **CSS:** Kein passendes Token gefunden`);
      lines.push(`- **Empfehlung:** MCP-Wert pruefen und ggf. manuell ergaenzen.`);
      lines.push('');
    }
  }

  // Missing fonts
  const missingFonts = report.fonts.filter((r): r is FontExistsResult => r.check === 'FONT_EXISTS' && !r.found);
  if (missingFonts.length > 0) {
    lines.push('## Fehlende Fonts');
    lines.push('');
    for (const f of missingFonts) {
      lines.push(`### ❌ ${f.family} (weight ${f.weight})`);
      lines.push(`- **Erwartet:** \`${f.expected_file}\``);
      lines.push(`- **MCP-Selector:** \`${f.selector}\``);
      lines.push(`- **Empfehlung:** Font-Datei in \`assets/fonts/\` pruefen oder aus Framer erneut exportieren.`);
      lines.push('');
    }
  }

  // Font display warnings
  const fontDisplayWarnings = report.fonts.filter(
    (r): r is FontCssMatchOk => r.check === 'FONT_CSS_MATCH' && r.result === 'MATCH' && r.warning !== null
  );
  if (fontDisplayWarnings.length > 0) {
    lines.push('## Font-Performance-Warnungen');
    lines.push('');
    for (const f of fontDisplayWarnings) {
      lines.push(`### ⚠️ ${f.family} (weight ${f.weight})`);
      lines.push(`- **Warnung:** ${f.warning}`);
      lines.push('');
    }
  }

  // Breakpoint issues
  const bpIssues = report.breakpoints.filter(r => r.result !== 'MATCH');
  if (bpIssues.length > 0) {
    lines.push('## Breakpoint-Abweichungen');
    lines.push('');
    for (const b of bpIssues) {
      lines.push(`### ⚠️ ${b.name} (${b.mcp_value}px)`);
      if (b.note) lines.push(`- ${b.note}`);
      lines.push('');
    }
  }

  // Unmatched CSS tokens
  if (report.unmatched_css_tokens.length > 0) {
    lines.push('## Ungleiche CSS-Tokens (kein MCP-Pendant)');
    lines.push('');
    lines.push('| CSS-Property | Wert | Hex |');
    lines.push('|-------------|------|-----|');
    for (const t of report.unmatched_css_tokens) {
      lines.push(`| \`${t.css_property}\` | \`${t.css_value}\` | \`${t.css_hex || 'n/a'}\` |`);
    }
    lines.push('');
    lines.push('> Wahrscheinlich interne Framer-Farben, koennen meist ignoriert werden.');
    lines.push('');
  }

  // Unmatched font files
  if (report.unmatched_font_files.length > 0) {
    lines.push('## Font-Dateien ohne MCP-Pendant');
    lines.push('');
    for (const f of report.unmatched_font_files) {
      lines.push(`- \`${f.file}\` — ${f.note}`);
    }
    lines.push('');
  }

  // Recommendations
  lines.push('## Empfehlungen');
  lines.push('');
  const recs: string[] = [];
  colorMismatches.forEach(c => recs.push(`**${c.token}**: MCP-Wert (\`${c.mcp_hex}\`) in \`token-mapping.json\` uebernehmen.`));
  missingFonts.forEach(f => recs.push(`**${f.family} ${f.weight}**: Pruefen ob in Framer-Seiten verwendet; ggf. Font-Datei ergaenzen.`));
  if (report.unmatched_css_tokens.length > 0) {
    recs.push(`**${report.unmatched_css_tokens.length} ungleiche CSS-Tokens**: Wahrscheinlich interne Framer-Farben — koennen ignoriert werden, sofern nicht in Seitenlayout verwendet.`);
  }

  if (recs.length === 0) {
    lines.push('✅ Keine Handlungsempfehlungen — alle Checks bestanden.');
  } else {
    recs.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────
// OUTPUT
// ─────────────────────────────────────────────

const output = format === 'markdown' ? toMarkdown(report) : JSON.stringify(report, null, 2);

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf8');
  process.stderr.write(`Report saved to ${outputPath}\n`);
} else {
  process.stdout.write(output + '\n');
}

// ─────────────────────────────────────────────
// EXIT CODE
// ─────────────────────────────────────────────

const gvDriftCount = gvIdResults.filter(r => r.result === 'DRIFT').length;
const hasErrors   = mismatches > 0 || fontMissing > 0 || gvDriftCount > 0;
const hasWarnings = unmatchedCSS.length > 0 || breakpointResults.some(r => r.result !== 'MATCH');

if (hasErrors) {
  process.exit(2);
} else if (hasWarnings) {
  process.exit(1);
} else {
  process.exit(0);
}
