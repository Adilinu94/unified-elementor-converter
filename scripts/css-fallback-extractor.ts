#!/usr/bin/env node
/**
 * css-fallback-extractor.ts  —  Fix #11: Automatischer CSS-Fallback
 *
 * Wird von convert-xml-to-v4.js aufgerufen wenn getProjectXml() keine
 * Style-Daten liefert (Unframer MCP offline oder leere StyleMap).
 *
 * Sprint 20 (Repo-Review Punkt #6): Wiederverwendet fetchPageHtml(),
 * extractStyleBlocks(), extractCssVariables(), extractBreakpoints() aus
 * extract-framer-css-tokens.ts statt eigener, abweichender Regex-Kopien zu
 * pflegen. Eigenständig bleibt nur die `.framer-text-*`-Klassen-Extraktion
 * für textStyles — das macht extract-framer-css-tokens.ts NICHT (sein
 * textStyles-Feld ist ein statischer Platzhalter, siehe TEXT_STYLE_DEFAULTS
 * dort), daher ist das hier der eigentliche Mehrwert dieses Scripts.
 *
 * Strategie:
 *   1. Prüft ob ein Framer-Export-HTML vorhanden ist (--html)
 *   2. Oder crawlt die publizierte Framer-URL (--url), inkl. externer
 *      Stylesheets (via fetchPageHtml aus extract-framer-css-tokens.ts)
 *   3. Extrahiert Farb-Tokens + TextStyle-Klassen
 *   4. Schreibt token-mapping.json + style-map.json als Fallback
 *
 * Kann standalone genutzt werden:
 *   node --import tsx scripts/css-fallback-extractor.ts --url https://foo.framer.app/ --output-dir FramerExport/tokens/
 *
 * Exit-Codes:
 *   0  — Fallback erfolgreich
 *   1  — Kein Fallback verfügbar (weder HTML noch URL)
 *   2  — Fetch-Fehler
 */

import fs   from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { normalizeHex } from './lib/framer-utils.js';
import {
  fetchPageHtml,
  extractStyleBlocks,
  extractCssVariables,
  extractBreakpoints,
} from './extract-framer-css-tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    url:          { type: 'string' },   // Publizierte Framer-URL
    html:         { type: 'string' },   // Lokales FramerExport HTML
    'output-dir': { type: 'string', default: 'FramerExport/tokens' },
    'style-map-output': { type: 'string' },  // Pfad für style-map.json
    'token-output':     { type: 'string' },  // Pfad für token-mapping.json
    verbose:      { type: 'boolean', default: false },
    'dry-run':    { type: 'boolean', default: false }, // Nur prüfen ob Fallback nötig
  },
  strict: false,
});

const log  = (...m: string[]) => { if (args.verbose) process.stderr.write('[css-fallback] ' + m.join(' ') + '\n'); };
const warn = (m: string)       => process.stderr.write(`⚠ [css-fallback] ${m}\n`);
const info = (m: string)       => process.stderr.write(`ℹ [css-fallback] ${m}\n`);

// ─── Types ────────────────────────────────────────────────────────────────────

interface TextStyleEntry {
  fontSize: string | null;
  fontWeight: string | null;
  fontFamily: string | null | undefined;
  lineHeight: string | null;
  letterSpacing: string | null;
  color: null;
}

interface TokenMappingMeta {
  source: string;
  source_type: string;
  generated_at: string;
}

interface BreakpointEntry {
  px: number;
  label: string;
}

interface TokenMapping {
  meta: TokenMappingMeta;
  colors: Record<string, string>;
  textStyles: Record<string, unknown>;
  fonts: unknown[];
  breakpoints: BreakpointEntry[];
}

interface StyleMap {
  textStyles: Record<string, TextStyleEntry>;
  colorStyles: Record<string, string>;
}

interface FallbackResult {
  tokenMapping: TokenMapping;
  styleMap: StyleMap;
}

// ─── Prüfe ob Fallback nötig ist ────────────────────────────────────────────

/**
 * Prüft ob eine style-map.json leer ist (0 textStyles, 0 colorStyles).
 * Gibt true zurück wenn Fallback nötig ist.
 */
export function styleMapIsEmpty(styleMapPath: string): boolean {
  if (!styleMapPath || !fs.existsSync(styleMapPath)) return true;
  try {
    const sm = JSON.parse(fs.readFileSync(styleMapPath, 'utf8')) as Record<string, unknown>;
    const tsCount = Object.keys((sm.textStyles  as Record<string, unknown>) || {}).length;
    const csCount = Object.keys((sm.colorStyles as Record<string, unknown>) || {}).length;
    return tsCount === 0 && csCount === 0;
  } catch {
    return true;
  }
}

/**
 * Crawlt die Framer-URL (inkl. externer Stylesheets) und extrahiert CSS-Tokens.
 * Gibt { tokenMapping, styleMap } zurück oder null bei Fehler.
 */
async function fetchCssTokens(url: string): Promise<FallbackResult | null> {
  info(`CSS-Fallback: Lade Framer-Seite ${url}`);
  try {
    const html = await fetchPageHtml(url); // inkl. <link rel="stylesheet"> Auflösung
    return parseCssFromHtml(html, url);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    warn(`Fetch fehlgeschlagen: ${message}`);
    return null;
  }
}

function loadHtmlTokens(htmlPath: string): FallbackResult | null {
  if (!fs.existsSync(htmlPath)) { warn(`HTML nicht gefunden: ${htmlPath}`); return null; }
  const html = fs.readFileSync(htmlPath, 'utf8');
  return parseCssFromHtml(html, htmlPath);
}

/**
 * Extrahiert CSS-Variablen, Farben, TextStyles aus HTML/CSS.
 * Nutzt die geteilten Extraktoren aus extract-framer-css-tokens.ts für
 * Style-Blöcke/CSS-Variablen/Breakpoints; die .framer-text-*-Klassen-
 * Extraktion (textStyles) bleibt hier, da sie sonst nirgends existiert.
 * Gibt { tokenMapping, styleMap } zurück.
 */
function parseCssFromHtml(html: string, source: string): FallbackResult {
  const styleBlocks = extractStyleBlocks(html);
  const css = styleBlocks.join('\n');

  // ── Farb-Tokens (CSS Custom Properties) — via extract-framer-css-tokens.ts ──
  // extractCssVariables() liefert name bereits MIT führendem "--" (kein Re-Prefix nötig)
  const cssVars = extractCssVariables(styleBlocks);
  const colorMap: Record<string, string> = {};
  for (const v of cssVars) {
    const hex = normalizeHex(v.value);
    if (hex) colorMap[v.name] = hex;
  }
  log(`CSS-Fallback: ${Object.keys(colorMap).length} Farb-Tokens gefunden`);

  // ── TextStyles aus CSS-Klassen (eigenständige Logik, kein Duplikat) ─────────
  // Framer rendert TextStyles als .framer-text-* Klassen. Weder
  // extract-framer-css-tokens.ts noch extract-framer-styles.ts extrahieren
  // benannte Style-Klassen in dieses style-map.json-Schema — das ist der
  // eigentliche Mehrwert dieses Scripts gegenüber den bestehenden Extraktoren.
  const textStyles: Record<string, TextStyleEntry> = {};
  const classRe = /\.(framer-[\w-]+)\s*\{([^}]+)\}/g;
  let cr: RegExpExecArray | null;
  while ((cr = classRe.exec(css)) !== null) {
    const className = cr[1];
    const body = cr[2];
    if (!body.includes('font-size') && !body.includes('font-family')) continue;

    const get = (prop: string): string | null => {
      const r = new RegExp(`${prop}\\s*:\\s*([^;]+)`);
      const match = r.exec(body);
      return match ? match[1].trim() : null;
    };

    textStyles[`/${className}`] = {
      fontSize:      get('font-size'),
      fontWeight:    get('font-weight'),
      fontFamily:    get('font-family')?.replace(/['"]/g, ''),
      lineHeight:    get('line-height'),
      letterSpacing: get('letter-spacing'),
      color:         null,
    };
  }
  log(`CSS-Fallback: ${Object.keys(textStyles).length} TextStyle-Klassen gefunden`);

  // ── Breakpoints — via extract-framer-css-tokens.ts ──────────────────────────
  // extractBreakpoints() liefert [{ label, width: "810px", raw: 810 }], absteigend sortiert
  const rawBreakpoints = extractBreakpoints(styleBlocks);
  const breakpoints: BreakpointEntry[] = rawBreakpoints
    .map(b => b.raw)
    .filter((px, i, arr): px is number => typeof px === 'number' && arr.indexOf(px) === i)
    .map(px => ({ px, label: px <= 480 ? 'mobile' : 'tablet' }));

  const tokenMapping: TokenMapping = {
    meta: { source, source_type: 'css-fallback', generated_at: new Date().toISOString() },
    colors: colorMap,
    textStyles: {},
    fonts: [],
    breakpoints,
  };

  const styleMap: StyleMap = { textStyles, colorStyles: colorMap };

  return { tokenMapping, styleMap };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!args.url && !args.html) {
    process.stderr.write('Nutzung: node --import tsx scripts/css-fallback-extractor.ts --url <framer-url> | --html <export.html>\n');
    process.stderr.write('Options: --output-dir, --style-map-output, --token-output, --verbose, --dry-run\n');
    process.exit(1);
  }

  let result: FallbackResult | null = null;
  if (args.html) {
    result = loadHtmlTokens(args.html as string);
  } else if (args.url) {
    result = await fetchCssTokens(args.url as string);
  }

  if (!result) {
    process.stderr.write('[css-fallback] Kein CSS-Fallback verfügbar.\n');
    process.exit(2);
  }

  if (args['dry-run']) {
    process.stderr.write(`[css-fallback] Dry-run: ${Object.keys(result.styleMap.textStyles).length} TextStyles, ${Object.keys(result.styleMap.colorStyles).length} Colors würden extrahiert.\n`);
    process.exit(0);
  }

  const outDir = args['output-dir'] as string;
  fs.mkdirSync(outDir, { recursive: true });

  const styleMapPath  = (args['style-map-output'] as string | undefined) || path.join(outDir, 'style-map.json');
  const tokenMapPath  = (args['token-output'] as string | undefined)      || path.join(outDir, 'token-mapping-css-fallback.json');

  fs.writeFileSync(styleMapPath, JSON.stringify(result.styleMap, null, 2), 'utf8');
  fs.writeFileSync(tokenMapPath, JSON.stringify(result.tokenMapping, null, 2), 'utf8');

  const tsCount = Object.keys(result.styleMap.textStyles).length;
  const csCount = Object.keys(result.styleMap.colorStyles).length;
  process.stderr.write(`✓ CSS-Fallback: ${tsCount} TextStyles, ${csCount} Farben → ${styleMapPath}\n`);
  process.stderr.write(`✓ Token-Mapping → ${tokenMapPath}\n`);
}

// Nur ausführen wenn direkt aufgerufen (nicht wenn importiert)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`FATAL [css-fallback]: ${message}\n`);
    process.exit(2);
  });
}
