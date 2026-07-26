#!/usr/bin/env node
/**
 * extract-framer-dark-mode.ts  —  Phase 5: Dark Mode CSS Extraction (ENH-10)
 *
 * Extrahiert @media (prefers-color-scheme: dark) CSS-Blöcke aus Framer-HTML
 * und generiert ein Dark-Mode-Variable-Set für Elementor V4 Global Variables.
 *
 * Usage:
 *   node --import tsx scripts/extract-framer-dark-mode.ts \
 *     --html exports/papaya/index.html \
 *     --light-tokens exports/papaya/tokens/token-mapping.json \
 *     --output exports/papaya/tokens/dark-mode-variables.json
 *
 *   node --import tsx scripts/extract-framer-dark-mode.ts \
 *     --css dark-theme.css \
 *     --output dark-vars.json
 */

import fs   from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface CssDeclaration {
  property: string;
  value: string;
}

interface DarkBlock {
  selector: string;
  declarations: CssDeclaration[];
}

interface ColorOverride {
  selector: string;
  property: string;
  value: string;
  hex: string | null;
}

interface LightColorEntry {
  hex?: string;
  raw?: string;
  gv_id?: string;
}

interface LightTokens {
  colors?: {
    unique?: LightColorEntry[];
  };
}

interface DarkVariable {
  selector: string;
  property: string;
  dark_value: string;
  dark_hex: string | null;
  light_value: string | null;
  light_hex: string | null;
  gv_id: string | null;
  token_name: string;
}

interface DarkModeVariableSet {
  generated: string;
  mode: string;
  version: string;
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
  mcpRouting: {
    ability: string;
    note: string;
  };
  summary: {
    total_variables: number;
    unique_selectors?: number;
    unique_properties?: number;
    matched_with_light_tokens?: number;
    note?: string;
  };
}

// ─────────────────────────────────────────────
// CLI ARGS
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    html:           { type: 'string' },
    css:            { type: 'string' },
    'light-tokens': { type: 'string' },
    output:         { type: 'string' },
    format:         { type: 'string', default: 'json' },
    verbose:        { type: 'boolean', default: false },
    help:           { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help || (!args.html && !args.css)) {
  console.log(`extract-framer-dark-mode.ts — ENH-10 Dark Mode CSS Extraction

ZWECK:
  Extrahiert @media (prefers-color-scheme: dark) CSS-Blöcke aus Framer-HTML
  und generiert ein Dark-Mode-Variable-Set für Elementor V4 Global Variables.

EINGABE:
  --html <file>            Framer HTML-Export
  --css <file>             Alternativ: reine CSS-Datei
  --light-tokens <file>    Light-Mode Token-Mapping (aus design-token-extractor.js)
  --output <file>          Output: dark-mode-variables.json (default: stdout)

OPTIONEN:
  --format json|markdown   Output-Format (default: json)
  --verbose                Detaillierte Logs
  --help                   Diese Hilfe

BEISPIELE:
  node --import tsx scripts/extract-framer-dark-mode.ts \\
    --html exports/papaya/index.html \\
    --light-tokens exports/papaya/tokens/token-mapping.json \\
    --output exports/papaya/tokens/dark-mode-variables.json

  node --import tsx scripts/extract-framer-dark-mode.ts \\
    --css dark-theme.css \\
    --output dark-vars.json

EXIT-CODES:
  0 = Erfolg (auch wenn keine Dark-Mode-Blöcke gefunden)
  2 = Fehlende Eingabe`);
  process.exit(args.help ? 0 : 2);
}

const log = (...m: string[]) => {
  if (args.verbose) process.stderr.write('[dark-mode] ' + m.join(' ') + '\n');
};

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
// DARK MODE BLOCK PARSER
// ─────────────────────────────────────────────

function extractDarkModeBlocks(css: string): DarkBlock[] {
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
        declarations.push({
          property: propMatch[1].trim(),
          value: propMatch[2].trim(),
        });
      }

      if (declarations.length > 0) {
        darkBlocks.push({ selector, declarations });
      }
    }
  }

  return darkBlocks;
}

// ─────────────────────────────────────────────
// COLOR OVERRIDE EXTRACTION
// ─────────────────────────────────────────────

const COLOR_PROPS = new Set([
  'color', 'background-color', 'background',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color',
  'fill', 'stroke', 'outline-color', 'text-decoration-color',
]);

function extractColorOverrides(darkBlocks: DarkBlock[]): ColorOverride[] {
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

      overrides.push({
        selector: block.selector,
        property: decl.property,
        value,
        hex,
      });
    }
  }

  return overrides;
}

// ─────────────────────────────────────────────
// LIGHT-MODE TOKEN MATCHING
// ─────────────────────────────────────────────

function matchLightTokens(overrides: ColorOverride[], lightTokens: LightTokens): DarkVariable[] {
  const lightColors = lightTokens?.colors?.unique || [];
  const hexToLight = new Map<string, LightColorEntry>();

  for (const entry of lightColors) {
    if (entry.hex) hexToLight.set(entry.hex, entry);
  }

  const variables: DarkVariable[] = [];

  for (const override of overrides) {
    if (!override.hex) {
      variables.push({
        selector: override.selector,
        property: override.property,
        dark_value: override.value,
        dark_hex: null,
        light_value: null,
        light_hex: null,
        gv_id: null,
        token_name: suggestDarkTokenName(override.property, override.selector),
      });
      continue;
    }

    const lightMatch = hexToLight.get(override.hex);
    variables.push({
      selector: override.selector,
      property: override.property,
      dark_value: override.value,
      dark_hex: override.hex,
      light_value: lightMatch?.raw || null,
      light_hex: lightMatch?.hex || null,
      gv_id: lightMatch?.gv_id || null,
      token_name: suggestDarkTokenName(override.property, override.selector),
    });
  }

  return variables;
}

function suggestDarkTokenName(property: string, selector: string): string {
  const isBg = property.includes('background');
  const isText = property === 'color';
  const base = isBg ? 'surface' : isText ? 'text' : 'color';
  const cleanSelector = selector
    .replace(/[.#\[\]:>\s,]+/g, '-')
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

// ─────────────────────────────────────────────
// V4 DARK MODE VARIABLE SET GENERATOR
// ─────────────────────────────────────────────

function buildDarkModeVariableSet(variables: DarkVariable[]): DarkModeVariableSet {
  const uniqueSelectors = new Set(variables.map(v => v.selector));
  const uniqueProperties = new Set(variables.map(v => v.property));

  return {
    generated: new Date().toISOString(),
    mode: 'dark',
    version: '1.0',
    variables: variables.map(v => ({
      token_name: v.token_name,
      selector: v.selector,
      property: v.property,
      dark_value: v.dark_value,
      dark_hex: v.dark_hex,
      light_mapping: {
        light_value: v.light_value,
        light_hex: v.light_hex,
        gv_id: v.gv_id,
      },
    })),
    mcpRouting: {
      ability: 'novamira-adrianv2/batch-create-variables',
      note: 'Dark Mode Variable Set — als zusätzliches Set neben Light-Mode anlegen',
    },
    summary: {
      total_variables: variables.length,
      unique_selectors: uniqueSelectors.size,
      unique_properties: uniqueProperties.size,
      matched_with_light_tokens: variables.filter(v => v.gv_id).length,
    },
  };
}

// ─────────────────────────────────────────────
// COLOR NORMALIZATION HELPERS
// ─────────────────────────────────────────────

function normalizeHex(val: string): string | null {
  if (!val) return null;
  val = val.trim().toLowerCase();
  if (val.startsWith('#')) val = val.slice(1);
  if (val.length === 3) val = val[0] + val[0] + val[1] + val[1] + val[2] + val[2];
  if (/^[0-9a-f]{6}$/.test(val)) return '#' + val;
  return null;
}

function rgbaToHex(val: string): string | null {
  const m = val.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return '#' + [m[1], m[2], m[3]]
      .map(n => parseInt(n).toString(16).padStart(2, '0'))
      .join('');
  }
  return null;
}

// ─────────────────────────────────────────────
// OUTPUT HELPERS
// ─────────────────────────────────────────────

function formatMarkdown(data: DarkModeVariableSet): string {
  const lines: string[] = [];
  lines.push('# Dark Mode Variables');
  lines.push('');
  lines.push(`> Generated: ${data.generated}`);
  lines.push(`> Mode: ${data.mode}`);
  lines.push(`> Variables: ${data.summary?.total_variables || 0}`);
  if (data.summary?.matched_with_light_tokens !== undefined) {
    lines.push(`> Matched with Light: ${data.summary.matched_with_light_tokens}`);
  }
  if (data.summary?.note) {
    lines.push(`> Note: ${data.summary.note}`);
  }
  lines.push('');

  if (!data.variables || data.variables.length === 0) {
    lines.push('_No dark mode variables found._');
    return lines.join('\n');
  }

  lines.push('| token_name | selector | property | dark_value | dark_hex | light_value | gv_id |');
  lines.push('|------------|----------|----------|------------|----------|-------------|-------|');

  for (const v of data.variables) {
    const token = (v.token_name || '-').replace(/\|/g, '\\|');
    const sel = (v.selector || '-').replace(/\|/g, '\\|');
    const prop = (v.property || '-').replace(/\|/g, '\\|');
    const darkVal = (v.dark_value || '-').replace(/\|/g, '\\|');
    const darkHex = v.dark_hex || '-';
    const lightVal = (v.light_mapping?.light_value || '-').replace(/\|/g, '\\|');
    const gvId = v.light_mapping?.gv_id || '-';
    lines.push(`| ${token} | ${sel} | ${prop} | ${darkVal} | ${darkHex} | ${lightVal} | ${gvId} |`);
  }

  lines.push('');
  if (data.mcpRouting) {
    lines.push('## MCP Routing');
    lines.push('');
    lines.push(`- **Ability:** \`${data.mcpRouting.ability || 'N/A'}\``);
    lines.push(`- **Note:** ${data.mcpRouting.note || 'N/A'}`);
  }

  return lines.join('\n');
}

function writeOutput(data: DarkModeVariableSet): void {
  const fmt = ((args.format as string) || 'json').toLowerCase();
  let output: string;

  if (fmt === 'markdown' || fmt === 'md') {
    output = formatMarkdown(data);
  } else {
    output = JSON.stringify(data, null, 2);
  }

  const outputPath = args.output as string | undefined;
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf8');
    process.stderr.write(
      `[dark-mode] Saved ${data.summary?.total_variables || 0} dark-mode variables to ${outputPath}\n`
    );
  } else {
    process.stdout.write(output + '\n');
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

let cssContent = '';

const htmlPath = args.html as string | undefined;
const cssPath = args.css as string | undefined;

if (htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    process.stderr.write(`Error: HTML file not found: ${htmlPath}\n`);
    process.exit(2);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  cssContent = extractCssFromHtml(html);
  log(`Extracted ${cssContent.length} chars of CSS from ${htmlPath}`);
} else if (cssPath) {
  if (!fs.existsSync(cssPath)) {
    process.stderr.write(`Error: CSS file not found: ${cssPath}\n`);
    process.exit(2);
  }
  cssContent = fs.readFileSync(cssPath, 'utf8');
}

const darkBlocks = extractDarkModeBlocks(cssContent);
log(`Found ${darkBlocks.length} dark-mode CSS blocks`);

if (darkBlocks.length === 0) {
  const emptyResult: DarkModeVariableSet = {
    generated: new Date().toISOString(),
    mode: 'dark',
    version: '1.0',
    variables: [],
    mcpRouting: {
      ability: 'novamira-adrianv2/batch-create-variables',
      note: 'Dark Mode Variable Set — als zusätzliches Set neben Light-Mode anlegen',
    },
    summary: {
      total_variables: 0,
      note: 'No @media (prefers-color-scheme: dark) blocks found in CSS',
    },
  };
  writeOutput(emptyResult);
  process.exit(0);
}

const overrides = extractColorOverrides(darkBlocks);
log(`Extracted ${overrides.length} color overrides`);

let variables: DarkVariable[];

const lightTokensPath = args['light-tokens'] as string | undefined;
if (lightTokensPath && fs.existsSync(lightTokensPath)) {
  const lightTokens = JSON.parse(fs.readFileSync(lightTokensPath, 'utf8')) as LightTokens;
  variables = matchLightTokens(overrides, lightTokens);
  const matched = variables.filter(v => v.gv_id).length;
  log(`Matched ${matched}/${variables.length} with light tokens`);
} else {
  variables = overrides.map(o => ({
    selector: o.selector,
    property: o.property,
    dark_value: o.value,
    dark_hex: o.hex,
    light_value: null,
    light_hex: null,
    gv_id: null,
    token_name: suggestDarkTokenName(o.property, o.selector),
  }));
}

const result = buildDarkModeVariableSet(variables);

writeOutput(result);
process.exit(0);
