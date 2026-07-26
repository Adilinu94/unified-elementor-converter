#!/usr/bin/env node
/**
 * generate-global-classes.ts
 * Analysiert einen V4 Widget-Tree (Output von convert-xml-to-v4.js) und
 * findet wiederkehrende Style-Patterns → schlägt Global Classes vor.
 *
 * Kernregeln (aus AGENTS.md):
 *   - ≥2 Elemente mit gleicher Style-Signatur → GC-Vorschlag
 *   - background.color → IMMER GC, auch bei nur 1 Element (Bug 3)
 *     AUSNAHME: wenn convert-xml-to-v4.js mit --prefer-gc=false lief (Standard),
 *     dann wurde background bereits als lokaler Style gesetzt. In diesem Fall
 *     überspringt generate-global-classes.ts den background-GC um Duplikate zu
 *     vermeiden. Flag: --local-bg-set (true = Bug-3-Fix aktiv, false = prefer-gc).
 *   - Structure GC + Color GC trennen
 *   - Naming: gc-<semantic>-<variant>
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { DesignToken } from '../src/shared-schemas/design-tokens.js';

// ── Types ──────────────────────────────────────────────────────────────────

type GcType = 'typography' | 'structure' | 'background' | 'other';

interface StyleProps {
  [key: string]: unknown;
}

interface GcClass {
  name: string;
  type: string;
  reason: string;
  element_ids: string[];
  props: StyleProps;
  variants?: GcVariant[];
  variable_bindings?: GcVariableBinding[];
  mcp_calls: McpCall[];
}

interface GcVariant {
  breakpoint: string;
  props: StyleProps;
}

interface GcVariableBinding {
  prop: string;
  gv_id?: string;
}

interface McpCall {
  ability: string;
  params: Record<string, unknown>;
  status?: string;
}

interface GcPlan {
  meta: {
    totalElements: number;
    elementsWithStyles: number;
    uniqueTypographyPatterns: number;
    uniqueStructurePatterns: number;
    backgroundElements: number;
    suggestedClasses: number;
    potentialInlineStyleReduction: string;
    minDuplicatesThreshold: number;
    generatedAt: string;
  };
  suggested_classes: GcClass[];
  ungrouped_elements: UngroupedElement[];
  requires_abilities?: AbilityStatus[];
  agentInstructions: string[];
}

interface UngroupedElement {
  element_id: string;
  reason: string;
}

interface AbilityStatus {
  ability: string;
  status: string;
}

interface TreeElement {
  id: string;
  widget: string;
  props: StyleProps;
  filteredProps?: StyleProps;
}

interface SigGroup {
  props: StyleProps;
  elements: string[];
}

interface GcCandidateEntry {
  id: string;
  prop?: string;
  value?: unknown;
  color?: unknown;
  category?: string;
}

interface GcResultsMap {
  [label: string]: string;
}

interface TokenMapping {
  colors?: DesignToken[];
  fonts?: Record<string, { gv_id?: string }>;
  [key: string]: unknown;
}

type AbilityStatusMap = Record<string, string>;

// ── CLI ────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    tree:             { type: 'string' },
    variables:        { type: 'string' },
    output:           { type: 'string' },
    'min-dups':       { type: 'string', default: '2' },
    execute:          { type: 'boolean', default: false },
    'apply-results':  { type: 'string' },
    'check-abilities':{ type: 'boolean', default: false },
    'hide-missing':   { type: 'boolean', default: false },
    'mcp-config':     { type: 'string' },
    'local-bg-set':   { type: 'boolean', default: false },
    'gc-candidates':  { type: 'string' },
    verbose:          { type: 'boolean', default: false },
    help:             { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help) {
  console.log(`\n
generate-global-classes.ts

ZWECK:
  Analysiert einen V4 Widget-Tree, findet wiederkehrende Style-Patterns
  und schlaegt Global Classes vor.

OPTIONEN:
  --tree FILE             V4 Widget-Tree JSON (von convert-xml-to-v4.js)  [required]
  --variables FILE        token-mapping.json (fuer Variable-Aufloesung, optional)
  --output FILE           Output-Pfad fuer gc-plan.json
  --min-dups N            Mindest-Duplikate fuer GC-Vorschlag  [default: 2]
  --execute               MCP-Plan fuer Agent ausgeben (statt nur suggest)
  --apply-results FILE    gc-results.json -> GC-IDs in Tree schreiben
  --check-abilities       MCP-Bridge befragen welche referenced abilities existieren
  --hide-missing          mcp_calls mit nicht-existierenden abilities ausblenden
  --mcp-config FILE       Pfad zu .mcp.json (sonst ./ oder ../)
  --verbose               Ausfuehrliche Logs
  --help                  Diese Hilfe
`);
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────────────

const log = (...a: unknown[]) => args.verbose && process.stderr.write('[gen-gc] ' + a.join(' ') + '\n');
const warn = (...a: unknown[]) => process.stderr.write('[WARN] ' + a.join(' ') + '\n');
const fatal = (msg: string, code = 2): never => { process.stderr.write('[FATAL] ' + msg + '\n'); process.exit(code); };

const localBgSet = args['local-bg-set'] === true;
const MIN_DUPS = parseInt((args['min-dups'] as string) ?? '2', 10);

// ── Prop-Kategorien ─────────────────────────────────────────────────────────

const TYPOGRAPHY_PROPS = new Set([
  'font-size', 'font-family', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-transform',
  'text-decoration', 'color',
]);

const STRUCTURE_PROPS = new Set([
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding-inline-start', 'padding-inline-end', 'padding-block-start', 'padding-block-end',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'row-gap', 'column-gap',
  'max-width', 'min-width', 'max-height', 'min-height',
  'width', 'height',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink',
  'justify-content', 'align-items', 'align-self',
  'display', 'position',
]);

const BACKGROUND_PROPS = new Set([
  'background', 'background-color',
]);

function propCategory(prop: string): GcType {
  if (TYPOGRAPHY_PROPS.has(prop)) return 'typography';
  if (STRUCTURE_PROPS.has(prop)) return 'structure';
  if (BACKGROUND_PROPS.has(prop)) return 'background';
  return 'other';
}

// ── Hashing ─────────────────────────────────────────────────────────────────

function hashSignature(obj: unknown): string {
  const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  const str = stableStringify(obj);
  return createHash('md5').update(str).digest('hex').slice(0, 12);
}

// ── Semantic Naming (C4) ────────────────────────────────────────────────────

function getPxNumber(wrapped: unknown): number {
  if (!wrapped) return NaN;
  const v = typeof wrapped === 'object' ? ((wrapped as Record<string, unknown>).value as Record<string, unknown>)?.size ?? (wrapped as Record<string, unknown>).value : wrapped;
  const match = String(v).match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : NaN;
}

function findTokenByHex(hex: unknown, tokenMap: TokenMapping | null): string | null {
  if (!tokenMap || !hex) return null;
  const normHex = String(hex).replace('#', '').toLowerCase();
  for (const data of tokenMap.colors || []) {
    if (data.hex && data.hex.replace('#', '').toLowerCase() === normHex) {
      return (data.label || data.id).replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
    }
  }
  return null;
}

function suggestName(type: string, props: StyleProps, index: number, tokenMap: TokenMapping | null): string {
  const parts = ['gc'];
  const propKeys = Object.keys(props);

  if (type === 'typography') {
    parts.push('text');
    const fontSize = props['font-size'];
    const n = getPxNumber(fontSize);
    if (n >= 48) parts.push('xl');
    else if (n >= 28) parts.push('lg');
    else if (n >= 18) parts.push('md');
    else if (n >= 14) parts.push('sm');
    else parts.push('xs');
    const colorVal = (props['color'] as Record<string, unknown>)?.value;
    const token = findTokenByHex(colorVal, tokenMap);
    if (token) parts.push(token);
    else parts.push('neutral');
  } else if (type === 'structure') {
    const hasMaxWidth = propKeys.includes('max-width');
    const hasGap = propKeys.includes('gap');
    const hasPadding = propKeys.some(k => k.startsWith('padding'));
    if (hasMaxWidth && hasPadding) parts.push('section');
    else if (hasGap) parts.push('grid');
    else if (hasPadding) parts.push('pad');
    else parts.push('layout');
    parts.push(String(index));
  } else if (type === 'background') {
    parts.push('surface');
    const bgVal = (props['background-color'] as Record<string, unknown>)?.value;
    const token = findTokenByHex(bgVal, tokenMap);
    if (token) parts.push(token);
    else parts.push('neutral');
  } else {
    parts.push('style');
    parts.push(String(index));
  }

  return sanitizeGcName(parts.join('-'));
}

function sanitizeGcName(name: string): string {
  return name.replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// ── Tree durchlaufen ───────────────────────────────────────────────────────

function walkTree(node: unknown, cb: (node: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  cb(node as Record<string, unknown>);
  const n = node as Record<string, unknown>;
  const children = n.elements ?? n.children ?? [];
  if (Array.isArray(children)) {
    for (const child of children) walkTree(child, cb);
  }
}

function extractStyleProps(element: Record<string, unknown>): StyleProps {
  const styles = (element.styles ?? {}) as Record<string, { variants?: Array<{ meta?: { breakpoint?: unknown }; breakpoint?: unknown; props?: StyleProps; values?: StyleProps }> }>;
  const allProps: StyleProps = {};

  for (const styleDef of Object.values(styles)) {
    const variants = styleDef.variants ?? [];
    const baseVariant = variants.find(v => v?.meta?.breakpoint === null) ?? variants.find(v => v?.breakpoint === null || v?.breakpoint == null);
    if (!baseVariant) continue;

    const props = baseVariant.props ?? baseVariant.values ?? {};
    for (const [prop, value] of Object.entries(props)) {
      allProps[prop] = value;
    }
  }

  return allProps;
}

// ── Load tree ──────────────────────────────────────────────────────────────

if (!args.tree) fatal('--tree ist required');

const treePath = resolve(args.tree as string);
if (!existsSync(treePath)) fatal(`Tree nicht gefunden: ${treePath}`);

let tree: unknown;
try {
  tree = JSON.parse(readFileSync(treePath, 'utf8'));
} catch (e) {
  fatal(`JSON-Parse-Fehler: ${(e as Error).message}`);
}

let tokenMapping: TokenMapping = {};
if (args.variables && existsSync(resolve(args.variables as string))) {
  try {
    tokenMapping = JSON.parse(readFileSync(resolve(args.variables as string), 'utf8'));
    log(`Token-Mapping geladen: ${Object.keys(tokenMapping).length} Tokens`);
  } catch (e) {
    warn(`token-mapping.json konnte nicht geladen werden: ${(e as Error).message}`);
  }
}

// ── Analyse ────────────────────────────────────────────────────────────────

const allElements: TreeElement[] = [];
const treeRoots: unknown[] = Array.isArray(tree) ? tree : [tree];
for (const root of treeRoots) {
  walkTree(root, (node) => {
    const n = node as Record<string, unknown>;
    const id = (n.id ?? (n.settings as Record<string, unknown>)?.id) as string | undefined;
    if (!id) return;
    const props = extractStyleProps(node);
    if (Object.keys(props).length === 0) return;
    allElements.push({ id, widget: (n.widget ?? n.widgetType ?? 'unknown') as string, props });
  });
}

log(`${allElements.length} Elemente mit Styles gefunden`);

const typographySignatures = new Map<string, SigGroup>();
const structureSignatures = new Map<string, SigGroup>();
const backgroundElements: TreeElement[] = [];

for (const el of allElements) {
  const typoProps: StyleProps = {};
  const structProps: StyleProps = {};
  const bgProps: StyleProps = {};

  for (const [prop, value] of Object.entries(el.props)) {
    const cat = propCategory(prop);
    if (cat === 'typography') typoProps[prop] = value;
    else if (cat === 'structure') structProps[prop] = value;
    else if (cat === 'background') bgProps[prop] = value;
  }

  if (Object.keys(bgProps).length > 0) {
    backgroundElements.push({ ...el, filteredProps: bgProps });
  }

  if (Object.keys(typoProps).length > 0) {
    const sig = hashSignature(typoProps);
    if (!typographySignatures.has(sig)) {
      typographySignatures.set(sig, { props: typoProps, elements: [] });
    }
    typographySignatures.get(sig)!.elements.push(el.id);
  }

  if (Object.keys(structProps).length > 0) {
    const sig = hashSignature(structProps);
    if (!structureSignatures.has(sig)) {
      structureSignatures.set(sig, { props: structProps, elements: [] });
    }
    structureSignatures.get(sig)!.elements.push(el.id);
  }
}

// GC-Kandidaten aus --gc-candidates Begleitdatei (Sprint 20)
const otherCategoryCandidates: Record<string, TreeElement[]> = {};  if (args['gc-candidates']) {
  const candPath = resolve(args['gc-candidates'] as string);
  if (existsSync(candPath)) {
    try {
      const candidates = JSON.parse(readFileSync(candPath, 'utf8')) as Record<string, GcCandidateEntry[]>;
      let totalLoaded = 0;
      for (const [category, entries] of Object.entries(candidates)) {
        if (!Array.isArray(entries)) continue;
        for (const c of entries) {
          if (!c.id) continue;
          const prop = c.prop || category;
          const value = c.value !== undefined
            ? c.value
            : (c.color !== undefined ? { '$$type': 'background', value: { color: c.color } } : undefined);
          if (value === undefined) continue;

          const filteredProps: StyleProps = { [prop]: value };
          if (category === 'background') {
            backgroundElements.push({ id: c.id, widget: 'unknown', props: filteredProps, filteredProps });
          } else {
            (otherCategoryCandidates[category] ??= []).push({ id: c.id, widget: 'unknown', props: filteredProps, filteredProps });
          }
          totalLoaded++;
        }
      }
      log(`${totalLoaded} GC-Kandidat(en) aus ${candPath} geladen (Kategorien: ${Object.keys(candidates).join(', ')})`);
    } catch (e) {
      warn(`--gc-candidates konnte nicht gelesen werden: ${(e as Error).message}`);
    }
  } else {
    warn(`--gc-candidates Datei nicht gefunden: ${candPath}`);
  }
}

// ── Global-Class-Vorschläge ────────────────────────────────────────────────

const suggestedClasses: GcClass[] = [];
const ungroupedElements: UngroupedElement[] = [];
let gcIndex = 1;

// Typo-GCs (≥ MIN_DUPS Duplikate)
for (const [, { props, elements }] of typographySignatures) {
  if (elements.length >= MIN_DUPS) {
    const name = sanitizeGcName(suggestName('typography', props, gcIndex++, tokenMapping));
    const reason = `${elements.length} Elemente mit identischer Typografie: ${
      Object.keys(props).slice(0, 3).join(', ')
    }${Object.keys(props).length > 3 ? ', ...' : ''}`;

    suggestedClasses.push({
      name,
      type: 'typography',
      reason,
      element_ids: elements,
      props,
      mcp_calls: [
        {
          ability: 'novamira/adrians-add-global-class-variant',
          params: { name, type: 'class', props: props as Record<string, unknown> },
        },
      ],
    });
    log(`GC Typography: ${name} (${elements.length} Elemente)`);
  } else {
    for (const id of elements) {
      ungroupedElements.push({
        element_id: id,
        reason: `Unique Typografie, nur ${elements.length} Element${elements.length > 1 ? 'e' : ''} — lokaler Style`,
      });
    }
  }
}

// Struktur-GCs (≥ MIN_DUPS Duplikate)
for (const [, { props, elements }] of structureSignatures) {
  if (elements.length >= MIN_DUPS) {
    const name = sanitizeGcName(suggestName('structure', props, gcIndex++, tokenMapping));
    const reason = `${elements.length} Container mit identischem Layout: ${
      Object.keys(props).slice(0, 3).join(', ')
    }${Object.keys(props).length > 3 ? ', ...' : ''}`;

    suggestedClasses.push({
      name,
      type: 'structure',
      reason,
      element_ids: elements,
      props,
      mcp_calls: [
        {
          ability: 'novamira/adrians-add-global-class-variant',
          params: { name, type: 'class', props: props as Record<string, unknown> },
        },
      ],
    });
    log(`GC Structure: ${name} (${elements.length} Elemente)`);
  } else {
    for (const id of elements) {
      const already = ungroupedElements.find(u => u.element_id === id);
      if (!already) {
        ungroupedElements.push({
          element_id: id,
          reason: `Unique Layout, nur ${elements.length} Element${elements.length > 1 ? 'e' : ''} — lokaler Style`,
        });
      }
    }
  }
}

// Background-GCs (IMMER, auch bei 1 Element — Bug 3 Schutz)
if (localBgSet) {
  warn('--local-bg-set aktiv: background bereits als lokaler Style im Tree. Background-GCs werden übersprungen.');
  warn('Zum Aktivieren: convert-xml-to-v4.js --prefer-gc + generate-global-classes.ts (ohne --local-bg-set).');
} else {
  const bgSignatureMap = new Map<string, SigGroup>();
  for (const el of backgroundElements) {
    const sig = hashSignature(el.filteredProps ?? el.props);
    if (!bgSignatureMap.has(sig)) {
      bgSignatureMap.set(sig, { props: el.filteredProps ?? el.props, elements: [] });
    }
    bgSignatureMap.get(sig)!.elements.push(el.id);
  }

  for (const [, { props, elements }] of bgSignatureMap) {
    const name = sanitizeGcName(suggestName('background', props, gcIndex++, tokenMapping));
    const reason = elements.length > 1
      ? `${elements.length} Elemente mit identischer Hintergrundfarbe (background.color → IMMER GC)`
      : `background.color → IMMER GC (Bug 3 Schutz), auch bei nur 1 Element`;

    suggestedClasses.push({
      name,
      type: 'background',
      reason,
      element_ids: elements,
      props,
      mcp_calls: [
        {
          ability: 'novamira/adrians-add-global-class-variant',
          params: { name, type: 'class', props: props as Record<string, unknown> },
        },
      ],
    });
    log(`GC Background: ${name} (${elements.length} Elemente, Bug-3-Schutz)`);
  }
}

// Generische "Always-GC"-Kandidaten aus anderen Kategorien (Sprint 20)
for (const [category, candElements] of Object.entries(otherCategoryCandidates)) {
  const sigMap = new Map<string, SigGroup>();
  for (const el of candElements) {
    const sig = hashSignature(el.filteredProps ?? el.props);
    if (!sigMap.has(sig)) sigMap.set(sig, { props: el.filteredProps ?? el.props, elements: [] });
    sigMap.get(sig)!.elements.push(el.id);
  }
  for (const [, { props, elements }] of sigMap) {
    const name = sanitizeGcName(suggestName(category, props, gcIndex++, tokenMapping));
    const reason = elements.length > 1
      ? `${elements.length} Elemente mit identischem ${category}-Wert (via --gc-candidates, immer GC)`
      : `${category} → immer GC (via --gc-candidates), auch bei nur 1 Element`;

    suggestedClasses.push({
      name,
      type: category,
      reason,
      element_ids: elements,
      props,
      mcp_calls: [
        {
          ability: 'novamira/adrians-add-global-class-variant',
          params: { name, type: 'class', props: props as Record<string, unknown> },
        },
      ],
    });
    log(`GC ${category}: ${name} (${elements.length} Elemente, via --gc-candidates)`);
  }
}

// ── Dedup ──────────────────────────────────────────────────────────────────

const ungroupedIds = new Set<string>();
const dedupedUngrouped = ungroupedElements.filter(u => {
  if (ungroupedIds.has(u.element_id)) return false;
  ungroupedIds.add(u.element_id);
  return true;
});

const gcElementIds = new Set(suggestedClasses.flatMap(gc => gc.element_ids));
const finalUngrouped = dedupedUngrouped.filter(u => !gcElementIds.has(u.element_id));

// ── Ability-Prüfung (RC-12) ────────────────────────────────────────────────

async function probeAbilities(abilityNames: string[]): Promise<AbilityStatusMap> {
  const result: AbilityStatusMap = {};
  for (const name of abilityNames) result[name] = 'unknown';
  if (abilityNames.length === 0) return result;
  let McpBridgeMod: { McpBridge: { fromConfig(path?: string | null): Promise<{ call(ability: string, params: Record<string, unknown>): Promise<unknown> }> } };
  try {
    McpBridgeMod = await import('./lib/mcp-bridge.js') as typeof McpBridgeMod;
  } catch {
    log('McpBridge nicht ladbar');
    return result;
  }
  let mcp: { call(ability: string, params: Record<string, unknown>): Promise<unknown> };
  try {
    mcp = args['mcp-config']
      ? await McpBridgeMod.McpBridge.fromConfig(resolve(args['mcp-config'] as string))
      : await McpBridgeMod.McpBridge.fromConfig();
  } catch {
    log('MCP-Init fehlgeschlagen');
    return result;
  }
  await Promise.all(abilityNames.map(async (name) => {
    try {
      const r = await mcp.call(name, {}) as { error?: unknown; data?: { error?: unknown } };
      const errStr = String(r?.error || r?.data?.error || '');
      result[name] = /not found|ability.*not.*registered/i.test(errStr) ? 'missing' : 'available';
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      result[name] = /not found|ability.*not.*registered/i.test(msg) ? 'missing' : 'error';
    }
  }));
  return result;
}

if (args['check-abilities']) {
  const allAbilityNames = [...new Set(
    suggestedClasses.flatMap(gc => (gc.mcp_calls || []).map(c => c.ability).filter(Boolean))
  )];
  process.stderr.write(`[gen-gc] Prüfe ${allAbilityNames.length} abilities via MCP-Bridge...\n`);
  const abilityStatus = await probeAbilities(allAbilityNames);
  for (const gc of suggestedClasses) {
    for (const call of gc.mcp_calls || []) {
      call.status = abilityStatus[call.ability] || 'unknown';
    }
  }
  for (const [name, status] of Object.entries(abilityStatus)) {
    process.stderr.write(`[gen-gc]   ${status === 'available' ? '✅' : status === 'missing' ? '❌' : '⚠️ '} ${name} → ${status}\n`);
  }
  if (args['hide-missing']) {
    for (const gc of suggestedClasses) {
      gc.mcp_calls = (gc.mcp_calls || []).filter(c => c.status !== 'missing');
    }
    process.stderr.write(`[gen-gc] --hide-missing: mcp_calls mit missing abilities ausgeblendet.\n`);
  }
}

// ── Output ─────────────────────────────────────────────────────────────────

const inlineReductionPct = allElements.length > 0
  ? Math.round((gcElementIds.size / allElements.length) * 100)
  : 0;

const plan: GcPlan = {
  meta: {
    totalElements: allElements.length,
    elementsWithStyles: allElements.length,
    uniqueTypographyPatterns: typographySignatures.size,
    uniqueStructurePatterns: structureSignatures.size,
    backgroundElements: backgroundElements.length,
    suggestedClasses: suggestedClasses.length,
    potentialInlineStyleReduction: `${inlineReductionPct}%`,
    minDuplicatesThreshold: MIN_DUPS,
    generatedAt: new Date().toISOString(),
  },
  suggested_classes: suggestedClasses,
  ungrouped_elements: finalUngrouped,
  requires_abilities: args['check-abilities']
    ? [...new Set(suggestedClasses.flatMap(gc => (gc.mcp_calls || []).map(c => c.ability).filter(Boolean)))]
        .map(name => {
          const sample = suggestedClasses.find(gc => (gc.mcp_calls || []).some(c => c.ability === name));
          const status = sample?.mcp_calls?.find(c => c.ability === name)?.status || 'unknown';
          return { ability: name, status };
        })
    : undefined,
  agentInstructions: [
    'SCHRITT 1: suggested_classes[] reviewen (Namen ggf. anpassen)',
    'SCHRITT 2: Für jede GC in suggested_classes[]:',
    '  1. novamira/execute-php: Global Class registrieren (post_type e_global_class)',
    '  2. novamira/adrians-add-global-class-variant: Breakpoint-Varianten + Props setzen',
    '  3. novamira/adrians-apply-variable-to-class: GV-Referenzen setzen (fuer Token-Bindung)',
    'SCHRITT 3: V4 Tree aktualisieren:',
    '  Lokale Props aus element_ids[] entfernen',
    '  settings.classes.value[] mit GC-Name ergänzen',
    'SCHRITT 4: elementor-set-content aufrufen',
    '',
    '── SCHRITT 2: GC-Vorschläge prüfen ───────────────────────────────────────',
    'suggested_classes[] reviewen — Namen ggf. anpassen (gc-<semantic>-<variant>)',
    '',
    '── SCHRITT 3: GCs via elementor-set-content anlegen ──────────────────────',
    'WICHTIG: Es gibt keine eigene "create-global-class" Ability.',
    'GCs entstehen implizit wenn der Tree via elementor-set-content geschrieben wird.',
    'Der V4 Tree muss die GC-Props in settings.classes.value[] referenzieren.',
    '',
    '── SCHRITT 4: Responsive Varianten ergänzen ──────────────────────────────',
    'Nach Build für jede GC: novamira/adrians-add-global-class-variant',
    '  → breakpoint: "tablet" oder "mobile", props: { <skalierte Werte> }',
    '',
    '── SCHRITT 5: GC auf alle Elemente batch-anwenden ────────────────────────',
    'novamira/adrians-batch-class: { class_id: "<gc-id>", element_ids: [...], action: "apply" }',
    'Viel effizienter als einzelne adrians-remove-global-class Calls.',
    '',
    '── SCHRITT 6: Post-Build QA ──────────────────────────────────────────────',
    'novamira/adrians-visual-qa { post_id }     → overflow, z-index, negative margins',
    'novamira/adrians-responsive-audit { post_id } → Breakpoint-Coverage prüfen',
    'novamira/adrians-class-audit { scope: "post_ids", post_ids: [<ID>] } → unused GCs',
    'novamira/adrians-export-design-system { what: "classes" } → Design-System sichern',
    '',
    '── WICHTIG: Bug-3 Schutz ─────────────────────────────────────────────────',
    'background.color NIE als lokalen Style in props setzen.',
    'IMMER als GC anlegen, auch bei nur 1 Element.',
  ],
};

if (suggestedClasses.length === 0) {
  process.stderr.write('[gen-gc] Keine Duplikate gefunden — alle Styles sind unique.\n');
  if (!localBgSet) {
    process.stderr.write('[gen-gc] Hinweis: background.color-Elemente wurden trotzdem als GC markiert.\n');
  } else {
    process.stderr.write('[gen-gc] Hinweis: --local-bg-set aktiv — background.color wurde NICHT als GC markiert (bereits lokaler Style).\n');
  }
  process.exit(1);
}

// ── Plan-Fallback ──────────────────────────────────────────────────────────

function writeGcPlan(): void {
  const execPlan = {
    type: 'global-class-creation-plan',
    class_count: suggestedClasses.length,
    agent_instruction: [
      'Fuer jeden step in steps[]:',
      '  1. novamira/execute-php: Global Class registrieren (post_type e_global_class)',
      '  2. novamira/adrians-add-global-class-variant: Varianten + Props setzen',
      '  3. novamira/adrians-apply-variable-to-class: GV-Referenzen setzen',
      'Ergebnisse als gc-results.json: { "<gc-name>": "<gc-id>", ... }',
      'Dann: node scripts/generate-global-classes.ts --apply-results gc-results.json --tree <tree>',
    ],
    steps: suggestedClasses.map(gc => ({
      label: gc.name,
      create_ability: 'novamira/execute-php',
      create_params: {
        label: gc.name,
        styles: gc.props || {},
      },
      variants: (gc.variants || []).map(v => ({
        ability: 'novamira/adrians-add-global-class-variant',
        params: { class_id: '{{gc_id}}', breakpoint: v.breakpoint || 'mobile', props: v.props || {} },
      })),
      variable_bindings: (gc.variable_bindings || []).filter(b => b.gv_id).map(b => ({
        ability: 'novamira/adrians-apply-variable-to-class',
        params: { class_id: '{{gc_id}}', breakpoint: 'desktop', prop: b.prop, variable_id: b.gv_id! },
      })),
    })),
  };

  const planPath = (args.output as string) || 'gc-plan.json';
  writeFileSync(resolve(planPath), JSON.stringify(execPlan, null, 2), 'utf8');
  process.stderr.write(`[gc-execute] GC-Plan → ${planPath}\n`);
}

// ── executeGcPlan ───────────────────────────────────────────────────────────

interface McpBridge {
  call(ability: string, params: Record<string, unknown>): Promise<unknown>;
}

async function executeGcPlan(
  gcList: GcClass[],
  treeFilePath: string,
  treeData: unknown,
  mcp: McpBridge,
  tokenMapping: TokenMapping,
): Promise<void> {
  const gcIdMap: Record<string, string> = {};

  process.stderr.write('[gc-execute] Rufe setup-v4-foundation auf...\n');
  let foundation: { classes?: Record<string, string> };
  try {
    foundation = (await mcp.call('novamira/adrians-setup-v4-foundation', {})) as { classes?: Record<string, string> };
  } catch (err) {
    process.stderr.write(`[gc-execute] ⚠️  setup-v4-foundation fehlgeschlagen: ${(err as Error).message}\n`);
    process.stderr.write('[gc-execute] Fahre ohne bestehende GC-IDs fort.\n');
    foundation = { classes: {} };
  }

  const existingClasses = foundation.classes || {};
  process.stderr.write(`[gc-execute] ${Object.keys(existingClasses).length} bestehende GCs gefunden.\n`);

  let created = 0, skipped = 0, failed = 0;

  for (const gc of gcList) {
    const gcName = gc.name;
    process.stderr.write(`[gc-execute] GC: ${gcName} (${gc.type})...`);

    if (existingClasses[gcName]) {
      gcIdMap[gcName] = existingClasses[gcName];
      process.stderr.write(` ✅ existiert (${existingClasses[gcName]})\n`);
      skipped++;
      continue;
    }

    try {
      const escapedName = gcName.replace(/'/g, "\\'");
      const phpCode = [
        `$existing = get_page_by_path('${escapedName}', OBJECT, 'e_global_class');`,
        `if ($existing) { echo json_encode(['id' => 'gc-' . $existing->ID, 'post_id' => $existing->ID, 'existed' => true]); exit; }`,
        `$post_id = wp_insert_post([`,
        `  'post_title'  => '${escapedName}',`,
        `  'post_name'   => '${escapedName}',`,
        `  'post_type'   => 'e_global_class',`,
        `  'post_status' => 'publish',`,
        `]);`,
        `if (is_wp_error($post_id)) { echo json_encode(['error' => $post_id->get_error_message()]); exit; }`,
        `echo json_encode(['id' => 'gc-' . $post_id, 'post_id' => $post_id]);`,
      ].join('');

      let result: unknown;
      try {
        result = await mcp.call('novamira/execute-php', { code: phpCode });
      } catch {
        throw new Error('execute-php fehlgeschlagen');
      }

      const parsed = typeof result === 'string' ? JSON.parse(result) : (result as Record<string, unknown>);
      if (parsed.error) {
        throw new Error(`PHP-Fehler: ${parsed.error}`);
      }

      const gcId = (parsed.id as string) || `gc-${parsed.post_id}`;
      gcIdMap[gcName] = gcId;
      created++;
      process.stderr.write(` ✅ ${gcId}`);

      if (gc.props && Object.keys(gc.props).length > 0) {
        try {
          await mcp.call('novamira/adrians-add-global-class-variant', {
            class_id: gcId,
            breakpoint: 'desktop',
            props: gc.props as Record<string, unknown>,
          });
          process.stderr.write(' +variant');
        } catch (err) {
          process.stderr.write(` ⚠️variant:${(err as Error).message.slice(0, 60)}`);
        }
      }

      for (const variant of gc.variants || []) {
        try {
          await mcp.call('novamira/adrians-add-global-class-variant', {
            class_id: gcId,
            breakpoint: variant.breakpoint,
            props: variant.props || {},
          });
          process.stderr.write(` +${variant.breakpoint}`);
        } catch (err) {
          process.stderr.write(` ⚠️${variant.breakpoint}:${(err as Error).message.slice(0, 40)}`);
        }
      }

      for (const binding of gc.variable_bindings || []) {
        if (!binding.gv_id) continue;
        try {
          await mcp.call('novamira/adrians-apply-variable-to-class', {
            class_id: gcId,
            breakpoint: 'desktop',
            prop: binding.prop,
            variable_id: binding.gv_id,
          });
          process.stderr.write(` +gv:${binding.prop}`);
        } catch (err) {
          process.stderr.write(` ⚠️gv:${(err as Error).message.slice(0, 40)}`);
        }
      }

      process.stderr.write('\n');

    } catch (err) {
      process.stderr.write(` ❌ ${(err as Error).message.slice(0, 200)}\n`);
      failed++;
    }
  }

  // GC-IDs in Tree zurückschreiben
  const elementGcMap: Record<string, string[]> = {};
  for (const gc of gcList) {
    const gcId = gcIdMap[gc.name];
    if (!gcId) continue;
    for (const elemId of gc.element_ids) {
      if (!elementGcMap[elemId]) elementGcMap[elemId] = [];
      if (!elementGcMap[elemId].includes(gcId)) elementGcMap[elemId].push(gcId);
    }
  }

  let replacements = 0;

  if (Object.keys(elementGcMap).length > 0) {
    const roots: unknown[] = Array.isArray(treeData) ? treeData : [treeData];
    for (const root of roots) {
      walkTree(root, node => {
        const nn = node as Record<string, unknown>;
        const nodeId = (nn.id ?? (nn.settings as Record<string, unknown>)?.id) as string | undefined;
        if (!nodeId || !elementGcMap[nodeId]) return;

        const gcIds = elementGcMap[nodeId];

        if (!nn.settings) nn.settings = {};
        const settings = nn.settings as Record<string, unknown>;
        if (!settings.classes) {
          settings.classes = { '$$type': 'classes', value: [] };
        }
        const classes = (settings.classes as { value?: unknown[] }).value;
        if (!Array.isArray(classes)) {
          (settings.classes as { value: string[] }).value = [...gcIds];
          replacements += gcIds.length;
        } else {
          for (const gcId of gcIds) {
            if (!classes.includes(gcId)) {
              classes.push(gcId);
              replacements++;
            }
          }
        }
      });
    }

    const outputTreePath = args.output && args.output !== 'gc-plan.json'
      ? resolve(args.output as string)
      : treeFilePath;
    writeFileSync(outputTreePath, JSON.stringify(treeData, null, 2), 'utf8');
    process.stderr.write(`[gc-execute] Tree aktualisiert: ${replacements} GC-Referenzen auf ${Object.keys(elementGcMap).length} Elemente → ${outputTreePath}\n`);
  }

  process.stderr.write(
    `[gc-execute] ✅ ${created} erstellt, ${skipped} übersprungen, ${failed} fehlgeschlagen\n`
  );
}

// ── --execute: Direkte GC-Erstellung via McpBridge ─────────────────────────

if (args.execute) {
  let McpBridgeExec: typeof import('./lib/mcp-bridge.js').McpBridge;
  try {
    const mod = await import('./lib/mcp-bridge.js');
    McpBridgeExec = mod.McpBridge;
  } catch (e) {
    process.stderr.write(`[gc-execute] ⚠️  McpBridge nicht ladbar (${(e as Error).message}), wechsle zu Plan-Modus.\n`);
    writeGcPlan();
    process.exit(0);
  }

  let mcp: InstanceType<typeof McpBridgeExec>;
  try {
    mcp = await McpBridgeExec.fromConfig();
    process.stderr.write(`[gc-execute] MCP-Bridge verbunden: ${(mcp as unknown as { mcpUrl: string }).mcpUrl}\n`);
  } catch (e) {
    process.stderr.write(`[gc-execute] ⚠️  MCP-Konfiguration fehlgeschlagen: ${(e as Error).message}\n`);
    process.stderr.write('[gc-execute] Generiere GC-Plan fuer manuelle Agent-Ausfuehrung...\n');
    writeGcPlan();
    process.exit(0);
  }

  try {
    await executeGcPlan(suggestedClasses, treePath, tree, mcp, tokenMapping);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[gc-execute] ❌ GC-Execution fehlgeschlagen: ${(err as Error).message}\n`);
    process.stderr.write('[gc-execute] Fallback: GC-Plan fuer manuelle Ausfuehrung...\n');
    writeGcPlan();
    process.exit(1);
  }
}

// ── Standard: Plan-Datei schreiben ─────────────────────────────────────────

const defaultOut = join(treePath, '..', 'global-class-plan.json');
const outPath = args.output ? resolve(args.output as string) : defaultOut;
writeFileSync(outPath, JSON.stringify(plan, null, 2), 'utf8');
process.stderr.write(`[gen-gc] Plan geschrieben: ${outPath}\n`);
process.stderr.write(`[gen-gc] ${suggestedClasses.length} GC-Vorschläge, ${finalUngrouped.length} ungrouped\n`);

// ── --apply-results: Agent-GC-IDs → Tree zurückschreiben ───────────────────

if (args['apply-results']) {
  const { walkTree: wt } = await import('./lib/framer-utils.js');
  const resultsPath = resolve(args['apply-results'] as string);
  const treeInputPath = resolve((args.tree as string) || treePath);

  let gcIdMap: GcResultsMap;
  try {
    gcIdMap = JSON.parse(readFileSync(resultsPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`[gc-apply] Ungültiges JSON: ${resultsPath}: ${(e as Error).message}\n`);
    process.exit(1);
  }

  let treeData: unknown;
  try {
    treeData = JSON.parse(readFileSync(treeInputPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`[gc-apply] Tree nicht lesbar: ${treeInputPath}: ${(e as Error).message}\n`);
    process.exit(1);
  }

  let replacements = 0;
  wt(treeData, (node: Record<string, unknown>) => {
    if (!node.styles || typeof node.styles !== 'object') return;
    for (const styleId of Object.keys(node.styles as Record<string, unknown>)) {
      const gcId = gcIdMap[styleId];
      if (!gcId) continue;
      if (!node.settings) node.settings = {};
      const settings = node.settings as Record<string, unknown>;
      if (!settings.classes) settings.classes = { '$$type': 'classes', value: [] };
      const classes = (settings.classes as { value: unknown[] }).value;
      if (!Array.isArray(classes)) (settings.classes as { value: string[] }).value = [gcId];
      else if (!classes.includes(gcId)) classes.push(gcId);
      delete (node.styles as Record<string, unknown>)[styleId];
      replacements++;
    }
  });

  const outputPathApply = (args.output as string) || treeInputPath;
  writeFileSync(resolve(outputPathApply), JSON.stringify(treeData, null, 2), 'utf8');
  process.stderr.write(
    `[gc-apply] ✅ ${Object.keys(gcIdMap).length} GC-IDs verknuepft, ` +
    `${replacements} Tree-Referenzen ersetzt → ${outputPathApply}\n`
  );
  process.exit(0);
  process.stderr.write(
    `[gc-apply] ✅ ${Object.keys(gcIdMap).length} GC-IDs verknuepft, ` +
    `${replacements} Tree-Referenzen ersetzt → ${outputPathApply}\n`
  );
  process.exit(0);
}

// Standard-Modus: nur Plan ausgeben
console.log(JSON.stringify(plan, null, 2));
process.exit(0);
