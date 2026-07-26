#!/usr/bin/env node
/**
 * extract-framer-components.ts  —  A1: Component Extraction (Sprint 2)
 *
 * Analysiert Framer HTML/XML auf wiederholte Container-Muster und
 * extrahiert sie als V4 Atomic Component Blueprints.
 *
 * Usage:
 *   node --import tsx scripts/extract-framer-components.ts \
 *     --xml FramerExport/index.html \
 *     --output components/
 *   node --import tsx scripts/extract-framer-components.ts \
 *     --v4-tree v4-tree.json \
 *     --output components/
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { structuralHash } from './lib/framer-utils.js';

const { values: args } = parseArgs({
  options: {
    xml:      { type: 'string' },
    'v4-tree':{ type: 'string' },
    output:   { type: 'string' },
    'min-dups':{ type: 'string', default: '2' },
    verbose:  { type: 'boolean', default: false },
    help:     { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help || (!args.xml && !args['v4-tree'])) {
  console.log(`

extract-framer-components.ts  —  A1: Component Extraction (Sprint 2)

ZWECK:
  Analysiert Framer HTML/XML auf wiederholte Container-Muster und
  extrahiert sie als V4 Atomic Component Blueprints. Erkennt:
    • Wiederholte CSS-Selektoren (data-framer-name Pattern)
    • Strukturell identische Kind-Gruppen im V4 Tree (structuralHash)
    • Properties: Titel, Paragraph, Bild, Button/Link

EINGABE (mindestens eine):
  --xml FILE            Framer HTML/CSS Export
  --v4-tree FILE        V4 Widget-Tree JSON (von convert-xml-to-v4.ts)

OPTIONEN:
  --output DIR          Output-Verzeichnis (eine JSON pro Component +
                        components-plan.json)                [default: .]
  --min-dups N          Mindest-Wiederholungen fuer Component [default: 2]
  --verbose             Ausfuehrliche Logs
  --help                Diese Hilfe

BEISPIELE:
  # Aus Framer HTML-Export:
  node --import tsx scripts/extract-framer-components.ts \\\\
    --xml FramerExport/index.html \\\\
    --output components/

  # Aus V4 Tree (Pipeline Stage):
  node --import tsx scripts/extract-framer-components.ts \\\\
    --v4-tree v4-tree.json \\\\
    --output components/ \\\\
    --min-dups 3

  # Stdout (kein --output):
  node --import tsx scripts/extract-framer-components.ts --xml index.html

OUTPUT:
  components-plan.json  — Meta, alle Components, MCP-Routing
  <ComponentName>.json  — Einzelner Component Blueprint

MCP-ROUTING:
  create: novamira-adrianv2/create-component
  assign: novamira-adrianv2/insert-component
  (Beide existieren bereits — kein neues PHP noetig)

EXIT-CODES:
  0 = Components extrahiert
  1 = Keine wiederholten Muster gefunden
  2 = Eingabedatei nicht gefunden / kein Input-Flag
`);
  if (args.help) process.exit(0);
  process.exit(2);
}

const MIN_DUPS = parseInt(String(args['min-dups'] || '2'), 10);

const log = (...m: string[]) => { if (args.verbose) process.stderr.write('[comp-extract] ' + m.join(' ') + '\n'); };

// ─── Types ────────────────────────────────────────────────────────────────────

interface V4TreeNode {
  id?: string | number;
  elements?: V4TreeNode[];
  children?: V4TreeNode[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any;
  [key: string]: unknown;
}

interface PropertyField {
  type: 'text' | 'image' | 'link';
  default: string | number | { href: string; text: string };
  prop: string;
}

interface ComponentBlueprint {
  name: string;
  hash?: string | null;
  occurrences: number;
  parent_ids?: (string | number | undefined)[];
  selectors?: string[];
  properties: Record<string, PropertyField>;
  content?: V4TreeNode[];
}

interface RepeatingGroup {
  baseName: string;
  count: number;
  selectors: string[];
}

interface ComponentsResult {
  meta: {
    generatedAt: string;
    source: string | boolean | undefined;
    totalComponents: number;
    minDuplicates: number;
  };
  components: ComponentBlueprint[];
  mcpRouting: {
    create_ability: string;
    assign_ability: string;
    note: string;
  };
}

// ─── V4 Tree Mode ───────────────────────────────────────────────────────────

function extractComponentsFromV4Tree(tree: unknown): ComponentBlueprint[] {
  const roots: V4TreeNode[] = Array.isArray(tree) ? tree as V4TreeNode[] : [tree as V4TreeNode];
  const containerGroups = new Map<string, { template: V4TreeNode[]; occurrences: (string | number)[] }>();

  function walk(node: V4TreeNode): void {
    const children = node.elements || node.children || [];
    if (children.length >= 2) {
      const hash = structuralHash(children, { includeTag: true });
      if (hash && !containerGroups.has(hash)) {
        containerGroups.set(hash, { template: children, occurrences: [] });
      }
      if (hash) containerGroups.get(hash)!.occurrences.push(node.id || 'unknown');
    }
    for (const child of children) walk(child);
  }

  for (const root of roots) walk(root);

  const components: ComponentBlueprint[] = [];
  let idx = 1;

  for (const [hash, group] of containerGroups) {
    if (group.occurrences.length < MIN_DUPS) continue;

    const template = group.template;
    const props = extractProperties(template);

    components.push({
      name: props.name || `Component-${idx++}`,
      hash,
      occurrences: group.occurrences.length,
      parent_ids: group.occurrences,
      properties: props.fields,
      content: template,
    });
  }

  return components;
}

function extractProperties(template: V4TreeNode[]): { fields: Record<string, PropertyField>; name: string } {
  const fields: Record<string, PropertyField> = {};
  let suggestedName = '';

  for (const el of template) {
    const id = String(el.id || '');

    if (/heading|title/i.test(id)) {
      const text = String(
        el.settings?.title?.value?.content?.value ||
        el.settings?.text?.value?.content?.value || ''
      );
      fields[id] = { type: 'text', default: text, prop: 'title' };
      if (!suggestedName) suggestedName = text.replace(/[^a-zA-Z0-9]/g, '');
    }
    if (/paragraph|body|description/i.test(id)) {
      const text = String(
        el.settings?.paragraph?.value?.content?.value || ''
      );
      fields[id] = { type: 'text', default: text, prop: 'paragraph' };
    }
    if (/image|img|icon/i.test(id)) {
      const imgSrc: number =
        el.settings?.image?.value?.src?.value?.id ||
        el.settings?.['image-src']?.value?.id ||
        0;
      fields[id] = { type: 'image', default: imgSrc, prop: 'image' };
    }
    if (/button|cta|link/i.test(id)) {
      const href = String(
        el.settings?.link?.value?.destination?.value || ''
      );
      const text = String(
        el.settings?.text?.value?.content?.value || ''
      );
      fields[id] = { type: 'link', default: { href, text }, prop: 'link' };
    }

    // Recurse into children
    const children = el.elements || el.children || [];
    const childFields = extractProperties(children);
    Object.assign(fields, childFields.fields);
    if (!suggestedName && childFields.name) suggestedName = childFields.name;
  }

  return { fields, name: suggestedName };
}

// ─── XML Mode (Framer HTML Export) ──────────────────────────────────────────

function extractCssFromHtml(html: string): string {
  const blocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html)) !== null) blocks.push(m[1]);
  return blocks.join('\n');
}

function findRepeatingSelectors(css: string): RepeatingGroup[] {
  const ruleMap = new Map<string, { selector: string; body: string }[]>();
  const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();
    // Gruppiere nach data-framer-name pattern
    const nameMatch = selector.match(/\[data-framer-name=["']([^"']+)["']\]/);
    const baseName = nameMatch ? nameMatch[1].replace(/[\d-]+$/g, '') : selector;
    if (!ruleMap.has(baseName)) ruleMap.set(baseName, []);
    ruleMap.get(baseName)!.push({ selector, body });
  }

  const repeating: RepeatingGroup[] = [];
  for (const [baseName, rules] of ruleMap) {
    if (rules.length >= MIN_DUPS) {
      repeating.push({ baseName, count: rules.length, selectors: rules.map(r => r.selector) });
    }
  }
  return repeating;
}

function buildTemplateFromRepeat(repeatingGroup: RepeatingGroup): ComponentBlueprint {
  const name = repeatingGroup.baseName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'Component';
  const firstSelector = repeatingGroup.selectors[0];
  const selectorMatch = firstSelector.match(/\[data-framer-name=["']([^"']+)["']\]/);
  const displayName = selectorMatch ? selectorMatch[1] : name;

  return {
    name: displayName,
    occurrences: repeatingGroup.count,
    selectors: repeatingGroup.selectors,
    properties: {
      title: { type: 'text', default: displayName, prop: 'title' },
    },
  };
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

const components: ComponentBlueprint[] = [];

if (args['v4-tree']) {
  const v4TreePath = args['v4-tree'] as string;
  if (!fs.existsSync(v4TreePath)) {
    process.stderr.write(`Error: v4-tree not found: ${v4TreePath}\n`);
    process.exit(2);
  }
  const tree = JSON.parse(fs.readFileSync(v4TreePath, 'utf8')) as unknown;
  const v4Comps = extractComponentsFromV4Tree(tree);
  components.push(...v4Comps);
}

if (args.xml) {
  const xmlPath = args.xml as string;
  if (!fs.existsSync(xmlPath)) {
    process.stderr.write(`Error: XML/HTML not found: ${xmlPath}\n`);
    process.exit(2);
  }
  const html = fs.readFileSync(xmlPath, 'utf8');
  const css = extractCssFromHtml(html);
  const repeating = findRepeatingSelectors(css);

  for (const group of repeating) {
    const comp = buildTemplateFromRepeat(group);
    components.push(comp);
  }
}

// ─── OUTPUT ─────────────────────────────────────────────────────────────────

const result: ComponentsResult = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: args['v4-tree'] || args.xml,
    totalComponents: components.length,
    minDuplicates: MIN_DUPS,
  },
  components,
  mcpRouting: {
    create_ability: 'novamira-adrianv2/create-component',
    assign_ability: 'novamira-adrianv2/insert-component',
    note: 'B1-B3: Diese Abilities existieren bereits im novamira-adrianv2 Plugin. Kein neues PHP noetig.',
  },
};

const outDir = (args.output || '.') as string;
if (components.length > 0) {
  fs.mkdirSync(path.resolve(outDir), { recursive: true });

  for (const comp of components) {
    const compPath = path.join(outDir, `${comp.name.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`);
    fs.writeFileSync(compPath, JSON.stringify(comp, null, 2), 'utf8');
    log(`Component: ${comp.name} → ${compPath}`);
  }
}

const summaryPath = path.join(outDir, 'components-plan.json');
fs.writeFileSync(summaryPath, JSON.stringify(result, null, 2), 'utf8');

process.stderr.write(`[comp-extract] ${components.length} components extracted → ${outDir}\n`);
if (components.length === 0) {
  process.stderr.write('[comp-extract] No repeating patterns found.\n');
}

process.exit(0);
