#!/usr/bin/env node
/**
 * design-token-extractor.ts
 *
 * Liest Framer's CSS-Variablen (Custom Properties) und mapped sie auf
 * Elementor V4 e-gv-* IDs. Erstellt token-mapping.json Vorschläge und
 * batch-create-variables MCP-Call Pläne.
 *
 * Unterstützt mehrere Eingabeformate:
 *   - HTML-Dateien (extrahiert CSS aus <style>-Blöcken)
 *   - CSS-Dateien direkt
 *   - extracted-styles.json (von extract-framer-styles.js)
 *   - framer-css-map.json (von framer-html-to-elementor.js)
 *
 * Usage:
 *   node --import tsx scripts/design-token-extractor.ts \
 *     --html ./FramerExport/index.html \
 *     --output ./FramerExport/tokens/token-mapping.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeHex, rgbToHex } from './lib/framer-utils.js';
import type { DesignToken } from '../src/shared-schemas/design-tokens.js';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface TokenEntry {
  values: Set<string>;
  occurrences: number;
  type?: string;
}

interface DsVariable {
  id?: string;
  _id?: string;
  label?: string;
  title?: string;
  value?: string;
  color?: string;
  hex?: string;
}

interface DsIndex {
  byHex: Map<string, string>;
  byLabel: Map<string, string>;
  total: number;
}

interface UnknownMapping {
  value: string;
  label: string;
  occurrences: number;
}

interface TokenMappingMeta {
  generatedAt: string;
  totalTokens: number;
  colorCount?: number;
  fontCount?: number;
  sizeCount?: number;
  mappedCount?: number;
  unmappedCount?: number;
}

interface TokenMapping {
  meta: TokenMappingMeta;
  colors: DesignToken[];
  fonts: DesignToken[];
  sizes: DesignToken[];
  // Framer-specific, not part of the shared DesignTokenSet contract —
  // kept as a sibling field. See UMBAUPLAN-KOMBINIERT-2026-07.md Phase 5
  // Punkt 1 for why this doesn't live inside colors/fonts/sizes.
  unknown: Record<string, UnknownMapping>;
}

interface VariablePlanEntry {
  label: string;
  type: string;
  value: string;
}

interface VariablesPlan {
  meta: {
    totalVariables: number;
    generatedAt: string;
  };
  mcpCall: {
    ability_name: string;
    parameters: {
      variables: Array<{ label: string; type: string; value: string }>;
      strategy: string;
    };
  };
  variables: VariablePlanEntry[];
  instructions: string[];
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'html':            { type: 'string' },
    'css':             { type: 'string' },
    'css-dir':         { type: 'string' },
    'styles-json':     { type: 'string' },
    'framer-css-map':  { type: 'string' },
    'design-system':   { type: 'string' },
    'existing-tokens': { type: 'string' },
    'output':          { type: 'string' },
    'variables-plan':  { type: 'string' },
    'verbose':         { type: 'boolean', default: false },
    'help':            { type: 'boolean', default: false },
  },
  strict: false,
});

const htmlPath: string | undefined = args.html as string | undefined;
const cssPath: string | undefined = args.css as string | undefined;
const cssDirPath: string | undefined = args['css-dir'] as string | undefined;
const stylesJsonPath: string | undefined = args['styles-json'] as string | undefined;
const framerCssMapPath: string | undefined = args['framer-css-map'] as string | undefined;
const designSystemPath: string | undefined = args['design-system'] as string | undefined;
const existingTokensPath: string | undefined = args['existing-tokens'] as string | undefined;
const outputPath: string | undefined = args.output as string | undefined;
const variablesPlanPath: string | undefined = args['variables-plan'] as string | undefined;

if (args.help || (!htmlPath && !cssPath && !cssDirPath && !stylesJsonPath && !framerCssMapPath)) {
  console.log(`
design-token-extractor.ts

Extrahiert CSS Custom Properties (Design Tokens) aus FramerExport
und mapped sie auf Elementor V4 e-gv-* IDs.

EINGABE (mindestens eine):
  --html FILE          HTML-Datei mit <style>-Blöcken
  --css FILE           Einzelne CSS-Datei
  --css-dir DIR        Verzeichnis mit CSS-Dateien (rekursiv)
  --styles-json FILE   extracted-styles.json
  --framer-css-map FILE  framer-css-map.json

OPTIONEN:
  --design-system FILE    Output von novamira/adrians-export-design-system
                          Löst e-gv-* IDs automatisch auf (by hex + by label).
                          Empfohlen nach Phase 3 (batch-create-variables).
  --existing-tokens FILE  Bestehendes token-mapping.json für Update
  --output FILE           Output: token-mapping.json
  --variables-plan FILE   Output: variables-plan.json mit MCP-Calls
  --verbose               Ausführliche Logs
  --help                  Diese Hilfe

EXIT-CODES:
  0 = Tokens extrahiert (unmapped tokens produce warnings, not errors)
  2 = Keine Eingabedatei gefunden
`);
  if (args.help) process.exit(0);
  process.exit(2);
}

const log  = (...msg: string[]) => { if (args.verbose) process.stderr.write('[verbose] ' + msg.join(' ') + '\n'); };
const warn = (...msg: string[]) => process.stderr.write('[warn] ' + msg.join(' ') + '\n');
const fatal = (msg: string, code = 2): never => { process.stderr.write('[FATAL] ' + msg + '\n'); process.exit(code); };

// ─── CSS EXTRACTION ──────────────────────────────────────────────────────────

function extractCssFromHtml(htmlContent: string): string {
  const blocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = styleRe.exec(htmlContent)) !== null) blocks.push(match[1]);
  return blocks.join('\n');
}

function extractCustomProperties(cssContent: string): Map<string, TokenEntry> {
  const tokens = new Map<string, TokenEntry>();
  const declRe = /(--[\w-]+)\s*:\s*([^;!}]+)/g;
  let declMatch: RegExpExecArray | null;
  while ((declMatch = declRe.exec(cssContent)) !== null) {
    const name = declMatch[1].trim();
    const value = declMatch[2].trim();
    if (!tokens.has(name)) tokens.set(name, { values: new Set<string>(), occurrences: 0 });
    const token = tokens.get(name)!;
    token.values.add(value);
    token.occurrences++;
  }

  const varRe = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+?))?\s*\)/g;
  let varMatch: RegExpExecArray | null;
  while ((varMatch = varRe.exec(cssContent)) !== null) {
    const name = varMatch[1].trim();
    const fallback: string | null = varMatch[2]?.trim() ?? null;
    if (!tokens.has(name) && fallback) {
      tokens.set(name, { values: new Set([fallback]), occurrences: 0 });
    }
  }
  return tokens;
}

// ─── TOKEN CLASSIFICATION ─────────────────────────────────────────────────────

function detectTokenType(name: string, value: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('-color') || lowerName.includes('-text') && !lowerName.includes('font')) {
    if (looksLikeColor(value)) return 'color';
  }
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
  if (lowerName.includes('-font') || lowerName.includes('family') || lowerName.includes('typography')) return 'font';
  if (lowerName.includes('-size') || lowerName.includes('-spacing') || lowerName.includes('-width')) return 'size';
  if (looksLikeColor(value)) return 'color';
  if (/^\d/.test(value) && /(px|%|em|rem|vw|vh)$/.test(value)) return 'size';
  return 'unknown';
}

function looksLikeColor(value: string): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl');
}

function tokenLabel(name: string): string {
  return name.replace(/^--/, '').replace(/^token-/, 'framer-').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 50);
}

// ─── DESIGN-SYSTEM GV-ID RESOLUTION ──────────────────────────────────────────

/**
 * Baut einen Lookup-Index aus dem Output von novamira/adrians-export-design-system.
 * Unterstützt beide Schlüssel: byHex (für Farben) und byLabel (für alle Typen).
 * Format: { global_variables: [{id, label, type, value}], global_colors: [{id, label, color}] }
 */
function resolveGvIdsFromDesignSystem(dsExport: Record<string, unknown>): DsIndex {
  const byHex   = new Map<string, string>(); // hex → e-gv-ID
  const byLabel = new Map<string, string>(); // label.toLowerCase() → e-gv-ID
  const gvArr = (dsExport?.global_variables as DsVariable[]) ?? (dsExport?.variables as DsVariable[]) ?? [];
  const gcArr = (dsExport?.global_colors as DsVariable[]) ?? (dsExport?.colors as DsVariable[]) ?? [];
  const sources: DsVariable[] = [...gvArr, ...gcArr];
  for (const v of sources) {
    const id = v.id ?? v._id;
    if (!id || !id.startsWith('e-gv-')) continue;
    const label = (v.label ?? v.title ?? '').toLowerCase().replace(/\s+/g, '-');
    if (label) byLabel.set(label, id);
    const raw: string = v.value ?? v.color ?? v.hex ?? '';
    const hex = normalizeHex(raw) ?? rgbToHex(raw);
    if (hex) byHex.set(hex, id);
  }
  return { byHex, byLabel, total: sources.length };
}

// ─── TOKEN MAPPING ────────────────────────────────────────────────────────────

function generateTokenMapping(
  allTokens: Map<string, TokenEntry>,
  existingMapping: TokenMapping | null = null,
  dsIndex: DsIndex | null = null,
): TokenMapping {
  const mapping: TokenMapping = {
    meta: { generatedAt: new Date().toISOString(), totalTokens: 0 },
    colors: [], fonts: [], sizes: [], unknown: {},
  };
  const existingColors: DesignToken[] = existingMapping?.colors ?? [];
  const existingFonts: DesignToken[] = existingMapping?.fonts ?? [];
  const existingSizes: DesignToken[] = existingMapping?.sizes ?? [];

  for (const [name, token] of allTokens) {
    const values = [...token.values];
    const primaryValue = values[0] ?? '';

    if (token.type === 'color') {
      const hex = normalizeHex(primaryValue) ?? rgbToHex(primaryValue) ?? primaryValue;
      // Versuche GV-ID aus live Design-System aufzulösen: byHex > byLabel > existing > null
      const autoGvId = dsIndex
        ? (dsIndex.byHex.get(hex) ?? dsIndex.byLabel.get(tokenLabel(name)) ?? null)
        : null;
      mapping.colors.push({
        id: name, hex,
        gv_id: autoGvId ?? existingColors.find(c => c.id === name)?.gv_id ?? null,
        label: tokenLabel(name),
        occurrences: token.occurrences,
        css_var: name,
      });
    } else if (token.type === 'font') {
      const family = primaryValue.replace(/['"]/g, '').split(',')[0].trim();
      mapping.fonts.push({
        id: name, family,
        gv_id: existingFonts.find(f => f.id === name)?.gv_id ?? null,
        label: tokenLabel(name),
        occurrences: token.occurrences,
        css_var: name,
      });
    } else if (token.type === 'size') {
      const pxMatch = primaryValue.match(/[\d.]+/);
      mapping.sizes.push({
        id: name, px: pxMatch ? parseFloat(pxMatch[0]) : undefined,
        gv_id: existingSizes.find(s => s.id === name)?.gv_id ?? null,
        label: tokenLabel(name),
        occurrences: token.occurrences,
        css_var: name,
      });
    } else {
      mapping.unknown[name] = { value: primaryValue, label: tokenLabel(name), occurrences: token.occurrences };
    }
    mapping.meta.totalTokens++;
  }

  mapping.meta.colorCount = mapping.colors.length;
  mapping.meta.fontCount  = mapping.fonts.length;
  mapping.meta.sizeCount  = mapping.sizes.length;
  mapping.meta.mappedCount = [...mapping.colors, ...mapping.fonts, ...mapping.sizes]
    .filter(e => e.gv_id !== null).length;
  mapping.meta.unmappedCount = mapping.meta.totalTokens - mapping.meta.mappedCount;
  return mapping;
}

// ─── VARIABLES PLAN ───────────────────────────────────────────────────────────

function buildVariablesPlan(tokenMapping: TokenMapping): VariablesPlan {
  const variables: VariablePlanEntry[] = [];
  for (const entry of tokenMapping.colors) {
    if (entry.gv_id) continue;
    variables.push({ label: entry.label ?? entry.id, type: 'color', value: entry.hex ?? '' });
  }
  for (const entry of tokenMapping.fonts) {
    if (entry.gv_id) continue;
    variables.push({ label: entry.label ?? entry.id, type: 'font', value: entry.family ?? '' });
  }
  for (const entry of tokenMapping.sizes) {
    if (entry.gv_id) continue;
    variables.push({ label: entry.label ?? entry.id, type: 'size', value: entry.px !== undefined ? `${entry.px}px` : '' });
  }
  return {
    meta: { totalVariables: variables.length, generatedAt: new Date().toISOString() },
    mcpCall: {
      ability_name: 'novamira/adrians-batch-create-variables',
      parameters: { variables: variables.map(v => ({ label: v.label, type: v.type, value: v.value })), strategy: 'skip' },
    },
    variables,
    instructions: [
      '1. novamira/adrians-setup-v4-foundation aufrufen → base classes + variable IDs zurücklesen',
      '2. variables-plan.json mcpCall ausführen: novamira/adrians-batch-create-variables',
      '3. adrians-export-design-system what=all → e-gv-* IDs der erstellten Variablen holen',
      '4. e-gv-* IDs in token-mapping.json eintragen (gv_id Felder)',
      '5. convert-xml-to-v4.js mit --tokens token-mapping.json ausführen',
      '6. Nach Build: novamira/adrians-visual-qa post_id=<ID> zur Server-seitigen QA',
      '7. novamira/adrians-responsive-audit post_id=<ID> für Breakpoint-Analyse',
    ],
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

let allCssContent = '';

if (htmlPath) {
  if (!fs.existsSync(htmlPath)) fatal(`HTML nicht gefunden: ${htmlPath}`);
  allCssContent += extractCssFromHtml(fs.readFileSync(htmlPath, 'utf8')) + '\n';
  log('CSS aus HTML extrahiert');
}
if (cssPath) {
  if (!fs.existsSync(cssPath)) fatal(`CSS nicht gefunden: ${cssPath}`);
  allCssContent += fs.readFileSync(cssPath, 'utf8') + '\n';
}
if (cssDirPath) {
  if (!fs.existsSync(cssDirPath)) fatal(`CSS-Verzeichnis nicht gefunden: ${cssDirPath}`);
  const scanDir = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scanDir(full);
      else if (entry.name.endsWith('.css')) allCssContent += fs.readFileSync(full, 'utf8') + '\n';
    }
  };
  scanDir(cssDirPath);
}
if (stylesJsonPath) {
  if (!fs.existsSync(stylesJsonPath)) fatal(`styles-json nicht gefunden: ${stylesJsonPath}`);
  const stylesData: Record<string, unknown> = JSON.parse(fs.readFileSync(stylesJsonPath, 'utf8'));
  if ((stylesData.colors as Record<string, unknown>)?.unique) {
    for (const c of (stylesData.colors as Record<string, unknown>).unique as Array<{ hex: string }>) {
      allCssContent += `--extracted-${c.hex.replace('#', '')}: ${c.hex};\n`;
    }
  }
  if (stylesData.fonts) {
    for (const f of stylesData.fonts as Array<{ family?: string }>) {
      if (f.family) allCssContent += `--extracted-font: "${f.family}";\n`;
    }
  }
}
if (framerCssMapPath) {
  if (!fs.existsSync(framerCssMapPath)) fatal(`framer-css-map nicht gefunden: ${framerCssMapPath}`);
  const cssMap: Record<string, unknown> = JSON.parse(fs.readFileSync(framerCssMapPath, 'utf8'));
  if (cssMap.designTokens) {
    for (const [name, val] of Object.entries(cssMap.designTokens as Record<string, string>)) {
      allCssContent += `${name}: ${val};\n`;
    }
  }
}

if (!allCssContent.trim()) fatal('Keine CSS-Inhalte aus Eingaben extrahiert.', 2);

const tokens = extractCustomProperties(allCssContent);
for (const [name, token] of tokens) token.type = detectTokenType(name, [...token.values][0] ?? '');

const existingMapping: TokenMapping | null = (existingTokensPath && fs.existsSync(existingTokensPath))
  ? JSON.parse(fs.readFileSync(existingTokensPath, 'utf8')) : null;

// Design-System für automatische GV-ID-Auflösung laden
// (Output von: novamira/adrians-export-design-system { what: "all" })
let dsIndex: DsIndex | null = null;
if (designSystemPath) {
  if (!fs.existsSync(designSystemPath)) {
    warn(`--design-system Datei nicht gefunden: ${designSystemPath}`);
  } else {
    try {
      const dsRaw: Record<string, unknown> = JSON.parse(fs.readFileSync(designSystemPath, 'utf8'));
      dsIndex = resolveGvIdsFromDesignSystem(dsRaw);
      log(`Design-System geladen: ${dsIndex.byHex.size} Farb-IDs, ${dsIndex.byLabel.size} Label-IDs (${dsIndex.total} Einträge gesamt)`);
    } catch (e) {
      warn(`Design-System konnte nicht geparst werden: ${(e as Error).message}`);
    }
  }
}

const tokenMapping = generateTokenMapping(tokens, existingMapping, dsIndex);

const outputJson = JSON.stringify(tokenMapping, null, 2);
if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), outputJson, 'utf8');
  process.stderr.write(`token-mapping.json → ${outputPath}\n`);
} else {
  process.stdout.write(outputJson + '\n');
}

if (variablesPlanPath) {
  const plan = buildVariablesPlan(tokenMapping);
  fs.mkdirSync(path.dirname(path.resolve(variablesPlanPath)), { recursive: true });
  fs.writeFileSync(path.resolve(variablesPlanPath), JSON.stringify(plan, null, 2), 'utf8');
  process.stderr.write(`variables-plan.json → ${variablesPlanPath}\n`);
}

process.stderr.write(`${tokenMapping.meta.mappedCount} mapped, ${tokenMapping.meta.unmappedCount} need e-gv-* IDs\n`);
process.exit(0);
// NB: unmapped tokens are normal on first run — they need e-gv-* IDs
//     assigned via batch-create-variables. The variables-plan.json
//     includes the MCP call to do this.
