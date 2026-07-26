#!/usr/bin/env node
/**
 * generate-component-cache.ts — Phase 10+12: Component Resolution
 *
 * Extrahiert alle e-component-IDs aus einem V4-Tree und generiert
 * eine component-cache.json.
 *
 * Ohne Unframer MCP: Components werden zu e-flexbox-Containern mit
 * dem Component-Namen als inline-Heading downgraded.
 *
 * MIT Unframer MCP (Phase 12): Wenn --components-dir angegeben wird,
 * liest das Skript echte Component-XMLs (<cid>.xml) aus diesem
 * Verzeichnis und konvertiert sie via convert-xml-to-v4.js in
 * vollständige V4-Widget-Trees — KEIN Downgrade mehr.
 *
 * Usage:
 *   # Ohne Unframer (Downgrade-Fallback):
 *   node --import tsx scripts/generate-component-cache.ts \
 *     --tree v4-output/elements.json \
 *     --output v4-output/component-cache.json
 *
 *   # Mit Unframer MCP (Phase 12 — echte Component-Trees):
 *   node --import tsx scripts/generate-component-cache.ts \
 *     --tree v4-output/elements.json \
 *     --components-dir exports/my-project/components/ \
 *     --token-map exports/my-project/tokens/token-mapping.json \
 *     --output v4-output/component-cache.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

// ─── Typen ─────────────────────────────────────────────────────────────────────

interface SettingValue {
  '$$type'?: string;
  value?: unknown;
}

interface V4Settings {
  'component-id'?: SettingValue;
  classes?: SettingValue;
  tag?: string;
  title?: SettingValue;
  [key: string]: SettingValue | string | undefined;
}

interface V4Node {
  type?: string;
  elType?: string;
  widgetType?: string;
  id?: string;
  settings?: V4Settings;
  styles?: Record<string, unknown>;
  elements?: V4Node[];
}

interface ComponentInfo {
  componentId: string;
  overrides: Record<string, unknown>;
  occurrences: number;
  parentTypes: string[];
  sampleClasses: unknown;
  source: string;
}

interface ComponentCacheEntry {
  type: string;
  elType: string;
  widgetType: string;
  id: string;
  settings: V4Settings;
  styles: Record<string, unknown>;
  elements: V4Node[];
}

// ─── CLI-Args ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const { values: args } = parseArgs({
  options: {
    tree:            { type: 'string' },
    'components-dir': { type: 'string' },   // Phase 12: dir with <componentId>.xml files
    'token-map':     { type: 'string' },    // Phase 12: token-mapping for style resolution
    'style-map':     { type: 'string' },    // Phase 12+: style-map from extract-style-map.js
    output:          { type: 'string' },
    verbose:         { type: 'boolean', default: false },
  },
  strict: false,
});

if (!args.tree) {
  console.error('Error: --tree required');
  console.error('Usage: node --import tsx scripts/generate-component-cache.ts --tree <v4-tree.json> [--components-dir <dir>] [--token-map <token-mapping.json>] --output <cache.json>');
  process.exit(2);
}

const log  = (...m: string[]) => {
  if (args.verbose) process.stderr.write('[comp-cache] ' + m.join(' ') + '\n');
};
const warn = (...m: string[]) =>
  process.stderr.write('\u26A0 ' + m.join(' ') + '\n');

// ── Validate Phase 12 inputs ──────────────────────────────────

const componentsDir: string | null = (args['components-dir'] as string) || null;
const tokenMapPath: string | null = (args['token-map'] as string) || null;

let componentsDirExists = false;
if (componentsDir) {
  componentsDirExists = fs.existsSync(componentsDir) && fs.statSync(componentsDir).isDirectory();
  if (!componentsDirExists) {
    warn(`--components-dir '${componentsDir}' nicht gefunden oder kein Verzeichnis. Falle zurück auf Downgrade.`);
  } else {
    log(`Phase 12: Component-XML-Resolution aktiv — lese aus ${componentsDir}`);
  }
}

let tokenMapExists = false;
if (tokenMapPath) {
  tokenMapExists = fs.existsSync(tokenMapPath);
  if (!tokenMapExists) {
    warn(`--token-map '${tokenMapPath}' nicht gefunden. Component-Konvertierung ohne Token-Mapping.`);
  }
}

// ── Load tree ──────────────────────────────────────────────────

const tree = JSON.parse(fs.readFileSync(args.tree as string, 'utf8'));

// Collect unique component IDs with metadata
const componentMap = new Map<string, ComponentInfo>();

function walk(node: V4Node, parentType: string = 'root'): void {
  if (!node || typeof node !== 'object') return;

  if (node.widgetType === 'e-component') {
    const cid = (node.settings?.['component-id']?.value as string) || 'unknown';
    if (!componentMap.has(cid)) {
      // Extract text overrides from component instance
      const overrides: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node.settings || {})) {
        if (key.startsWith('property-')) {
          const propName = key.replace('property-', '');
          overrides[propName] = typeof val === 'object' ? (val as SettingValue).value : val;
        }
      }

      componentMap.set(cid, {
        componentId: cid,
        overrides,
        occurrences: 1,
        parentTypes: [parentType],
        sampleClasses: node.settings?.classes?.value || [],
        source: 'unknown',  // filled below
      });
    } else {
      const entry = componentMap.get(cid)!;
      entry.occurrences++;
      if (!entry.parentTypes.includes(parentType)) entry.parentTypes.push(parentType);
    }
  }

  if (node.elements) {
    for (const child of node.elements) {
      walk(child, node.widgetType || node.elType || '?');
    }
  }
}

const roots: V4Node[] = Array.isArray(tree) ? tree : [tree];
roots.forEach(r => walk(r));

log(`Found ${componentMap.size} unique component IDs across all instances`);

// ── Phase 12: Resolve component XMLs via Unframer MCP ──────────

/**
 * Converts a Framer XML string to a V4 widget tree using
 * convert-xml-to-v4.js as a child process.
 */
function convertXmlToV4(xmlContent: string): V4Node | V4Node[] | null {
  const convertScript = path.join(__dirname, 'convert-xml-to-v4.js');

  const spawnArgs: string[] = [
    convertScript,
    '--xml-string', xmlContent,
  ];

  // Pass token-map if available for GV-color/font resolution
  if (tokenMapPath && tokenMapExists) {
    spawnArgs.push('--tokens', tokenMapPath);
  }

  // Pass style-map if available for inlineTextStyle resolution
  if (args['style-map'] && fs.existsSync(args['style-map'] as string)) {
    spawnArgs.push('--style-map', args['style-map'] as string);
  }

  if (args.verbose) {
    spawnArgs.push('--verbose');
  }

  try {
    const result = spawnSync(process.execPath, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });

    if (result.status !== 0) {
      const stderr = (result.stderr || '').toString().slice(0, 300);
      warn(`convert-xml-to-v4.js exit code ${result.status}: ${stderr}`);
      return null;
    }

    // Parse stdout as JSON V4 tree
    const stdout = (result.stdout || '').toString().trim();
    if (!stdout) {
      warn('convert-xml-to-v4.js produced empty output');
      return null;
    }

    try {
      const v4Tree: V4Node | V4Node[] = JSON.parse(stdout);
      // Handle both single-node output and array output
      if (Array.isArray(v4Tree)) {
        // Component XML typically produces one root node
        return v4Tree.length === 1 ? v4Tree[0] : v4Tree;
      }
      return v4Tree;
    } catch (parseErr) {
      warn(`Failed to parse convert-xml-to-v4.js output as JSON: ${(parseErr as Error).message}`);
      return null;
    }
  } catch (err) {
    warn(`convert-xml-to-v4.js spawn failed: ${(err as Error).message}`);
    return null;
  }
}

// ── Build component cache: Component ID → V4 Tree ──────────────

const componentCache: Record<string, V4Node | V4Node[] | ComponentCacheEntry> = {};
let resolvedCount = 0;
let downgradedCount = 0;
let failedCount = 0;

for (const [cid, info] of componentMap) {
  // ── Phase 12: Try Unframer MCP component XML first ──
  let resolvedTree: V4Node | V4Node[] | ComponentCacheEntry | null = null;

  if (componentsDir && componentsDirExists) {
    const xmlPath = path.join(componentsDir, `${cid}.xml`);

    if (fs.existsSync(xmlPath)) {
      log(`  Phase 12: Resolving ${cid} from ${xmlPath}`);
      try {
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
        const converted = convertXmlToV4(xmlContent);

        if (converted) {
          resolvedTree = converted;
          info.source = 'unframer';
          resolvedCount++;
          log(`    → Resolved: ${Array.isArray(converted) ? 'array' : converted.widgetType || converted.type || 'tree'} (${countNodes(converted)} nodes)`);
        } else {
          warn(`    → Konvertierung fehlgeschlagen für ${cid}, falle zurück auf Downgrade`);
          info.source = 'unframer-failed';
          failedCount++;
        }
      } catch (err) {
        warn(`    → Fehler beim Lesen von ${xmlPath}: ${(err as Error).message}`);
        info.source = 'unframer-error';
        failedCount++;
      }
    } else {
      log(`  ${cid}: keine XML-Datei in ${componentsDir} — Downgrade`);
    }
  }

  // ── Fallback: Downgrade to e-flexbox with label ──
  if (!resolvedTree) {
    if (!info.source || info.source === 'unknown') {
      info.source = 'downgrade';
    }
    // Only count as genuine downgrade when no XML file existed at all
    // (failed resolutions are counted separately in failedCount)
    if (info.source === 'downgrade') {
      downgradedCount++;
    }

    const label = `Component: ${cid}`;
    const styleId = 'fecomp' + cid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);

    // Find the best text override
    const textContent = info.overrides.text
      || info.overrides.title
      || info.overrides.content
      || info.overrides.heading
      || label;

    resolvedTree = {
      type: 'e-flexbox',
      elType: 'e-flexbox',
      widgetType: 'e-flexbox',
      id: `comp-${cid}`,
      settings: {
        classes: {
          '$$type': 'classes',
          value: [styleId],
        },
        tag: 'div',
      },
      styles: {
        [styleId]: {
          id: styleId,
          type: 'class',
          label: 'local',
          variants: [{
            meta: { breakpoint: null, state: null },
            props: {
              display: { '$$type': 'string', value: 'flex' },
              'flex-direction': 'column',
              gap: { '$$type': 'size', value: { size: 8, unit: 'px' } },
            },
            custom_css: null,
          }],
        },
      },
      elements: [
        {
          type: 'e-heading',
          elType: 'widget',
          widgetType: 'e-heading',
          id: `comp-${cid}-label`,
          settings: {
            classes: {
              '$$type': 'classes',
              value: [`fecomp${cid}label`],
            },
            tag: 'h4',
            title: {
              '$$type': 'html-v3',
              value: {
                content: {
                  '$$type': 'string',
                  value: String(textContent),
                },
              },
            } as SettingValue,
          },
          styles: {
            [`fecomp${cid}label`]: {
              id: `fecomp${cid}label`,
              type: 'class',
              label: 'local',
              variants: [{
                meta: { breakpoint: null, state: null },
                props: {},
                custom_css: null,
              }],
            },
          },
        },
      ],
    };
  }

  // ── Store in cache (metadata lives in componentMap, NOT on the tree) ──
  // _meta is intentionally NOT stored on the cache entry because
  // resolveComponentNode() in convert-xml-to-v4.js deep-clones the
  // entire cache entry via JSON.parse(JSON.stringify()), which would
  // leak non-Elementor properties into the resolved V4 widget tree.
  componentCache[cid] = resolvedTree;

  const sourceLabel = info.source === 'unframer' ? '\u2705' :
                       info.source === 'unframer-failed' ? '\u274C' :
                       info.source === 'unframer-error' ? '\u26A0' : '\u2B07';
  const textPreview = info.overrides.text || info.overrides.title || '';
  log(`  ${sourceLabel} ${cid} (${info.occurrences}x) → ${info.source} — "${String(textPreview).slice(0, 50)}"`);
}

// ── Write cache ────────────────────────────────────────────────

const outputPath = (args.output as string) || 'component-cache.json';
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(componentCache, null, 2), 'utf8');

// ── Summary ────────────────────────────────────────────────────

console.log(`\nComponent Cache: ${outputPath}`);
console.log(`  Total components:      ${Object.keys(componentCache).length}`);
console.log(`  Unframer-resolved:     ${resolvedCount}`);
console.log(`  Downgraded (fallback): ${downgradedCount}`);
console.log(`  Failed resolution:     ${failedCount}`);
console.log(`  Total instances:       ${[...componentMap.values()].reduce((s, i) => s + i.occurrences, 0)}`);

if (resolvedCount > 0) {
  console.log(`\n  \u2705 Phase 12 aktiv — ${resolvedCount} component(s) aus Unframer MCP-XMLs aufgeloest.`);
} else if (componentsDir) {
  console.log('  \u2139  Keine Component-XMLs gefunden. Alle Components als Downgrade gecached.');
} else {
  console.log('  \u2139  --components-dir nicht angegeben. Alle Components als Downgrade gecached.');
  console.log('     (Phase 12: Mit --components-dir <dir> echte Unframer-XMLs einbinden.)');
}

console.log('\nComponent ID → Source | Label:');
for (const [cid, info] of componentMap) {
  const sourceIcon = info.source === 'unframer' ? '\u2705' :
                      info.source === 'downgrade' ? '\u2B07' : '\u274C';
  const text = info.overrides.text || info.overrides.title || info.overrides.content || '(no text overrides)';
  console.log(`  ${sourceIcon} ${cid.padEnd(12)} (${String(info.occurrences).padStart(2)}x) → ${String(text).slice(0, 60)}`);
}

// ── Helpers ────────────────────────────────────────────────────

function countNodes(node: V4Node | V4Node[]): number {
  if (!node || typeof node !== 'object') return 0;
  let count = 1;
  if (Array.isArray(node)) {
    return node.reduce((s, n) => s + countNodes(n), 0);
  }
  if (node.elements) {
    for (const child of node.elements) count += countNodes(child);
  }
  return count;
}
