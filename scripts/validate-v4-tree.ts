#!/usr/bin/env node
/**
 * validate-v4-tree.ts
 *
 * Pre-build client validator for Elementor V4 Atomic Widget trees.
 * Runs 6 checks against a V4 element tree JSON file before sending
 * to elementor-set-content.
 *
 * Usage:
 *   node --import tsx scripts/validate-v4-tree.ts <tree.json>
 *   node --import tsx scripts/validate-v4-tree.ts <tree.json> --mode=warn
 *   node --import tsx scripts/validate-v4-tree.ts <tree.json> --schema=path/to/schema.json
 *
 * Exit code: 0 = pass, 1 = blocked (score < 85)
 *
 * The 6 checks (in order of error yield):
 *   1. $$type correctness — Plain values where $$type wrapper required
 *   2. Styles-classes binding — Local style IDs not in settings.classes
 *   3. Hyphen in style IDs       — Invalid style names that break the parser
 *   4. Responsive coverage       — Large values without mobile variant
 *   5. Widget/settings congruence — Wrong required key for widgetType
 *   6. Verbose style format      — Style entries missing id/type/label, null breakpoint, or plain-string custom_css
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { structuralHash } from './lib/framer-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Types ────────────────────────────────────────────────────────────

interface StyleVariant {
  meta?: {
    breakpoint?: string | null;
    state?: string | null;
  };
  props?: Record<string, unknown>;
  custom_css?: string | null | { raw: string };
}

interface StyleDefinition {
  id?: string;
  type?: string;
  label?: string;
  variants?: StyleVariant[];
  [key: string]: unknown;
}

interface V4Element {
  id?: string;
  elType?: string;
  el_type?: string;
  widgetType?: string;
  widget_type?: string;
  type?: string;
  settings?: Record<string, unknown>;
  styles?: Record<string, StyleDefinition>;
  elements?: V4Element[];
  children?: V4Element[];
  items?: V4Element[];
}

interface ValidationIssue {
  check: number | string;
  rule: string;
  elementId: string;
  path: string;
  styleId?: string;
  prop?: string;
  message: string;
  actual?: unknown;
  expected?: string;
  fix?: string;
  classes?: string[];
  issues?: string[];
  widgetType?: string;
  classId?: string;
  parent_ids?: string[];
  suggestion?: string;
}

interface PropTypeSpec {
  expected_type?: string;
  also_accepts?: string[];
  shape?: Record<string, string>;
}

interface WidgetRequirement {
  required?: string[];
  forbidden_content?: string[];
}

interface ResponsiveRule {
  threshold_px?: number;
}

interface Schema {
  properties?: Record<string, PropTypeSpec>;
  common_errors?: unknown[];
  types?: Record<string, { shape?: Record<string, string> }>;
  widget_requirements?: Record<string, WidgetRequirement>;
  responsive_rules?: {
    mandatory_mobile_if_oversize?: Record<string, ResponsiveRule>;
  };
}

interface AnimationPlan {
  interactions?: AnimationEntry[];
  snippets?: AnimationEntry[];
  meta?: { source?: string };
}

interface AnimationEntry {
  type?: string;
  tags?: string[];
  interactions?: AnimationEffect[];
  effects?: AnimationEffect[];
  selector?: string;
  title?: string;
}

interface AnimationEffect {
  effect?: string;
  animation?: string;
}

interface CheckErrorCounts {
  [key: string]: number;
}

interface CheckSummary {
  check: string;
  name: string;
  passed: boolean;
  vital: boolean;
  errors: number;
  warnings: number;
  status: string;
}

interface ValidationResult {
  passed: boolean;
  score: number;
  threshold: number;
  blocked: boolean;
  mode: string;
  treePath: string;
  schemaPath: string;
  summary: string;
  stats: {
    totalElements: number;
    totalErrors: number;
    totalWarnings: number;
    errorsByCheck: CheckErrorCounts;
    warningsByCheck: CheckErrorCounts;
  };
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  checks?: CheckSummary[];
}

// ─── Configuration ───────────────────────────────────────────────────

const PASS_THRESHOLD = 85;
const SCHEMA_PATH_DEFAULT = path.join(__dirname, '..', 'schemas', 'v4-prop-type-schema.json');

// ─── Parse arguments ─────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('Usage: node --import tsx scripts/validate-v4-tree.ts <tree.json> [--mode=warn] [--schema=path]');
  console.log('');
  console.log('  tree.json   V4 element tree JSON file');
  console.log('  --mode      strict (default, exit 1 if score < 85%) or warn (always exit 0)');
  console.log('  --schema    Path to prop-type-schema JSON (default: .commandcode/schemas/v4-prop-type-schema.json)');
  console.log('');
  console.log('Runs 6 checks against a V4 element tree before sending to elementor-set-content.');
  process.exit(0);
}

const treePath = args[0] as string;
let mode = 'strict';
let schemaPath: string = SCHEMA_PATH_DEFAULT;
let animationPlan: AnimationPlan | null = null;
for (const arg of args.slice(1)) {
  if (arg.startsWith('--mode=')) mode = arg.replace('--mode=', '');
  if (arg.startsWith('--schema=')) schemaPath = arg.replace('--schema=', '');
  if (arg.startsWith('--animation-plan=')) {
    const planPath = arg.replace('--animation-plan=', '');
    if (fs.existsSync(planPath)) {
      try { animationPlan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as AnimationPlan; }
      catch (e) { console.error(`Warning: Cannot read animation-plan: ${(e as Error).message}`); }
    }
  }
}

// ─── Load inputs ─────────────────────────────────────────────────────

let treeRaw: unknown;
try {
  const raw = fs.readFileSync(treePath, 'utf8');
  treeRaw = JSON.parse(raw) as unknown;
} catch (e) {
  console.error(`FATAL: Cannot read tree file "${treePath}": ${(e as Error).message}`);
  process.exit(1);
}

let schema: Schema;
try {
  const raw = fs.readFileSync(schemaPath, 'utf8');
  schema = JSON.parse(raw) as Schema;
} catch (e) {
  console.error(`FATAL: Cannot read schema file "${schemaPath}": ${(e as Error).message}`);
  process.exit(1);
}

let tree: V4Element[] = Array.isArray(treeRaw) ? treeRaw as V4Element[] : [treeRaw as V4Element];

// ─── Tree traversal ──────────────────────────────────────────────────

function walkTree(
  elements: V4Element[] | undefined,
  callback: (el: V4Element, path: string) => void,
  indexPath = '',
): void {
  if (!Array.isArray(elements)) return;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || typeof el !== 'object') continue;
    const currentPath = indexPath ? `${indexPath}.${i}` : String(i);
    callback(el, currentPath);
    const children = el.children || el.elements;
    if (Array.isArray(children)) {
      walkTree(children, callback, currentPath);
    }
  }
}

function getElementType(el: V4Element): string {
  // Unterstuetzt beide Formate:
  // Pipeline (camelCase): widgetType, elType
  // MCP elementor-get-content (snake_case): widget_type, el_type, type
  if (el.elType === 'widget' && el.widgetType) return el.widgetType;
  if (el.el_type === 'widget' && el.widget_type) return el.widget_type;
  if (el.widgetType) return el.widgetType;
  if (el.widget_type) return el.widget_type;
  if (el.type) return el.type;
  return el.elType || el.el_type || 'unknown';
}

function getElementId(el: V4Element): string {
  return el.id || 'unknown';
}

function isContainer(type: string): boolean {
  return type === 'e-flexbox' || type === 'e-div-block';
}

// ─── Get classes array from settings ─────────────────────────────────

function getClassesArray(el: V4Element): string[] {
  const settings = (el.settings || {}) as Record<string, unknown>;
  const classes = settings.classes;
  if (classes && typeof classes === 'object' && Array.isArray((classes as Record<string, unknown>).value)) {
    return (classes as Record<string, unknown>).value as string[];
  }
  if (Array.isArray(classes)) return classes as string[];
  return [];
}

// ─── CHECK 1: $$type correctness ─────────────────────────────────────

function checkTypeCorrectness(el: V4Element, elPath: string, errors: ValidationIssue[]): void {
  const propSchema = (schema.properties || {}) as Record<string, PropTypeSpec>;

  // Check style properties
  if (!el.styles || typeof el.styles !== 'object') return;

  for (const [styleId, styleDef] of Object.entries(el.styles)) {
    if (!styleDef || typeof styleDef !== 'object') continue;
    const variants = styleDef.variants || [];
    for (const variant of variants) {
      const props = (variant.props || {}) as Record<string, unknown>;
      for (const [propName, propValue] of Object.entries(props)) {
        if (propValue === null || propValue === undefined) continue;

        const spec = propSchema[propName];
        if (!spec) continue; // Unknown property, skip

        // Special case: custom_css
        if (propName === 'custom_css') {
          if (typeof propValue === 'string') {
            errors.push({
              check: 1, rule: '$$TYPE-CORRECTNESS', elementId: getElementId(el), path: elPath,
              styleId, prop: propName,
              message: `custom_css is a plain string — will cause Site-Crash 500. Must be null or {raw: base64_string}.`,
              actual: (propValue || '').substring(0, 60),
              fix: 'Wrap as {raw: base64_encode(string)} or set to null'
            });
          }
          continue;
        }

        // If propValue has no $$type, it might be auto-wrap-compatible
        if (!propValue || typeof propValue !== 'object' || !(propValue as Record<string, unknown>)['$$type']) {
          // Scalars that can be auto-wrapped: string, number, boolean
          const typeStr = typeof propValue === 'number' ? 'number' :
                         typeof propValue === 'boolean' ? 'boolean' :
                         typeof propValue === 'string' ? 'string' : null;
          if (typeStr) {
            // Check if this property expects a type that needs explicit wrapping
            const expected = spec.expected_type;
            if (expected && expected !== typeStr && expected !== 'raw-object') {
              // For colors: bare "#FF0000" auto-wraps to color, OK
              if (expected === 'color' && typeStr === 'string' && (propValue as string).startsWith('#')) {
                continue; // Auto-wraps, OK
              }
              if (expected === 'color' && typeStr === 'string' && /^e-gv-/.test(propValue as string)) {
                errors.push({
                  check: 1, rule: '$$TYPE-CORRECTNESS', elementId: getElementId(el), path: elPath,
                  styleId, prop: propName,
                  message: `${propName}="${propValue as string}" — looks like a variable ID but missing $type:global-color-variable wrapper. Auto-wrap will NOT detect this.`,
                  actual: propValue,
                  fix: `Use {"$$type":"global-color-variable","value":"${propValue as string}"}`
                });
                continue;
              }
            }
          }
          continue;
        }

        // PropValue has $$type — validate it matches expected
        const actualType = (propValue as Record<string, unknown>)['$$type'] as string;
        const specExpected = spec.expected_type;
        const specAlso = spec.also_accepts || [];

        if (specExpected && actualType !== specExpected && !specAlso.includes(actualType)) {
          errors.push({
            check: 1, rule: '$$TYPE-CORRECTNESS', elementId: getElementId(el), path: elPath,
            styleId, prop: propName,
            message: `${propName}: expected $$type "${specExpected}" but got "${actualType}"`,
            actual: actualType,
            expected: specAlso.length ? [specExpected, ...specAlso].join('|') : specExpected
          });
        }

        // Deep-check: does the value shape match the type?
        const typeShape = (schema.types || {})[actualType];
        if (typeShape && typeShape.shape) {
          validateTypeShape(
            propValue as Record<string, unknown>,
            typeShape.shape,
            propName, elPath, el, styleId,
            errors,
          );
        }
      }
    }
  }

  // Check: visual values in container settings (settings ∩ styles violation)
  const elType = getElementType(el);
  if (isContainer(elType)) {
    const settings = (el.settings || {}) as Record<string, unknown>;
    const forbiddenInSettings = [
      'color', 'font-size', 'font-family', 'font-weight', 'line-height', 'letter-spacing',
      'padding', 'margin', 'gap', 'width', 'height', 'min-height', 'max-width',
      'background-color', 'background', 'background-overlay',
      'flex-direction', 'align-items', 'justify-content', 'flex-wrap',
      'border-radius', 'border-width', 'border-color', 'border-style',
      'box-shadow', 'opacity', 'position', 'overflow'
    ];
    for (const key of Object.keys(settings)) {
      if (forbiddenInSettings.includes(key)) {
        errors.push({
          check: 1, rule: 'SETTINGS-STYLES-SPLIT', elementId: getElementId(el), path: elPath,
          prop: key,
          message: `${key} in settings of ${elType} — visual properties must be in styles, not settings. Invariant III violation.`
        });
      }
    }
  }
}

function validateTypeShape(
  value: Record<string, unknown>,
  shape: Record<string, string>,
  propName: string,
  elPath: string,
  el: V4Element,
  styleId: string,
  errors: ValidationIssue[],
): void {
  if (!shape || typeof shape !== 'object') return;
  const val = (value.value || value) as Record<string, unknown>;
  if (typeof val !== 'object' || val === null) return;

  for (const [key, expected] of Object.entries(shape)) {
    if (key === '$$type') continue;
    if (!(key in val)) {
      if (key === 'url' && val.id !== undefined) continue;
      if (key === 'id' && val.url !== undefined) continue;
      if (key === 'basis') continue;
      if (key === 'spread') continue;
      if (key === 'inline-end' || key === 'inline-start') continue;
      continue;
    }

    const actualVal = val[key];
    if (typeof expected === 'string' && !expected.includes('|')) {
      if (expected === 'size' || expected === 'color') {
        if (actualVal && typeof actualVal === 'object' && (actualVal as Record<string, unknown>)['$$type'] === expected) {
          continue;
        }
      }
      if (expected === 'image-attachment-id|null' && actualVal !== null && typeof actualVal === 'number') {
        continue;
      }
    }
  }
  // Suppress unused parameter warnings
  void propName; void elPath; void el; void styleId; void errors;
}

// ─── CHECK 2: Styles-classes binding ─────────────────────────────────

function checkStylesClassesBinding(
  el: V4Element,
  elPath: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  if (!el.styles || typeof el.styles !== 'object') return;

  const localStyleIds: string[] = [];
  for (const [sid, def] of Object.entries(el.styles)) {
    if (sid.startsWith('gc-')) continue;
    if (typeof def === 'object' && def.variants) localStyleIds.push(sid);
  }

  if (localStyleIds.length === 0) return;

  const classes = getClassesArray(el);
  const unbound = localStyleIds.filter(sid => !classes.includes(sid));

  for (const sid of unbound) {
    errors.push({
      check: 2, rule: 'STYLES-CLASSES-BINDING', elementId: getElementId(el), path: elPath,
      styleId: sid,
      message: `Local style "${sid}" defined in styles but NOT in settings.classes.value[] — Invariant I violation. Style will never render.`,
      classes,
      fix: `Add "${sid}" to settings.classes.value array`
    });
  }

  // Also catch: class references that don't exist (orphaned references)
  for (const c of classes) {
    if (c.startsWith('gc-')) continue;
    if (!el.styles[c]) {
      warnings.push({
        check: 2, rule: 'ORPHANED-CLASS-REFERENCE', elementId: getElementId(el), path: elPath,
        classId: c,
        message: `Class "${c}" referenced in settings.classes but not defined in styles.`
      });
    }
  }
}

// ─── CHECK 3: Hyphen in style IDs ────────────────────────────────────

function checkStyleIdHyphen(el: V4Element, elPath: string, errors: ValidationIssue[]): void {
  if (!el.styles || typeof el.styles !== 'object') return;

  for (const sid of Object.keys(el.styles)) {
    if (sid.startsWith('gc-')) continue;
    if (!/^[a-z][a-z0-9_]*$/i.test(sid)) {
      const issue = sid.includes('-') ? 'contains hyphen (forbidden)' : 'invalid characters';
      errors.push({
        check: 3, rule: 'STYLE-ID-HYPHEN', elementId: getElementId(el), path: elPath,
        styleId: sid,
        message: `Style ID "${sid}" ${issue} — only [a-z0-9_]+ allowed. Hyphens break the parser suffix system.`
      });
    }
  }
}

// ─── CHECK 4: Responsive coverage ────────────────────────────────────

function checkResponsiveCoverage(
  el: V4Element,
  elPath: string,
  warnings: ValidationIssue[],
): void {
  if (!el.styles || typeof el.styles !== 'object') return;

  const rules = (schema.responsive_rules || {}).mandatory_mobile_if_oversize || {};

  for (const [styleId, styleDef] of Object.entries(el.styles)) {
    if (styleId.startsWith('gc-')) continue;
    if (!styleDef || !Array.isArray(styleDef.variants)) continue;

    const desktopVariant = styleDef.variants.find(v => {
      const bp = (v.meta && v.meta.breakpoint);
      const st = (v.meta && v.meta.state) || null;
      return (bp === null || bp === undefined || bp === 'desktop' || bp === '') && (!st || st === null);
    });

    const hasMobile = styleDef.variants.some(v => {
      const bp = (v.meta && v.meta.breakpoint) || '';
      return bp === 'mobile';
    });

    if (!desktopVariant) continue;
    const props = (desktopVariant.props || {}) as Record<string, unknown>;

    // Check font-size oversize
    if (props['font-size']) {
      const fs = props['font-size'] as Record<string, unknown>;
      const size = (fs.value && (fs.value as Record<string, unknown>).size !== undefined)
        ? (fs.value as Record<string, unknown>).size : null;
      if (size && Number(size) > (rules['font-size']?.threshold_px || 28)) {
        if (!hasMobile) {
          warnings.push({
            check: 4, rule: 'RESPONSIVE-COVERAGE', elementId: getElementId(el), path: elPath,
            styleId, prop: 'font-size',
            message: `font-size: ${size}px on desktop but no mobile variant. Browser keeps this value — text will overflow on 375px viewport.`
          });
        }
      }
    }

    // Check min-height oversize
    if (props['min-height']) {
      const mh = props['min-height'] as Record<string, unknown>;
      const mhSize = (mh.value && (mh.value as Record<string, unknown>).size !== undefined)
        ? (mh.value as Record<string, unknown>).size : null;
      if (mhSize && Number(mhSize) > (rules['min-height']?.threshold_px || 200)) {
        if (!hasMobile) {
          warnings.push({
            check: 4, rule: 'RESPONSIVE-COVERAGE', elementId: getElementId(el), path: elPath,
            styleId, prop: 'min-height',
            message: `min-height: ${mhSize}px on desktop but no mobile variant. Creates empty space on 375px viewport.`
          });
        }
      }
    }

    // Check padding oversize (horizontal)
    if (props.padding) {
      const pad = props.padding as Record<string, unknown>;
      const padVal = (pad.value || pad) as Record<string, unknown>;
      const inlineMax = Math.max(
        ((padVal['inline-start'] as Record<string, unknown>)?.value as Record<string, unknown>)?.size as number || 0,
        ((padVal['inline-end'] as Record<string, unknown>)?.value as Record<string, unknown>)?.size as number || 0
      );
      if (inlineMax > (rules['padding_inline']?.threshold_px || 20)) {
        if (!hasMobile) {
          warnings.push({
            check: 4, rule: 'RESPONSIVE-COVERAGE', elementId: getElementId(el), path: elPath,
            styleId, prop: 'padding',
            message: `Horizontal padding ${inlineMax}px on desktop but no mobile variant. Eats ${inlineMax * 2}px from 375px viewport.`
          });
        }
      }
    }

    // Check flex-direction: row without mobile column
    if (props['flex-direction']) {
      const fd = (props['flex-direction'] as Record<string, unknown>).value || props['flex-direction'];
      if (fd === 'row') {
        if (!hasMobile) {
          warnings.push({
            check: 4, rule: 'RESPONSIVE-COVERAGE', elementId: getElementId(el), path: elPath,
            styleId, prop: 'flex-direction',
            message: 'flex-direction: row on desktop but no mobile variant. Children will be squashed on narrow viewports. Add a mobile variant with column.'
          });
        }
      }
    }

    // Check width as fixed px
    if (props.width) {
      const w = props.width as Record<string, unknown>;
      const wSize = (w.value && (w.value as Record<string, unknown>).size !== undefined)
        ? (w.value as Record<string, unknown>).size : null;
      const wUnit = (w.value && (w.value as Record<string, unknown>).unit !== undefined)
        ? (w.value as Record<string, unknown>).unit : null;
      if (wSize && wUnit === 'px' && Number(wSize) > 100 && !hasMobile) {
        warnings.push({
          check: 4, rule: 'RESPONSIVE-COVERAGE', elementId: getElementId(el), path: elPath,
          styleId, prop: 'width',
          message: `width: ${wSize}px on desktop but no mobile variant. Fixed-width container overflows 375px viewport.`
        });
      }
    }
  }
}

// ─── CHECK 5: Widget/settings congruence ─────────────────────────────

function checkWidgetSettings(el: V4Element, elPath: string, errors: ValidationIssue[]): void {
  const elType = getElementType(el);
  const widgetReqs = (schema.widget_requirements || {})[elType];
  if (!widgetReqs) return;

  const settings = (el.settings || {}) as Record<string, unknown>;

  // Check required settings
  for (const reqKey of widgetReqs.required || []) {
    if (elType === 'e-button' && reqKey === 'title' && (settings.title || settings.text)) continue;
    if (!settings[reqKey]) {
      errors.push({
        check: 5, rule: 'WIDGET-SETTINGS', elementId: getElementId(el), path: elPath,
        widgetType: elType,
        message: `${elType} missing required setting "${reqKey}".`
      });
    }
  }

  // Check forbidden content
  if (widgetReqs.forbidden_content) {
    if (widgetReqs.forbidden_content.includes('<p>')) {
      const paragraph = settings.paragraph as Record<string, unknown> | undefined;
      if (paragraph && paragraph.value && (paragraph.value as Record<string, unknown>).content) {
        const content = (paragraph.value as Record<string, unknown>).content as { value?: string } | string;
        const contentStr = typeof content === 'string' ? content : content.value;
        if (typeof contentStr === 'string' && /<p[>\s]/i.test(contentStr)) {
          errors.push({
            check: 5, rule: 'P-IN-PARAGRAPH', elementId: getElementId(el), path: elPath,
            message: 'e-paragraph contains <p> tags — only inline elements allowed. Nesting <p> in <p> breaks HTML rendering.'
          });
        }
      }
    }
  }
}

// ─── CHECK 6: Verbose style format ───────────────────────────────────

/**
 * Validates that every per-element style entry (non-gc- prefix) uses the
 * VERBOSE format required by elementor-set-content:
 *   {id: "<styleId>", type: "class", label: "local", variants: [...]}
 *
 * Catches three classes of bug seen in production:
 *   a) ERGONOMIC format leakage — `$$type` at style level instead of `type: "class"`
 *   b) Missing id/type/label — server rejects the whole subtree
 *   c) Plain-string custom_css — crashes Elementor renderer
 */
function checkVerboseStyleFormat(el: V4Element, elPath: string, errors: ValidationIssue[]): void {
  if (!el.styles || typeof el.styles !== 'object') return;

  for (const [styleId, styleDef] of Object.entries(el.styles)) {
    if (styleId.startsWith('gc-')) continue;
    if (!styleDef || typeof styleDef !== 'object') continue;

    const missing: string[] = [];

    // (a) ERGONOMIC format detection: $$type at top level = old format
    if (styleDef['$$type'] !== undefined) {
      missing.push(`has $$type:"${styleDef['$$type'] as string}" at style level — old ERGONOMIC format. Replace with type:"class".`);
    }

    // (b) Required VERBOSE fields
    if (!styleDef.id) missing.push('missing "id" field');
    else if (styleDef.id !== styleId) missing.push(`id "${styleDef.id}" does not match style key "${styleId}"`);

    if (!styleDef.type) missing.push('missing "type" field (should be "class")');
    else if (styleDef.type !== 'class') missing.push(`type is "${styleDef.type}" but must be "class" for per-element styles`);

    if (styleDef.label === undefined) missing.push('missing "label" field (should be "local")');

    // Variant-level checks
    const variants = styleDef.variants;
    if (!Array.isArray(variants)) {
      missing.push('variants is not an array');
    } else {
      if (variants.length > 0) {
        const hasNamedBreakpoint = variants.some(v =>
          v?.meta?.breakpoint !== undefined
        );
        if (!hasNamedBreakpoint) {
          missing.push('no variant has a breakpoint defined — at least one must have breakpoint: null (desktop base) or a named breakpoint ("desktop", "tablet", "mobile")');
        }
      }
      for (let vi = 0; vi < variants.length; vi++) {
        const v = variants[vi];
        if (!v || typeof v !== 'object') continue;
        const vpath = `variants[${vi}]`;

        if (v.meta && !('state' in v.meta)) {
          missing.push(`${vpath}.meta.state is missing — set to null`);
        }

        if (typeof v.custom_css === 'string') {
          missing.push(`${vpath}.custom_css is a plain string — will crash Elementor renderer. Must be null or {raw: base64_string}.`);
        }
        if (v.custom_css === undefined) {
          missing.push(`${vpath} missing "custom_css" field (set to null)`);
        }
      }
    }

    if (missing.length > 0) {
      errors.push({
        check: 6,
        rule: 'VERBOSE-STYLE-FORMAT',
        elementId: getElementId(el),
        path: elPath,
        styleId,
        message: `Style "${styleId}" has ${missing.length} format issue(s): ${missing.join('; ')}`,
        issues: missing,
        fix: 'Use VERBOSE format: {id: "<styleId>", type: "class", label: "local", variants: [{meta: {breakpoint: null, state: null}, props: {...}, custom_css: null}]}'
      });
    }
  }
}

// ─── Check 8: GRID_VS_FLEXBOX_COVERAGE (D3) ─────────────────────────

function checkGridVsFlexboxCoverage(
  el: V4Element,
  elPath: string,
  _errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const elType = getElementType(el);
  if (elType !== 'e-flexbox') return;

  const styles = el.styles || {};
  const children = el.elements || [];

  for (const [, styleDef] of Object.entries(styles)) {
    for (const variant of (styleDef.variants || [])) {
      const props = (variant.props || {}) as Record<string, unknown>;

      if ((props['flex-wrap'] as Record<string, unknown>)?.value === 'wrap') {
        warnings.push({
          check: 8, rule: 'GRID_VS_FLEXBOX',
          elementId: getElementId(el), path: elPath,
          message: `e-flexbox with flex-wrap:wrap — consider e-div-block with display:grid`,
        });
        return;
      }
    }
  }

  if (children.length >= 4) {
    warnings.push({
      check: 8, rule: 'GRID_VS_FLEXBOX',
      elementId: getElementId(el), path: elPath,
      message: `e-flexbox with ${children.length} children — consider grid-template-columns`,
    });
  }
}

// ─── Check 9: COMPONENT_REUSE_POTENTIAL (D1) ─────────────────────────

function checkComponentReusePotential(
  treeNodes: V4Element[],
  _errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const containerMap = new Map<string, { example: V4Element[]; parents: (string | undefined)[] }>();

  function walkForComponents(node: V4Element, pathStr: string): void {
    const children = node.elements || node.children || [];
    if (children.length >= 2) {
      const hash = structuralHash(children, { nullOnSmall: true });
      if (hash) {
        if (!containerMap.has(hash)) {
          containerMap.set(hash, { example: children, parents: [] });
        }
        containerMap.get(hash)!.parents.push(node.id || pathStr);
      }
    }
    children.forEach((child, i) => {
      walkForComponents(child, `${pathStr}.${i}`);
    });
  }

  const roots = Array.isArray(treeNodes) ? treeNodes : [treeNodes];
  (roots as V4Element[]).forEach((root, i) => walkForComponents(root, String(i)));

  for (const [, group] of containerMap) {
    if (group.parents.length >= 2) {
      warnings.push({
        check: 9, rule: 'COMPONENT_REUSE_POTENTIAL',
        elementId: group.parents[0] || 'unknown',
        path: group.parents.join(', '),
        message: `${group.parents.length} duplicate element groups detected — consider extracting as Atomic Component`,
        parent_ids: group.parents as string[],
      });
    }
  }
}

// ─── Check 10: NATIVE_INTERACTION_COVERAGE (D2) ──────────────────────

function checkNativeInteractionCoverage(
  _treeNodes: V4Element[],
  animPlan: AnimationPlan,
  warnings: ValidationIssue[],
): void {
  const interactions = animPlan.interactions || animPlan.snippets || [];

  const gsapEntries = interactions.filter(i =>
    i.type === 'gsap' || (i.tags && (i.tags.includes('gsap') || i.tags.includes('scrolltrigger')))
  );

  for (const entry of gsapEntries) {
    const effects = entry.interactions || entry.effects || [];
    const mappableToNative = effects.filter(e =>
      ['fade', 'slide-up', 'zoom', 'rotate', 'slide-left'].includes(e.effect || e.animation || '')
    );

    if (mappableToNative.length > 0) {
      warnings.push({
        check: 10, rule: 'NATIVE_INTERACTION_COVERAGE',
        elementId: entry.selector || entry.title || 'unknown',
        path: animPlan.meta?.source || '',
        message: `${mappableToNative.length} GSAP animations could be V4-native interactions. Use C3 routing to edit-interaction.`,
        suggestion: 'Use framer-animation-extractor.js with C3 native routing',
      });
    }
  }
}

// ─── Check: Hardcoded hex (collected as warnings) ────────────────────

function checkHardcodedHex(el: V4Element, elPath: string, warnings: ValidationIssue[]): void {
  if (!el.styles || typeof el.styles !== 'object') return;

  for (const [styleId, styleDef] of Object.entries(el.styles)) {
    if (!styleDef || !Array.isArray(styleDef.variants)) continue;
    for (const variant of styleDef.variants) {
      const props = (variant.props || {}) as Record<string, unknown>;
      scanForHardcodedHex(props, elPath, el, styleId, warnings);
    }
  }
}

function scanForHardcodedHex(
  obj: Record<string, unknown>,
  elPath: string,
  el: V4Element,
  styleId: string,
  warnings: ValidationIssue[],
  keyPath = '',
): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, val] of Object.entries(obj)) {
    if (['color', 'background-color', 'border-color'].includes(key)) {
      if (val && typeof val === 'object' && (val as Record<string, unknown>)['$$type'] === 'color' &&
          typeof (val as Record<string, unknown>).value === 'string' &&
          /^#[0-9A-Fa-f]{3,8}$/.test((val as Record<string, unknown>).value as string)) {
        warnings.push({
          check: 'placebo', rule: 'HARDCODED-HEX', elementId: getElementId(el), path: elPath,
          styleId, prop: key,
          message: `${key}: ${(val as Record<string, unknown>).value as string} is hardcoded. Use global-color-variable reference instead.`
        });
      }
    }
    if (typeof val === 'object' && val !== null && !(val as Record<string, unknown>)['$$type']) {
      scanForHardcodedHex(val as Record<string, unknown>, elPath, el, styleId, warnings, keyPath ? `${keyPath}.${key}` : key);
    }
  }
}

// ─── Check: DOM depth (C7 — warning ≥4, error ≥6) ───────────────────

/**
 * Measures the maximum nesting depth of the element tree.
 * Deep trees cause server-timeout risk in elementor-set-content.
 * warning ≥ 4 levels deep, error ≥ 6 levels deep.
 */
function checkDomDepth(
  treeNodes: V4Element[],
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  let maxDepth = 0;
  let deepestPath = '';

  function walk(node: V4Element, depth: number, pathStr: string): void {
    if (depth > maxDepth) {
      maxDepth = depth;
      deepestPath = pathStr;
    }
    const children = node.elements ?? node.children ?? node.items ?? [];
    if (Array.isArray(children)) {
      children.forEach((child, i) => {
        const id = child.id ?? child.widgetType ?? `[${i}]`;
        walk(child, depth + 1, `${pathStr} > ${id}`);
      });
    }
  }

  const roots = Array.isArray(treeNodes) ? treeNodes : [treeNodes];
  (roots as V4Element[]).forEach(root => {
    const id = root.id ?? root.widgetType ?? 'root';
    walk(root, 0, id);
  });

  if (maxDepth >= 6) {
    errors.push({
      check: 7, rule: 'DOM-DEPTH', elementId: deepestPath,
      path: deepestPath,
      message: `DOM depth ${maxDepth} ≥ 6 — server timeout risk in elementor-set-content. Flatten the tree.`,
    });
  } else if (maxDepth >= 4) {
    warnings.push({
      check: 'C7', rule: 'DOM-DEPTH', elementId: deepestPath,
      path: deepestPath,
      message: `DOM depth ${maxDepth} ≥ 4 — performance degradation risk. Consider flattening.`,
    });
  }
}

// ─── Main validation ─────────────────────────────────────────────────

function validate(): number {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  walkTree(tree, (el, elPath) => {
    checkTypeCorrectness(el, elPath, errors);
    checkStylesClassesBinding(el, elPath, errors, warnings);
    checkStyleIdHyphen(el, elPath, errors);
    checkResponsiveCoverage(el, elPath, warnings);
    checkWidgetSettings(el, elPath, errors);
    checkVerboseStyleFormat(el, elPath, errors);
    checkHardcodedHex(el, elPath, warnings);
    checkGridVsFlexboxCoverage(el, elPath, errors, warnings);
  });

  // D1: Tree-level COMPONENT_REUSE_POTENTIAL check
  checkComponentReusePotential(tree, errors, warnings);

  // D2: NATIVE_INTERACTION_COVERAGE check (requires --animation-plan)
  if (animationPlan) {
    checkNativeInteractionCoverage(tree, animationPlan, warnings);
  }

  // Tree-level check: DOM depth
  checkDomDepth(tree, errors, warnings);

  // Scoring
  const checkErrorCounts: CheckErrorCounts = {};
  const checkWarnCounts: CheckErrorCounts = {};
  for (const e of errors) {
    const ck = e.check === 'placebo' ? 'placebo' : `C${e.check}`;
    checkErrorCounts[ck] = (checkErrorCounts[ck] || 0) + 1;
  }
  for (const w of warnings) {
    const ck = w.check === 'placebo' ? 'placebo' : `C${w.check}`;
    checkWarnCounts[ck] = (checkWarnCounts[ck] || 0) + 1;
  }

  const vitalPassed = [1, 2, 3, 4, 5, 6].filter(ck => !checkErrorCounts[`C${ck}`]).length;
  const score = Math.round((vitalPassed / 6) * 100);
  const passed = score >= PASS_THRESHOLD;
  const blocked = mode === 'strict' && !passed;

  const totalErrors = errors.length;
  const totalWarnings = warnings.length;

  const result: ValidationResult = {
    passed,
    score,
    threshold: PASS_THRESHOLD,
    blocked,
    mode,
    treePath,
    schemaPath,
    summary: passed
      ? `PASSED: Score ${score}% >= ${PASS_THRESHOLD}%. ${totalErrors} errors, ${totalWarnings} warnings.`
      : `BLOCKED: Score ${score}% < ${PASS_THRESHOLD}%. ${totalErrors} errors, ${totalWarnings} warnings across 6 checks.`,
    stats: {
      totalElements: countElements(tree),
      totalErrors,
      totalWarnings,
      errorsByCheck: checkErrorCounts,
      warningsByCheck: checkWarnCounts,
    },
    errors: errors.slice(0, 100),
    warnings: warnings.slice(0, 100),
  };

  const checkNames: Record<string, { name: string; vital: boolean; weight: number }> = {
    C1: { name: '$$TYPE-CORRECTNESS', vital: true, weight: 17 },
    C2: { name: 'STYLES-CLASSES-BINDING', vital: true, weight: 17 },
    C3: { name: 'STYLE-ID-HYPHEN', vital: true, weight: 17 },
    C4: { name: 'RESPONSIVE-COVERAGE', vital: true, weight: 16 },
    C5: { name: 'WIDGET-SETTINGS', vital: true, weight: 17 },
    C6: { name: 'VERBOSE-STYLE-FORMAT', vital: true, weight: 16 },
    C7: { name: 'DOM-DEPTH', vital: false, weight: 8 },
    C8: { name: 'GRID_VS_FLEXBOX', vital: false, weight: 5 },
    C9: { name: 'COMPONENT_REUSE_POTENTIAL', vital: false, weight: 5 },
    C10: { name: 'NATIVE_INTERACTION_COVERAGE', vital: false, weight: 5 },
    placebo: { name: 'HARDCODED-HEX', vital: false, weight: 0 },
  };

  result.checks = Object.entries(checkNames).map(([ck, info]) => {
    const errs = checkErrorCounts[ck] || 0;
    const warns = checkWarnCounts[ck] || 0;
    const ckPassed = errs === 0;
    return {
      check: ck,
      name: info.name,
      passed: ckPassed,
      vital: info.vital,
      errors: errs,
      warnings: warns,
      status: ckPassed ? '✅' : '❌',
    };
  });

  console.log(JSON.stringify(result, null, 2));
  return blocked ? 1 : 0;
}

function countElements(elements: V4Element[]): number {
  let count = 0;
  walkTree(elements, () => { count++; });
  return count;
}

// ─── Run ─────────────────────────────────────────────────────────────

try {
  const exitCode = validate();
  process.exit(exitCode);
} catch (e) {
  console.error(`FATAL: Validation crashed: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
}
