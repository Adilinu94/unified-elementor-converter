#!/usr/bin/env node
/**
 * build-dependency-graph.ts
 * Framer -> Elementor V4 Conversion Tool
 *
 * Baut aus Framer-Component-Daten einen Dependency-Graphen
 * und berechnet die korrekte Build-Reihenfolge via Kahn's Algorithm.
 *
 * Usage:
 *   node --import tsx scripts/build-dependency-graph.ts --input FramerExport/page.json
 *   node --import tsx scripts/build-dependency-graph.ts --input data.json --format markdown
 *   node --import tsx scripts/build-dependency-graph.ts --unframer-xml framer-nodes.xml
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'node:util';

// ─── TYPES ───────────────────────────────────────────────────────────────────

type GraphEdgeMap = Record<string, string[]>;

interface BuildOrderResult {
  order: string[];
  cycles: string[];
  processed: number;
  total: number;
}

interface GraphData {
  graph: GraphEdgeMap;
  source: string;
  meta?: unknown;
  propHashes?: string[];
}

interface ComponentMeta {
  children?: string[];
  dependencies?: string[];
  uses?: string[];
}

interface BuildStep {
  step: number;
  component: string;
  dependencies: string[];
  isLeaf: boolean;
}

interface BuildOrderOutput {
  meta: {
    generated: string;
    totalComponents: number;
    buildSteps: number;
    hasCycles: boolean;
  };
  buildOrder: BuildStep[];
  cycles: string[];
  graph: GraphEdgeMap;
}

// ─── CLI ARGS ────────────────────────────────────────────────────────────────

const { values: rawArgs } = parseArgs({
  options: {
    input:            { type: 'string' },
    'unframer-xml':   { type: 'string' },
    output:           { type: 'string' },
    format:           { type: 'string', default: 'json' },
    'fail-on-cycle':  { type: 'boolean', default: true },
    'no-fail-on-cycle': { type: 'boolean', default: false },
    verbose:          { type: 'boolean', default: false },
  },
  strict: false,
});

const args = {
  ...rawArgs,
  'fail-on-cycle': rawArgs['no-fail-on-cycle'] ? false : rawArgs['fail-on-cycle'],
};

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node --import tsx scripts/build-dependency-graph.ts [options]');
  console.log('');
  console.log('  --input <path>          Framer component JSON or markdown inventory');
  console.log('  --unframer-xml <path>   Framer XML from getNodeXml()');
  console.log('  --output <path>         Output file (default: stdout)');
  console.log('  --format <json|md>      Output format (default: json)');
  console.log('  --no-fail-on-cycle      Continue even if dependency cycle detected');
  console.log('  --verbose               Show extra debug output');
  console.log('');
  console.log('Examples:');
  console.log('  node --import tsx scripts/build-dependency-graph.ts --input FramerExport/page.json');
  console.log('  node --import tsx scripts/build-dependency-graph.ts --input data.json --format markdown');
  process.exit(0);
}

// ─── KAHN'S ALGORITHM ───────────────────────────────────────────────────────

function getBuildOrder(graph: GraphEdgeMap): BuildOrderResult {
  const allNodes = new Set(Object.keys(graph));

  for (const deps of Object.values(graph)) {
    for (const dep of deps) {
      if (!allNodes.has(dep)) {
        allNodes.add(dep);
        graph[dep] = graph[dep] ?? [];
      }
    }
  }

  const nodes = [...allNodes];
  const inDegreeCorrect: Record<string, number> = {};
  for (const node of nodes) inDegreeCorrect[node] = 0;
  for (const [node, deps] of Object.entries(graph)) {
    inDegreeCorrect[node] = deps.length;
  }

  const queue = nodes.filter(n => inDegreeCorrect[n] === 0).sort();
  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    for (const [other, deps] of Object.entries(graph)) {
      if (deps.includes(node)) {
        inDegreeCorrect[other]--;
        if (inDegreeCorrect[other] === 0) {
          queue.push(other);
          queue.sort();
        }
      }
    }
  }

  const processed = result.length;
  const total = nodes.length;
  const cycles = nodes.filter(n => !result.includes(n));

  return { order: result, cycles, processed, total };
}

// ─── INPUT PARSING ──────────────────────────────────────────────────────────

function parseJsonInput(filePath: string): GraphData {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data: Record<string, unknown> = JSON.parse(raw);

  // Format 1: Direct adjacency list { ComponentName: [dep1, dep2] }
  if (typeof data === 'object' && !data.components && !data.pages) {
    const isAdjacency = Object.values(data).every(v => Array.isArray(v));
    if (isAdjacency) {
      return { graph: data as unknown as GraphEdgeMap, source: 'adjacency-list' };
    }
  }

  // Format 2: { components: { Name: { children: [], props: [] } } }
  if (data.components) {
    const graph: GraphEdgeMap = {};
    const comps = data.components as Record<string, ComponentMeta>;
    for (const [name, meta] of Object.entries(comps)) {
      graph[name] = [
        ...(meta.children ?? []),
        ...(meta.dependencies ?? []),
      ];
    }
    return { graph, source: 'components-object', meta: data };
  }

  // Format 3: Array of component objects
  if (Array.isArray(data)) {
    const graph: GraphEdgeMap = {};
    for (const item of data) {
      const rec = item as Record<string, unknown>;
      const name = (rec.name ?? rec.id) as string;
      if (!name) continue;
      graph[name] = [
        ...(rec.children as string[] ?? []),
        ...(rec.dependencies as string[] ?? []),
        ...(rec.uses as string[] ?? []),
      ];
    }
    return { graph, source: 'component-array', meta: data };
  }

  throw new Error(`Unbekanntes JSON-Format in ${filePath}`);
}

function parseMarkdownInput(filePath: string): GraphData {
  const raw = fs.readFileSync(filePath, 'utf8');
  const graph: GraphEdgeMap = {};

  const lines = raw.split('\n');
  let currentComponent: string | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      currentComponent = headingMatch[1].trim();
      if (!graph[currentComponent]) graph[currentComponent] = [];
      continue;
    }

    const listItemMatch = line.match(/^[-*]\s+\*?\*?([A-Z][A-Za-z\s]+?)\*?\*?\s*($|[:(,])/);
    if (listItemMatch) {
      const compName = listItemMatch[1].trim();
      if (!graph[compName]) graph[compName] = [];
      currentComponent = compName;
    }

    const refMatch = line.match(/referenziert?\s+([A-Z][A-Za-z\s,]+)/i);
    if (refMatch && currentComponent) {
      const deps = refMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      graph[currentComponent] = [...new Set([...graph[currentComponent], ...deps])];
    }

    const arrowMatch = line.match(/^[-*]?\s*([A-Z][A-Za-z\s]+?)\s*->\s*([A-Z][A-Za-z\s]+)/);
    if (arrowMatch) {
      const p = arrowMatch[1].trim();
      const c = arrowMatch[2].trim();
      if (!graph[p]) graph[p] = [];
      if (!graph[p].includes(c)) graph[p].push(c);
    }
  }

  const knownDeps: GraphEdgeMap = {
    'FAQs':             ['Faq Row'],
    'Faq Row':          ['Primary Button'],
    'Slider Card':      ['Testimonial Card'],
    'Single Innovators Card': ['Social Icons'],
    'Socials for Teams': ['X-Icon', 'Instagram Icon', 'Linkedin Icon'],
    'FAQ':              ['Faq Row'],
    'Faq Items':        ['Faq Row'],
  };

  for (const [comp, deps] of Object.entries(knownDeps)) {
    if (graph[comp] !== undefined) {
      graph[comp] = [...new Set([...graph[comp], ...deps])];
    }
  }

  return { graph, source: 'markdown-inventory' };
}

function parseXmlInput(filePath: string): GraphData {
  const raw = fs.readFileSync(filePath, 'utf8');
  const graph: GraphEdgeMap = {};

  const componentMatches = [...raw.matchAll(/component[Nn]ame="([^"]+)"/g)];
  const nameMatches = [...raw.matchAll(/\bname="([^"]+)"/g)];

  const allNames = [
    ...componentMatches.map(m => m[1]),
    ...nameMatches.map(m => m[1]),
  ].filter(n => /^[A-Z]/.test(n));

  for (const name of allNames) {
    if (!graph[name]) graph[name] = [];
  }

  const propHashPattern = /\b([A-Za-z0-9]{9})\b/g;
  const propHashes = [...new Set([...raw.matchAll(propHashPattern)].map(m => m[1]))];
  if (args.verbose && propHashes.length > 0) {
    console.error(`[XML] ${propHashes.length} unaufgeloeste Prop-Hashes gefunden (Unframer MCP benoetigt)`);
  }

  return { graph, source: 'unframer-xml', propHashes };
}

// ─── KNOWN COMPONENT GRAPH ──────────────────────────────────────────────────

function getKnownComponentGraph(): GraphEdgeMap {
  return {
    'Navigation':               [],
    'Footer':                   ['Footer Social', 'Footer Navlink'],
    'Footer Social':            [],
    'Footer Navlink':           [],
    'Nab Link':                 [],
    'Nav Menu':                 ['Nab Link'],
    'Primary Button':           [],
    'Newsletter Submit Button': [],
    'Submit Button':            [],
    'Blog Button':              [],
    'CTA Section':              ['Primary Button'],
    'Single Value Card':        [],
    'Sustainable Service Card': [],
    'Single Crafted Card':      [],
    'Statistics Image Short Card': [],
    'Statistics Text Card Short':  [],
    'Blog Card':                ['Blog Button'],
    'Pricing Single Card':      ['Primary Button'],
    'Single Pricing Options':   ['Pricing Single Card'],
    'Single Innovators Card':   ['Socials for Teams'],
    'X-Icon':                   [],
    'Instagram Icon':           [],
    'Linkedin Icon':            [],
    'Socials for Teams':        ['X-Icon', 'Instagram Icon', 'Linkedin Icon'],
    'Logo Slider':              [],
    'Slider Card':              ['Testimonial Card'],
    'Accordion':                [],
    'Tab Button':               [],
    'Tab Content':              [],
    'Faq Items':                ['Faq Row'],
    'Faq Row':                  ['Primary Button'],
    'FAQs':                     ['Faq Row'],
    'About Us Statistic Item':  [],
    'Testimonial Card':         [],
  };
}

// ─── OUTPUT FORMATTING ──────────────────────────────────────────────────────

function formatJson(result: BuildOrderResult, graph: GraphEdgeMap): string {
  const output: BuildOrderOutput = {
    meta: {
      generated: new Date().toISOString(),
      totalComponents: result.total,
      buildSteps: result.order.length,
      hasCycles: result.cycles.length > 0,
    },
    buildOrder: result.order.map((name, index) => ({
      step: index + 1,
      component: name,
      dependencies: graph[name] ?? [],
      isLeaf: (graph[name] ?? []).length === 0,
    })),
    cycles: result.cycles,
    graph,
  };
  return JSON.stringify(output, null, 2);
}

function computeLayers(graph: GraphEdgeMap, buildOrder: string[]): string[][] {
  const layers: string[][] = [];
  const placed = new Set<string>();

  for (const node of buildOrder) {
    const deps = graph[node] ?? [];
    let layerIndex = 0;
    for (const dep of deps) {
      for (let li = 0; li < layers.length; li++) {
        if (layers[li].includes(dep)) {
          layerIndex = Math.max(layerIndex, li + 1);
        }
      }
    }
    if (!layers[layerIndex]) layers[layerIndex] = [];
    layers[layerIndex].push(node);
    placed.add(node);
  }

  return layers;
}

function formatMarkdown(result: BuildOrderResult, graph: GraphEdgeMap): string {
  const lines: string[] = [
    '# Framer Component Build Order',
    '',
    `> Generiert: ${new Date().toISOString()}`,
    `> Components: ${result.total} | Build-Steps: ${result.order.length}`,
    '',
  ];

  if (result.cycles.length > 0) {
    lines.push('## ⚠️  Circular Dependencies Detected');
    lines.push('');
    for (const c of result.cycles) {
      lines.push(`- **${c}** (in Zyklus)`);
    }
    lines.push('');
  }

  lines.push('## Build-Reihenfolge');
  lines.push('');
  lines.push('| Schritt | Component | Leaf | Dependencies |');
  lines.push('|---------|-----------|------|--------------|');

  for (const [i, name] of result.order.entries()) {
    const deps = graph[name] ?? [];
    const isLeaf = deps.length === 0;
    const depsStr = deps.length > 0 ? deps.join(', ') : '-';
    lines.push(`| ${i + 1} | ${name} | ${isLeaf ? 'Yes' : 'No'} | ${depsStr} |`);
  }

  lines.push('');
  lines.push('## Layer-Gruppen');
  lines.push('');

  const layers = computeLayers(graph, result.order);
  for (const [layerIndex, layer] of layers.entries()) {
    lines.push(`### Layer ${layerIndex + 1} (parallel baubar)`);
    for (const comp of layer) {
      lines.push(`- ${comp}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let graphData: GraphData | null = null;

  const inputPath = args.input as string | undefined;
  const xmlPath = args['unframer-xml'] as string | undefined;

  if (!inputPath && !xmlPath) {
    console.error('[INFO] Kein --input angegeben. Verwende bekannte Novamira-Framer-Components.');
    graphData = {
      graph: getKnownComponentGraph(),
      source: 'built-in-inventory',
    };
  } else if (xmlPath) {
    graphData = parseXmlInput(xmlPath);
  } else if (inputPath) {
    const ext = path.extname(inputPath).toLowerCase();

    if (!fs.existsSync(inputPath)) {
      console.error(`[ERROR] Datei nicht gefunden: ${inputPath}`);
      process.exit(1);
    }

    if (ext === '.json') {
      graphData = parseJsonInput(inputPath);
    } else if (ext === '.md' || ext === '.markdown') {
      graphData = parseMarkdownInput(inputPath);
    } else {
      console.error(`[ERROR] Unbekanntes Dateiformat: ${ext} (erwartet: .json, .md)`);
      process.exit(1);
    }
  }

  const { graph, source } = graphData!;

  if (args.verbose) {
    console.error(`[INFO] Quelle: ${source}`);
    console.error(`[INFO] Components gefunden: ${Object.keys(graph).length}`);
  }

  const result = getBuildOrder({ ...graph });

  if (result.cycles.length > 0) {
    console.error(`[WARN] ${result.cycles.length} Component(s) in Zyklus: ${result.cycles.join(', ')}`);
    if (args['fail-on-cycle']) {
      console.error('[ERROR] Build abgebrochen wegen Circular Dependency. --fail-on-cycle=false zum Ignorieren.');
      process.exit(2);
    }
  }

  let output = '';
  const fmt = (args.format as string) || 'json';

  if (fmt === 'json') {
    output = formatJson(result, graph);
  } else if (fmt === 'markdown' || fmt === 'md') {
    output = formatMarkdown(result, graph);
  } else if (fmt === 'both') {
    output = formatJson(result, graph) + '\n\n---\n\n' + formatMarkdown(result, graph);
  } else {
    output = formatJson(result, graph);
  }

  const outputPath = args.output as string | undefined;
  if (outputPath) {
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf8');
    console.error(`[OK] Ergebnis gespeichert: ${outputPath}`);
  } else {
    process.stdout.write(output + '\n');
  }

  process.exit(result.cycles.length > 0 && (args['fail-on-cycle'] as boolean) ? 2 : 0);
}

main().catch((err: Error) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
