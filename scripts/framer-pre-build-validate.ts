#!/usr/bin/env node
/**
 * framer-pre-build-validate.ts  —  Phase 1.5: Framer-spezifische Pre-Build Validation
 * Führt 16 Guards auf einem V4 Widget-Tree aus. Blockiert den Build bei Fehlern.
 *
 * Usage:
 *   node --import tsx scripts/framer-pre-build-validate.ts \
 *     --tree        FramerExport/v4-tree/hero-section.json \
 *     --tokens      FramerExport/tokens/token-mapping.json \
 *     --fonts       FramerExport/tokens/font-resolution.json \
 *     --breakpoints FramerExport/tokens/responsive-breakpoints.json \
 *     --output      FramerExport/tokens/pre-build-validation.json
 *
 * Exit-Codes:
 *   0 = Score ≥ 85% (Build erlaubt)
 *   1 = Score < 85% (Build blockiert)
 */

import fs   from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeHex, walkTree, extractGvIds } from './lib/framer-utils.js';
import type { DesignToken } from '../src/shared-schemas/design-tokens.js';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

type GuardStatus = 'PASS' | 'FAIL' | 'WARN';
type GuardSeverity = 'error' | 'warning';

interface GuardResult {
  id: string;
  status: GuardStatus;
  severity?: GuardSeverity;
  message: string;
  details?: Record<string, unknown>;
}

interface TokenMapping {
  colors?: DesignToken[];
  fonts?: Record<string, string | { gv_id?: string }>;
  [key: string]: unknown;
}

interface FontEntry {
  status?: string;
  gv_id?: string;
}

interface FontData {
  fonts?: FontEntry[];
}

interface StyleDef {
  variants?: VariantEntry[];
}

interface VariantEntry {
  meta?: {
    breakpoint?: string | null;
  };
  [key: string]: unknown;
}

interface ImageValue {
  id?: unknown;
  url?: unknown;
}

interface GuardDetailEntry {
  nodeId?: string;
  styleId?: string;
  gvId?: string;
  path?: string;
  issue?: string;
  fix?: string;
  severity?: string;
  breakpoint?: string | null;
  classesValue?: string[];
  value?: string | number;
  parentType?: string | null;
  where?: string;
  className?: string;
  family?: string;
  id?: string;
  occurrences?: number;
  elType?: string;
  widgetType?: string;
  firstBreakpoint?: unknown;
}

interface GuardDetail {
  missing?: GuardDetailEntry[];
  mismatches?: GuardDetailEntry[];
  unresolved?: GuardDetailEntry[];
  invalidBreakpoints?: GuardDetailEntry[];
  unbound?: GuardDetailEntry[];
  found?: GuardDetailEntry[];
  unquoted?: GuardDetailEntry[];
  wrongBase?: GuardDetailEntry[];
  missingTablet?: GuardDetailEntry[];
  hardcoded?: GuardDetailEntry[];
  invalid?: GuardDetailEntry[];
  offenders?: GuardDetailEntry[];
  violations?: GuardDetailEntry[];
  duplicates?: GuardDetailEntry[];
}

interface ValidationResult {
  meta: {
    treeFile: string | true | undefined;
    treeNodes: number;
    checksRun: number;
    passed: number;
    warnings: number;
    errors: number;
    score: number;
  };
  guards: GuardResult[];
  summary: {
    status: 'BLOCKED' | 'OK';
    reason: string;
    action: string;
  };
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    tree:         { type: 'string' },
    tokens:       { type: 'string' },
    fonts:        { type: 'string' },
    breakpoints:  { type: 'string' },
    output:       { type: 'string' },
    verbose:      { type: 'boolean', default: false },
  },
  strict: false,
});

// Help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node --import tsx scripts/framer-pre-build-validate.ts [options]');
  console.log('  --tree <path>         V4 Widget Tree JSON (required)');
  console.log('  --tokens <path>       Token Mapping JSON');
  console.log('  --fonts <path>        Font Resolution JSON');
  console.log('  --breakpoints <path>  Responsive Breakpoints JSON');
  console.log('  --output <path>       Write result to file');
  console.log('  --verbose             Extra debug output');
  process.exit(0);
}

const log = (...m: string[]) => { if (args.verbose) process.stderr.write('[verbose] ' + m.join(' ') + '\n'); };

if (!args.tree) {
  process.stderr.write('Error: --tree erforderlich\n');
  process.exit(1);
}

// ─────────────────────────────────────────────
// LOAD INPUTS
// ─────────────────────────────────────────────

function loadJson(filePath: string | undefined, label: string): unknown {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Warning: ${label} nicht gefunden: ${filePath}\n`);
    return null;
  }
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e: unknown) { process.stderr.write(`Error: ${label} JSON parse failed: ${(e as Error).message}\n`); return null; }
}

const tree         = loadJson(args.tree as string | undefined,        'V4 Tree');
const tokenMapping = loadJson(args.tokens as string | undefined,      'Token Mapping') as TokenMapping | null;
const fontData     = loadJson(args.fonts as string | undefined,       'Font Resolution') as FontData | null;
const breakpointData = loadJson(args.breakpoints as string | undefined, 'Breakpoints');

if (!tree) { process.stderr.write('Error: Tree konnte nicht geladen werden.\n'); process.exit(1); }

// ─────────────────────────────────────────────
// HELPER: Build Sets from mapping files
// ─────────────────────────────────────────────

// All valid gv_ids from token-mapping.json
const knownGvIds = new Set<string>();
if (tokenMapping) {
  const colors = tokenMapping.colors || {};
  for (const c of Object.values(colors)) {
    if (typeof c === 'string' && c.startsWith('e-gv-')) knownGvIds.add(c);
    if (typeof c === 'object' && c !== null && (c as Record<string, unknown>).gv_id) {
      knownGvIds.add((c as Record<string, unknown>).gv_id as string);
    }
  }
  const fonts = tokenMapping.fonts || {};
  for (const f of Object.values(fonts)) {
    if (typeof f === 'string' && f.startsWith('e-gv-')) knownGvIds.add(f);
    if (typeof f === 'object' && f !== null && (f as Record<string, unknown>).gv_id) {
      knownGvIds.add((f as Record<string, unknown>).gv_id as string);
    }
  }
  for (const val of Object.values(tokenMapping)) {
    if (typeof val === 'string' && val.startsWith('e-gv-')) knownGvIds.add(val);
  }
}
log(`Known gv_ids: ${String(knownGvIds.size)}`);

// Resolved font gv_ids
const resolvedFontGvIds = new Set<string>();
if (fontData) {
  for (const f of (fontData.fonts || [])) {
    if (f.status === 'RESOLVED' && f.gv_id) resolvedFontGvIds.add(f.gv_id);
  }
  // Also load from tokenMapping for cross-reference
  const tmFonts = tokenMapping?.fonts || {};
  for (const f of Object.values(tmFonts)) {
    if (typeof f === 'object' && f !== null && (f as Record<string, unknown>).gv_id) {
      resolvedFontGvIds.add((f as Record<string, unknown>).gv_id as string);
    }
  }
}

// Valid breakpoint names
const validBreakpoints = new Set<string | null>([null, 'tablet', 'mobile', 'desktop']);

// ─────────────────────────────────────────────
// TREE COLLECTION HELPERS
// ─────────────────────────────────────────────

/** Collect all nodes in tree */
function collectNodes(tree: unknown): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const root = Array.isArray(tree) ? tree : [tree];
  for (const n of root) walkTree(n, node => nodes.push(node));
  return nodes;
}

/** Recursively walk all values in a JSON object with path tracking */
function walkValues(
  obj: unknown,
  callback: (key: string, val: unknown, parent: Record<string, unknown>, path: string) => void,
  pathStr = 'root',
  seen = new WeakSet<object>(),
): void {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
  seen.add(obj);
  const rec = obj as Record<string, unknown>;
  for (const [key, val] of Object.entries(rec)) {
    const p = `${pathStr}.${key}`;
    callback(key, val, rec, p);
    if (val && typeof val === 'object') walkValues(val, callback, p, seen);
  }
}

/** Collect all variants from all style objects in tree */
function collectVariants(nodes: Record<string, unknown>[]): { nodeId: unknown; styleId: string; variant: VariantEntry }[] {
  const variants: { nodeId: unknown; styleId: string; variant: VariantEntry }[] = [];
  for (const node of nodes) {
    const styles = (node.styles || {}) as Record<string, StyleDef>;
    for (const [styleId, styleDef] of Object.entries(styles)) {
      for (const variant of (styleDef.variants || [])) {
        variants.push({ nodeId: node.id, styleId, variant });
      }
    }
  }
  return variants;
}

// ─────────────────────────────────────────────
// THE 16 GUARDS
// ─────────────────────────────────────────────

const nodes = collectNodes(tree);
const allVariants = collectVariants(nodes);
log(`Nodes collected: ${nodes.length}, variants: ${allVariants.length}`);

// ── 1. TOKEN_EXISTENCE ──────────────────────────
function g1_TokenExistence(): GuardResult {
  const missing: GuardDetailEntry[] = [];
  for (const node of nodes) {
    const gvIds = extractGvIds(node);
    for (const gvId of gvIds) {
      if (!knownGvIds.has(gvId)) missing.push({ nodeId: node.id as string, gvId });
    }
  }
  if (missing.length === 0) {
    return { id: 'TOKEN_EXISTENCE', status: 'PASS', message: `All ${knownGvIds.size} e-gv-* IDs found in token-mapping.json` };
  }
  return {
    id: 'TOKEN_EXISTENCE', status: 'FAIL', severity: 'error',
    message: `${missing.length} e-gv-* ID(s) not found in token-mapping.json`,
    details: { missing: missing.slice(0, 10) },
  };
}

// ── 2. COLOR_CONSISTENCY ────────────────────────
function g2_ColorConsistency(): GuardResult {
  const mismatches: GuardDetailEntry[] = [];
  for (const node of nodes) {
    walkValues(node.styles, (key, val, parent, p) => {
      if (parent['$$type'] === 'global-color-variable' && typeof val === 'string' && val.startsWith('e-gv-')) {
        const tmColors = tokenMapping?.colors || {};
        const entry = Object.values(tmColors).find(c =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>).gv_id === val
        );
        if (entry && typeof entry === 'object' && entry !== null) {
          const entryRec = entry as Record<string, unknown>;
          const hex = entryRec.hex as string | undefined;
          if (hex) {
            const normalized = normalizeHex(hex);
            if (!normalized) mismatches.push({ path: p, gvId: val, issue: `Hex ungültig: ${hex}` });
          }
        } else {
          mismatches.push({ path: p, gvId: val, issue: 'gv_id nicht in tokenMapping.colors' });
        }
      }
    });
  }
  if (mismatches.length === 0) {
    return { id: 'COLOR_CONSISTENCY', status: 'PASS', message: 'All color references resolve to valid hex values' };
  }
  return {
    id: 'COLOR_CONSISTENCY', status: 'FAIL', severity: 'error',
    message: `${mismatches.length} color consistency issue(s) found`,
    details: { mismatches: mismatches.slice(0, 5) },
  };
}

// ── 3. FONT_RESOLUTION ──────────────────────────
function g3_FontResolution(): GuardResult {
  const unresolved: GuardDetailEntry[] = [];
  for (const node of nodes) {
    walkValues(node.styles, (key, val, parent, p) => {
      if (parent['$$type'] === 'global-font-variable' && typeof val === 'string' && val.startsWith('e-gv-')) {
        if (!knownGvIds.has(val)) {
          unresolved.push({ path: p, gvId: val, nodeId: node.id as string });
        }
      }
    });
  }
  if (unresolved.length === 0) {
    return { id: 'FONT_RESOLUTION', status: 'PASS', message: 'All font variables resolved' };
  }
  return {
    id: 'FONT_RESOLUTION', status: 'FAIL', severity: 'error',
    message: `${unresolved.length} font variable(s) not resolved`,
    details: { unresolved },
  };
}

// ── 4. BREAKPOINT_CONSISTENCY ───────────────────
function g4_BreakpointConsistency(): GuardResult {
  const invalidBps: GuardDetailEntry[] = [];
  for (const { nodeId, styleId, variant } of allVariants) {
    const bp = variant.meta?.breakpoint;
    if (bp !== undefined && !validBreakpoints.has(bp)) {
      invalidBps.push({ nodeId: nodeId as string, styleId: styleId, breakpoint: bp });
    }
  }
  if (invalidBps.length === 0) {
    return { id: 'BREAKPOINT_CONSISTENCY', status: 'PASS', message: 'All breakpoint values are valid' };
  }
  return {
    id: 'BREAKPOINT_CONSISTENCY', status: 'WARN', severity: 'warning',
    message: `${invalidBps.length} variant(s) with unknown breakpoint value`,
    details: { invalidBreakpoints: invalidBps },
  };
}

// ── 5. STYLE_CLASSES_BINDING ────────────────────
function g5_StyleClassesBinding(): GuardResult {
  const unbound: GuardDetailEntry[] = [];
  for (const node of nodes) {
    const settings = (node.settings || {}) as Record<string, unknown>;
    const classes = settings.classes;
    const classesValue: unknown[] = Array.isArray(classes)
      ? classes
      : ((classes as Record<string, unknown> | null)?.value as unknown[]) || [];
    const styles = (node.styles || {}) as Record<string, StyleDef>;
    for (const styleId of Object.keys(styles)) {
      if (!classesValue.includes(styleId)) {
        unbound.push({ nodeId: node.id as string, styleId, classesValue: classesValue as string[] });
      }
    }
  }
  if (unbound.length === 0) {
    return { id: 'STYLE_CLASSES_BINDING', status: 'PASS', message: 'All style IDs are bound in settings.classes.value[]' };
  }
  return {
    id: 'STYLE_CLASSES_BINDING', status: 'FAIL', severity: 'error',
    message: `${unbound.length} style ID(s) not bound in settings.classes.value[]`,
    details: { unbound },
  };
}

// ── 6. NO_HARDCODED_HEX ─────────────────────────
function g6_NoHardcodedHex(): GuardResult {
  const found: GuardDetailEntry[] = [];
  for (const node of nodes) {
    walkValues(node.styles, (key, val, parent, p) => {
      if (parent['$$type'] === 'color') return;
      if (typeof val === 'string' && /^#[0-9a-fA-F]{3,6}$/.test(val.trim())) {
        found.push({ path: p, value: val, nodeId: node.id as string, parentType: (parent['$$type'] as string) || null });
      }
    });
  }
  if (found.length === 0) {
    return { id: 'NO_HARDCODED_HEX', status: 'PASS', message: 'No hardcoded hex colors found in tree styles' };
  }
  return {
    id: 'NO_HARDCODED_HEX', status: 'FAIL', severity: 'error',
    message: `${found.length} hardcoded hex color(s) found (use global-color-variable instead)`,
    details: { found: found.slice(0, 10) },
  };
}

// ── 7. NO_PLAIN_STRINGS ─────────────────────────
function g7_NoPlainStrings(): GuardResult {
  const found: GuardDetailEntry[] = [];
  for (const node of nodes) {
    walkValues({ styles: node.styles, settings: node.settings }, (key, val, parent, p) => {
      if (typeof val === 'string' && val.startsWith('e-gv-')) {
        const parentType = (parent['$$type'] as string) || '';
        if (!parentType.includes('variable')) {
          found.push({ path: p, value: val, parentType: parentType || '(none)' });
        }
      }
    });
  }
  if (found.length === 0) {
    return { id: 'NO_PLAIN_STRINGS', status: 'PASS', message: 'No plain e-gv-* strings found (all properly $$type-wrapped)' };
  }
  return {
    id: 'NO_PLAIN_STRINGS', status: 'FAIL', severity: 'error',
    message: `${found.length} plain e-gv-* string(s) not wrapped in {$$type: "global-*-variable"}`,
    details: { found },
  };
}

// ── 8. FONT_NAMES_QUOTED ────────────────────────
function g8_FontNamesQuoted(): GuardResult {
  const unquoted: GuardDetailEntry[] = [];
  for (const node of nodes) {
    walkValues(node.styles, (key, val, parent, p) => {
      if (key === 'font-family' && parent['$$type'] === 'string') {
        const family = parent.value;
        if (typeof family === 'string' && family.includes(' ') && !family.startsWith('"') && !family.startsWith("'")) {
          unquoted.push({ path: p, family, nodeId: node.id as string });
        }
      }
    });
  }
  if (unquoted.length === 0) {
    return { id: 'FONT_NAMES_QUOTED', status: 'PASS', message: 'All multi-word font names are quoted or use gv variables' };
  }
  return {
    id: 'FONT_NAMES_QUOTED', status: 'WARN', severity: 'warning',
    message: `${unquoted.length} multi-word font name(s) missing quotes (will fail CSS output)`,
    details: { unquoted },
  };
}

// ── 9. BASE_VARIANT_NULL ────────────────────────
function g9_BaseVariantNull(): GuardResult {
  const wrongBase: GuardDetailEntry[] = [];
  for (const node of nodes) {
    const styles = (node.styles || {}) as Record<string, StyleDef>;
    for (const [styleId, styleDef] of Object.entries(styles)) {
      const variants = styleDef.variants || [];
      if (variants.length > 0 && variants[0].meta?.breakpoint !== null) {
        wrongBase.push({ nodeId: node.id as string, styleId, firstBreakpoint: variants[0].meta?.breakpoint });
      }
    }
  }
  if (wrongBase.length === 0) {
    return { id: 'BASE_VARIANT_NULL', status: 'PASS', message: 'All base variants have breakpoint: null' };
  }
  return {
    id: 'BASE_VARIANT_NULL', status: 'FAIL', severity: 'error',
    message: `${wrongBase.length} style(s) have a non-null breakpoint as first variant`,
    details: { wrongBase },
  };
}

// ── 10. TABLET_VARIANTS ─────────────────────────
function g10_TabletVariants(): GuardResult {
  const missingTablet: GuardDetailEntry[] = [];
  for (const node of nodes) {
    const styles = (node.styles || {}) as Record<string, StyleDef>;
    for (const [styleId, styleDef] of Object.entries(styles)) {
      const variants  = styleDef.variants || [];
      const hasMobile = variants.some(v => v.meta?.breakpoint === 'mobile');
      const hasTablet = variants.some(v => v.meta?.breakpoint === 'tablet');
      if (hasMobile && !hasTablet) {
        missingTablet.push({ nodeId: node.id as string, styleId });
      }
    }
  }
  if (missingTablet.length === 0) {
    return { id: 'TABLET_VARIANTS', status: 'PASS', message: 'All responsive elements have tablet variant' };
  }
  return {
    id: 'TABLET_VARIANTS', status: 'WARN', severity: 'warning',
    message: `${missingTablet.length} element(s) have mobile variant but no tablet variant`,
    details: { missingTablet: missingTablet.map(m => ({ nodeId: m.nodeId, styleId: m.styleId })) },
  };
}

// ── 11. BACKGROUND_COLOR_GC ─────────────────────
function g11_BackgroundColorGC(): GuardResult {
  const hardcoded: GuardDetailEntry[] = [];
  for (const node of nodes) {
    walkValues(node.styles, (key, val, parent, p) => {
      if (key === 'background.color' && parent['$$type'] === 'color') {
        hardcoded.push({ path: p, value: parent.value as string, nodeId: node.id as string });
      }
    });
  }
  if (hardcoded.length === 0) {
    return { id: 'BACKGROUND_COLOR_GC', status: 'PASS', message: 'All background.color props use global color variables' };
  }
  return {
    id: 'BACKGROUND_COLOR_GC', status: 'FAIL', severity: 'error',
    message: `${hardcoded.length} background.color prop(s) use hardcoded color instead of global-color-variable`,
    details: { hardcoded },
  };
}

// ── 12. IMAGE_SRC_FORMAT ────────────────────────
function g12_ImageSrcFormat(): GuardResult {
  const invalid: GuardDetailEntry[] = [];
  for (const node of nodes) {
    const seenPaths = new Set<string>();
    walkValues({ settings: node.settings, styles: node.styles }, (key, val, parent, p) => {
      if (parent['$$type'] === 'image-src') {
        const parentPath = p.slice(0, p.lastIndexOf('.')) || p;
        if (seenPaths.has(parentPath)) return;
        seenPaths.add(parentPath);
        const imageValue = (parent.value && typeof parent.value === 'object' ? parent.value : parent) as ImageValue;
        const hasId = imageValue.id !== undefined && imageValue.id !== null;
        const hasUrl = imageValue.url !== undefined && imageValue.url !== null;
        if (!hasId && !hasUrl) {
          invalid.push({ path: p, issue: 'Both id and url are missing/null — exactly one must be non-null', nodeId: node.id as string });
        }
        if (hasId && hasUrl) {
          invalid.push({ path: p, issue: 'Both id and url are non-null — exactly one must be non-null. Omit url when id is set.', nodeId: node.id as string });
        }
        if ('url' in imageValue && imageValue.url === null) {
          invalid.push({ path: p, issue: 'url: null is present — omit the url key entirely (PHP sanitize strips null)', nodeId: node.id as string });
        }
      }
    });
  }
  if (invalid.length === 0) {
    return { id: 'IMAGE_SRC_FORMAT', status: 'PASS', message: 'All image-src objects have correct format (exactly-one-non-null, no url: null)' };
  }
  return {
    id: 'IMAGE_SRC_FORMAT', status: 'FAIL', severity: 'error',
    message: `${invalid.length} image-src format issue(s) found`,
    details: { invalid },
  };
}

// ── 13. LINE_HEIGHT_UNIT  [SCHWAECHE 1 / P2-B] ─
function g13_LineHeightUnit(): GuardResult {
  const offenders: GuardDetailEntry[] = [];

  for (const node of nodes) {
    walkValues(node.styles, (key, val, parent, p) => {
      const propKey = typeof key === 'string' ? key.toLowerCase() : '';
      const parentType = parent['$$type'] as string | undefined;
      const parentValue = parent.value as Record<string, unknown> | undefined;

      // Fall A: bare number
      if (propKey === 'line-height' && typeof val === 'number') {
        offenders.push({
          path: p,
          nodeId: node.id as string,
          issue: `line-height: ${val} (number) wird zu ${val}px gewrappt (CSS: line-height: ${val}px — kaputt)`,
          fix: `Verwende "line-height": {"$$type":"size","value":{"size":${val},"unit":"em"}} oder einfach "line-height": "${val}" (String)`,
          severity: 'error',
        });
        return;
      }

      // Fall B: size wrapper, unit:"px", size < 5
      if (propKey === 'size' && parentType === 'size' && parentValue?.unit === 'px' && typeof parentValue?.size === 'number') {
        const pathIsLineHeight = p.toLowerCase().includes('line-height');
        if (pathIsLineHeight && parentValue.size < 5) {
          offenders.push({
            path: p,
            nodeId: node.id as string,
            issue: `line-height: ${parentValue.size}px vermutlich falsch (semantisch em gemeint)`,
            fix: `Aendere unit zu "em" — "line-height": {"$$type":"size","value":{"size":${parentValue.size},"unit":"em"}}`,
            severity: 'warning',
          });
        }
      }

      // Fall C: line-height prop as String "1.2px" or similar
      if (propKey === 'line-height' && typeof val === 'string' && /^\d+(\.\d+)?px$/.test(val.trim())) {
        offenders.push({
          path: p,
          nodeId: node.id as string,
          issue: `line-height: "${val}" — px-Unit unueblich fuer line-height`,
          fix: `Verwende em oder unitless String: "line-height": "${val.replace(/px$/, '')}"`,
          severity: 'warning',
        });
      }
    });
  }

  if (offenders.length === 0) {
    return { id: 'LINE_HEIGHT_UNIT', status: 'PASS', message: 'All line-height values are semantically correct (string or em-unit)' };
  }
  return {
    id: 'LINE_HEIGHT_UNIT', status: 'FAIL', severity: 'error',
    message: `${offenders.length} line-height value(s) with brittle unit (px or bare number)`,
    details: { offenders: offenders.slice(0, 10) },
  };
}

// ── 14. STYLE_ID_HYPHEN  [SCHWAECHE 2 / P2-C] ─
function g14_StyleIdHyphen(): GuardResult {
  const validStyleId = /^[a-z][a-z0-9_]*$/;
  const violations: GuardDetailEntry[] = [];

  for (const node of nodes) {
    // 1. Style-IDs in styles{} Keys
    const styles = (node.styles || {}) as Record<string, StyleDef>;
    for (const styleId of Object.keys(styles)) {
      if (!validStyleId.test(styleId)) {
        violations.push({
          where: 'styles-key',
          nodeId: node.id as string,
          styleId,
          issue: `Style-ID "${styleId}" enthaelt ungueltige Zeichen (erlaubt: a-z, 0-9, _; KEINE Hyphens/Uppercase)`,
          fix: `sanitizeStyleId("${styleId}") in lib/framer-utils.js anwenden — Output: ${styleId.toLowerCase().replace(/-/g, '_').replace(/[^a-z0-9_]/g, '')}`,
        });
      }
    }

    // 2. Style-IDs in settings.classes.value[]
    const settings = (node.settings || {}) as Record<string, unknown>;
    const classes = settings.classes as Record<string, unknown> | undefined;
    const classesValue = (classes?.value as unknown[]) || [];
    if (Array.isArray(classesValue)) {
      for (const cls of classesValue) {
        if (typeof cls === 'string' && !validStyleId.test(cls)) {
          violations.push({
            where: 'settings-classes-value',
            nodeId: node.id as string,
            className: cls,
            issue: `classes.value enthaelt "${cls}" — ungueltiges Format (erlaubt: a-z, 0-9, _)`,
            fix: 'sanitizeStyleId auf alle classes-Werte anwenden',
          });
        }
      }
    }

    // 3. Eigene element.id (Render-IDs)
    if (node.id && typeof node.id === 'string' && !validStyleId.test(node.id)) {
      violations.push({
        where: 'element-id',
        nodeId: node.id,
        issue: `element.id "${node.id}" hat ungueltiges Format — sollte fuer Konsistenz auch [a-z][a-z0-9_]* sein`,
        fix: 'uniqueWidgetId() in convert-xml-to-v4.js normalisiert bereits; pruefe Quell-Naming',
        severity: 'warning',
      });
    }
  }

  if (violations.length === 0) {
    return { id: 'STYLE_ID_HYPHEN', status: 'PASS', message: 'All style IDs and class values conform to [a-z][a-z0-9_]* pattern (no hyphens)' };
  }
  return {
    id: 'STYLE_ID_HYPHEN', status: 'FAIL', severity: 'error',
    message: `${violations.length} style ID(s) or classes.value(s) with invalid characters (Invariant III)`,
    details: { violations: violations.slice(0, 10) },
  };
}

// ── 15. UNIQUE_ELEMENT_IDS ──────────────────────
function g15_UniqueElementIds(): GuardResult {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.id && typeof node.id === 'string') {
      counts.set(node.id, (counts.get(node.id) || 0) + 1);
    }
  }
  const duplicates: GuardDetailEntry[] = [];
  for (const [id, count] of counts) {
    if (count > 1) {
      duplicates.push({ id, occurrences: count });
    }
  }
  if (duplicates.length === 0) {
    return { id: 'UNIQUE_ELEMENT_IDS', status: 'PASS', message: `All ${counts.size} element IDs are unique` };
  }
  return {
    id: 'UNIQUE_ELEMENT_IDS', status: 'FAIL', severity: 'error',
    message: `${duplicates.length} duplicate element ID(s) found (${duplicates.map(d => d.id).join(', ')})`,
    details: { duplicates },
  };
}

// ── 16. ELTYPE_VALIDITY ──────────────────────────
function g16_ElTypeValidity(): GuardResult {
  const VALID_EL_TYPES = new Set(['widget', 'e-flexbox', 'e-div-block', 'section', 'column']);
  const invalid: GuardDetailEntry[] = [];
  for (const node of nodes) {
    const et = (node.elType ?? node.el_type) as string | undefined;
    if (!et) {
      invalid.push({
        nodeId: (node.id as string) || '?',
        issue: 'elType is missing (undefined/null)',
        widgetType: (node.widgetType as string) || (node.type as string) || '?',
      });
    } else if (!VALID_EL_TYPES.has(et)) {
      invalid.push({
        nodeId: (node.id as string) || '?',
        elType: et,
        issue: `elType="${et}" not in valid set`,
        widgetType: (node.widgetType as string) || (node.type as string) || '?',
      });
    }
  }
  if (invalid.length === 0) {
    return { id: 'ELTYPE_VALIDITY', status: 'PASS', message: `All ${nodes.length} elements have valid elType` };
  }
  return {
    id: 'ELTYPE_VALIDITY', status: 'FAIL', severity: 'error',
    message: `${invalid.length} element(s) with invalid or missing elType`,
    details: { invalid: invalid.slice(0, 10) },
  };
}

// ─────────────────────────────────────────────
// RUN ALL GUARDS
// ─────────────────────────────────────────────

const guards: GuardResult[] = [
  g1_TokenExistence(),
  g2_ColorConsistency(),
  g3_FontResolution(),
  g4_BreakpointConsistency(),
  g5_StyleClassesBinding(),
  g6_NoHardcodedHex(),
  g7_NoPlainStrings(),
  g8_FontNamesQuoted(),
  g9_BaseVariantNull(),
  g10_TabletVariants(),
  g11_BackgroundColorGC(),
  g12_ImageSrcFormat(),
  g13_LineHeightUnit(),
  g14_StyleIdHyphen(),
  g15_UniqueElementIds(),
  g16_ElTypeValidity(),
];

// ─────────────────────────────────────────────
// SCORE + SUMMARY
// ─────────────────────────────────────────────

const passed   = guards.filter(g => g.status === 'PASS').length;
const warnings = guards.filter(g => g.status === 'WARN').length;
const errors   = guards.filter(g => g.status === 'FAIL').length;
const score    = Math.round((passed / guards.length) * 100);
const blocked  = score < 85 || errors > 0;

const errorGuards   = guards.filter(g => g.status === 'FAIL');
const warningGuards = guards.filter(g => g.status === 'WARN');

const result: ValidationResult = {
  meta: {
    treeFile:   args.tree as string | true | undefined,
    treeNodes:  nodes.length,
    checksRun:  guards.length,
    passed,
    warnings,
    errors,
    score,
  },
  guards,
  summary: {
    status: blocked ? 'BLOCKED' : 'OK',
    reason: blocked
      ? (errors > 0
          ? `${errors} error(s) found: ${errorGuards.map(g => g.id).join(', ')}`
          : `Score ${score}% below 85% threshold`)
      : 'All critical checks passed',
    action: blocked
      ? `Fix ${errors} error(s) before running elementor-set-content`
      : warnings > 0 ? `${warnings} warning(s) to review (build allowed)` : 'Ready to build',
  },
};

// ─────────────────────────────────────────────
// OUTPUT
// ─────────────────────────────────────────────

const output = JSON.stringify(result, null, 2);
if (typeof args.output === 'string') {
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, output, 'utf8');
  process.stderr.write(`Saved to ${args.output}\n`);
} else {
  process.stdout.write(output + '\n');
}

// Console summary
const statusIcon = blocked ? '✗' : '✓';
process.stderr.write(`\n${statusIcon} Score: ${score}% (${passed}/${guards.length} checks passed)\n`);
if (errors   > 0) process.stderr.write(`  ✗ ${errors} error(s):   ${errorGuards.map(g => g.id).join(', ')}\n`);
if (warnings > 0) process.stderr.write(`  ⚠ ${warnings} warning(s): ${warningGuards.map(g => g.id).join(', ')}\n`);
process.stderr.write(`  → ${result.summary.action}\n\n`);

process.exit(blocked ? 1 : 0);
