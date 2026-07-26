#!/usr/bin/env node
/**
 * design-system-builder.ts — Phase 3: Design-System-Automatisierung
 *
 * Usage:
 *   node --import tsx scripts/design-system-builder.ts \
 *     --token-map token-mapping.json \
 *     --output-dir FramerExport/design-system/
 */

import fs   from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { normalizeHex } from './lib/framer-utils.js';
import type { DesignToken } from '../src/shared-schemas/design-tokens.js';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface TextStyleToken {
  size?: number;
  weight?: number;
  lineHeight?: number;
  color?: string;
}

interface FontSource {
  weight: string;
  style: string;
  url: string;
  display?: string;
  source?: string;
}

interface FontToken {
  family: string;
  weights?: string[];
  sources: FontSource[];
  gv_id?: string;
}

interface TokenMap {
  colors?: DesignToken[];
  textStyles?: Record<string, TextStyleToken>;
  fonts?: FontToken[] | Record<string, FontToken>;
}

interface DesignVariable {
  id: string;
  label: string;
  type: string;
  value: string;
  source_path?: string;
  matched_by?: string;
  weights?: string[];
  sources?: FontSource[];
  gv_id?: string;
}

interface VariantProps {
  [key: string]: {
    '$$type': string;
    value: unknown;
  };
}

interface GlobalClass {
  id: string;
  label: string;
  type: string;
  source_path: string;
  gv_ref?: string;
  variants: Array<{ meta: { breakpoint: null; state: null }; props: VariantProps }>;
}

interface FontResolutionEntry {
  family: string;
  weight: string;
  style: string;
  url: string;
  display?: string;
  source?: string;
  gv_id?: string;
  needs_upload: boolean;
}

interface FontResolution {
  fonts: FontResolutionEntry[];
}

interface BatchCreatePlan {
  meta: {
    generated_at: string;
    total_variables: number;
    strategy: string;
  };
  mcp_call: {
    ability_name: string;
    parameters: {
      variables: Array<{ label: string; type: string; value: string }>;
    };
  };
  instructions: string[];
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'token-map':     { type: 'string' },
    'output-dir':    { type: 'string' },
    'namespace':     { type: 'string', default: 'framer' },
    verbose:         { type: 'boolean', default: false },
  },
  strict: false,
});

const tokenMapPath: string | undefined = args['token-map'] as string | undefined;
const outDir: string = (args['output-dir'] as string) || path.dirname(path.resolve(tokenMapPath || '.'));
const NS: string = (args.namespace as string) || 'framer';

const log = (...m: string[]) => { if (args.verbose) process.stderr.write('[ds-builder] ' + m.join(' ') + '\n'); };

if (!tokenMapPath) {
  process.stderr.write('Error: --token-map required\n');
  process.exit(2);
}

const tokenMap: TokenMap = JSON.parse(fs.readFileSync(tokenMapPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

// ─────────────────────────────────────────────
// FONT-FORMAT NORMALIZATION
// ─────────────────────────────────────────────

function getFontsArray(tm: TokenMap): FontToken[] {
  const fonts = tm.fonts;
  if (!fonts) return [];
  if (Array.isArray(fonts)) return fonts;
  return Object.values(fonts).filter(Boolean);
}

// ─────────────────────────────────────────────
// MD5-BASED GV-ID GENERATION
// ─────────────────────────────────────────────

function generateGvId(name: string, type: string): string {
  const hash = createHash('md5')
    .update(`novamira:${NS}:${type}:${name}`)
    .digest('hex')
    .slice(0, 7);
  return `e-gv-${hash}`;
}

function generateGcId(name: string): string {
  const hash = createHash('md5')
    .update(`novamira:${NS}:gc:${name}`)
    .digest('hex')
    .slice(0, 12);
  return `gc-${hash}`;
}

// ─────────────────────────────────────────────
// BUILD VARIABLES
// ─────────────────────────────────────────────

function buildVariables(tm: TokenMap): DesignVariable[] {
  const variables: DesignVariable[] = [];

  for (const data of (tm.colors || [])) {
    const label = data.id.replace(/\//g, ' / ').replace(/\s+/g, ' ').trim();
    const gvId = generateGvId(data.id, 'color');
    variables.push({
      id: gvId,
      label,
      type: 'color',
      value: data.hex,
      source_path: data.id,
      matched_by: 'manual',
    });
    data.gv_id = gvId;
  }

  for (const font of getFontsArray(tm)) {
    const gvId = generateGvId(font.family, 'font');
    variables.push({
      id: gvId,
      label: font.family,
      type: 'font',
      value: font.family,
      weights: font.weights,
      sources: font.sources,
    });
    font.gv_id = gvId;
  }

  return variables;
}

// ─────────────────────────────────────────────
// BUILD GLOBAL CLASSES
// ─────────────────────────────────────────────

function buildGlobalClasses(tm: TokenMap, variables: DesignVariable[]): GlobalClass[] {
  const classes: GlobalClass[] = [];

  for (const [stylePath, data] of Object.entries(tm.textStyles || {})) {
    const label = stylePath.split('/').pop()!.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
    const gcId = generateGcId(stylePath);
    const props: VariantProps = {};

    if (data.size)       props['font-size']   = { '$$type': 'size', value: { size: parseFloat(String(data.size)), unit: 'px' } };
    if (data.weight)     props['font-weight'] = { '$$type': 'string', value: String(data.weight) };
    if (data.lineHeight) props['line-height'] = { '$$type': 'size', value: { size: parseFloat(String(data.lineHeight)), unit: 'custom' } };
    if (data.color)      props['color']       = { '$$type': 'color', value: data.color };

    if (Object.keys(props).length === 0) continue;

    classes.push({
      id: gcId,
      label,
      type: 'typography',
      source_path: stylePath,
      variants: [{ meta: { breakpoint: null, state: null }, props }],
    });
  }

  for (const data of (tm.colors || [])) {
    const label = ('bg-' + data.id.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()).slice(0, 50);
    const gcId = generateGcId(`bg-${data.id}`);

    classes.push({
      id: gcId,
      label,
      type: 'background',
      source_path: data.id,
      gv_ref: data.gv_id,
      variants: [{
        meta: { breakpoint: null, state: null },
        props: {
          'background': {
            '$$type': 'background',
            value: { color: { '$$type': 'global-color-variable', value: data.gv_id } },
          },
        },
      }],
    });
  }

  return classes;
}

// ─────────────────────────────────────────────
// BUILD BATCH-CREATE PLAN
// ─────────────────────────────────────────────

function buildBatchCreatePlan(variables: DesignVariable[]): BatchCreatePlan {
  const newVars = variables.filter(v => v.type === 'color' || v.type === 'font');
  return {
    meta: {
      generated_at: new Date().toISOString(),
      total_variables: newVars.length,
      strategy: 'skip',
    },
    mcp_call: {
      ability_name: 'novamira-adrianv2/batch-create-variables',
      parameters: {
        variables: newVars.map(v => ({
          label: v.label,
          type: v.type,
          value: v.value,
        })),
      },
    },
    instructions: [
      '1. session-start-checklist → setup-v4-foundation (frische IDs holen)',
      '2. batch-create-variables via MCP mit obigem mcp_call',
      '3. export-design-system what=all → IDs verifizieren',
      '4. convert-xml-to-v4.js --tokens token-mapping-updated.json',
    ],
  };
}

// ─────────────────────────────────────────────
// BUILD FONT-RESOLUTION
// ─────────────────────────────────────────────

function buildFontResolution(tm: TokenMap): FontResolution {
  const fonts: FontResolutionEntry[] = [];
  for (const font of getFontsArray(tm)) {
    for (const src of font.sources) {
      fonts.push({
        family: font.family,
        weight: src.weight,
        style: src.style,
        url: src.url,
        display: src.display,
        source: src.source,
        gv_id: font.gv_id,
        needs_upload: src.source === 'framer-cdn',
      });
    }
  }
  return { fonts };
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

log('Building design system from:', tokenMapPath);

// Step 1: Variables
const variables = buildVariables(tokenMap);
log(`Generated ${variables.length} variables`);

const variablesPath = path.join(outDir, 'variables.json');
fs.writeFileSync(variablesPath, JSON.stringify({
  meta: { generated_at: new Date().toISOString(), total: variables.length },
  variables,
}, null, 2), 'utf8');
process.stderr.write(`✓ variables.json → ${variablesPath} (${variables.length} variables)\n`);

// Step 2: Global Classes
const classes = buildGlobalClasses(tokenMap, variables);
log(`Generated ${classes.length} global classes`);

const classesPath = path.join(outDir, 'global-classes.json');
fs.writeFileSync(classesPath, JSON.stringify({
  meta: { generated_at: new Date().toISOString(), total: classes.length },
  classes,
}, null, 2), 'utf8');
process.stderr.write(`✓ global-classes.json → ${classesPath} (${classes.length} classes)\n`);

// Step 3: Updated token mapping
const tokenMapOutPath = path.join(outDir, 'token-mapping-updated.json');
fs.writeFileSync(tokenMapOutPath, JSON.stringify(tokenMap, null, 2), 'utf8');
process.stderr.write(`✓ token-mapping-updated.json → ${tokenMapOutPath}\n`);

// Step 4: Batch-create plan
const plan = buildBatchCreatePlan(variables);
const planPath = path.join(outDir, 'batch-create-plan.json');
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
process.stderr.write(`✓ batch-create-plan.json → ${planPath}\n`);

// Step 5: Font resolution
const fontRes = buildFontResolution(tokenMap);
const fontPath = path.join(outDir, 'font-resolution.json');
fs.writeFileSync(fontPath, JSON.stringify(fontRes, null, 2), 'utf8');
process.stderr.write(`✓ font-resolution.json → ${fontPath} (${fontRes.fonts.length} fonts)\n`);

// Summary
process.stderr.write([
  '\n📊 Design System Summary:',
  `  ${variables.length} variables (${variables.filter(v => v.type === 'color').length} colors, ${variables.filter(v => v.type === 'font').length} fonts)`,
  `  ${classes.length} global classes`,
  `  ${fontRes.fonts.length} font entries`,
  `  ${fontRes.fonts.filter(f => f.needs_upload).length} fonts need upload`,
].join('\n') + '\n');

process.exit(0);
