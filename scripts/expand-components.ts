#!/usr/bin/env node
/**
 * expand-components.ts  —  Prio 2: Component-Expansion als Pre-Build-Step
 *
 * Usage:
 *   node --import tsx scripts/expand-components.ts \
 *     --xml FramerExport/section-name.xml \
 *     --components-dir FramerExport/components/ \
 *     --output FramerExport/section-name-expanded.xml
 */

import fs   from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface ComponentEntry {
  componentId: string;
  name: string;
}

interface ComponentCall {
  step: number;
  component_id: string;
  component_name: string;
  mcp_tool: string;
  mcp_params: { nodeId: string };
  save_as: string;
}

interface ComponentPlan {
  generated_by: string;
  source_xml: string;
  components_to_expand: number;
  components_dir_target: string;
  instructions: string[];
  calls: ComponentCall[];
}

interface ExpandResult {
  expanded: string;
  totalExpanded: number;
  totalSkipped: number;
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    xml:             { type: 'string' },
    'components-dir': { type: 'string' },
    output:          { type: 'string' },
    'plan-only':     { type: 'boolean', default: false },
    verbose:         { type: 'boolean', default: false },
  },
  strict: false,
});

const xmlPath: string | undefined = args.xml as string | undefined;
const componentsDir: string | undefined = args['components-dir'] as string | undefined;
const outputPath: string | undefined = args.output as string | undefined;

const log  = (...m: string[]) => { if (args.verbose) process.stderr.write('[expand-components] ' + m.join(' ') + '\n'); };
const warn = (m: string)    => process.stderr.write(`⚠ [expand-components] ${m}\n`);
const info = (m: string)    => process.stderr.write(`ℹ [expand-components] ${m}\n`);

if (!xmlPath) {
  process.stderr.write('Error: --xml erforderlich\n');
  process.stderr.write('Usage: node --import tsx scripts/expand-components.ts --xml <framer.xml> [--components-dir <dir>] [--output <path>]\n');
  process.exit(2);
}

if (!fs.existsSync(xmlPath)) {
  process.stderr.write(`Error: --xml nicht gefunden: ${xmlPath}\n`);
  process.exit(2);
}

const xmlContent = fs.readFileSync(xmlPath, 'utf8');

// ─── Scan for componentId references ─────────────────────────────────────────

function extractComponentIds(xml: string): ComponentEntry[] {
  const ids = new Set<string>();
  const nameMap: Record<string, string> = {};

  const re = /componentId="([^"]+)"/g;
  const nameRe = /componentId="([^"]+)"[^>]*name="([^"]+)"/g;
  const nameRe2 = /name="([^"]+)"[^>]*componentId="([^"]+)"/g;

  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(xml)) !== null)  { nameMap[m[1]] = m[2]; }
  while ((m = nameRe2.exec(xml)) !== null) { nameMap[m[2]] = m[1]; }

  while ((m = re.exec(xml)) !== null) ids.add(m[1]);

  return [...ids].map(id => ({ componentId: id, name: nameMap[id] || id }));
}

const components = extractComponentIds(xmlContent);
log(`Found ${components.length} unique component references`);

if (components.length === 0) {
  info('Keine componentId-Referenzen im XML gefunden. Kein Expand notwendig.');
  if (outputPath) {
    fs.writeFileSync(outputPath, xmlContent, 'utf8');
    info(`XML unverändert geschrieben → ${outputPath}`);
  } else {
    process.stdout.write(xmlContent);
  }
  process.exit(0);
}

// ─── Mode A: Plan-only (kein components-dir) ─────────────────────────────────

const hasCacheDir = componentsDir && fs.existsSync(componentsDir);

if (!hasCacheDir || args['plan-only']) {
  const plan: ComponentPlan = {
    generated_by: 'expand-components.ts',
    source_xml: xmlPath,
    components_to_expand: components.length,
    components_dir_target: componentsDir || 'FramerExport/components/',
    instructions: [
      'Für jede component_id unten: Unframer MCP getNodeXml({ nodeId: component_id }) aufrufen',
      `XML-Output speichern als: <components_dir_target>/<component_id>.xml`,
      `Dann erneut aufrufen: node --import tsx scripts/expand-components.ts --xml <source_xml> --components-dir <components_dir_target> --output <source_xml_expanded.xml>`,
    ],
    calls: components.map((c, i) => ({
      step: i + 1,
      component_id: c.componentId,
      component_name: c.name,
      mcp_tool: 'Unframer:getNodeXml',
      mcp_params: { nodeId: c.componentId },
      save_as: path.join(componentsDir || 'FramerExport/components/', `${c.componentId}.xml`),
    })),
  };

  const planJson = JSON.stringify(plan, null, 2);

  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, planJson, 'utf8');
    process.stderr.write(`✓ Component-Expand-Plan → ${outputPath} (${components.length} components)\n`);
    process.stdout.write('Component Expansion Plan:\n');
    for (const c of components) {
      process.stdout.write(`  getNodeXml({ nodeId: "${c.componentId}" })  →  ${c.name}\n`);
    }
  } else {
    process.stdout.write(planJson + '\n');
  }
  process.exit(0);
}

// ─── Mode B: Inline XML expansion ────────────────────────────────────────────

function expandComponentsInXml(xml: string, componentFiles: Record<string, string>): ExpandResult {
  let expanded = xml;
  let totalExpanded = 0;
  let totalSkipped = 0;

  for (const { componentId, name } of components) {
    const compXmlPath = componentFiles[componentId];
    if (!compXmlPath) {
      log(`  ⏭ ${componentId} (${name}): keine XML-Datei → bleibt als componentId-Referenz`);
      totalSkipped++;
      continue;
    }

    let componentXml: string;
    try {
      componentXml = fs.readFileSync(compXmlPath, 'utf8').trim();
    } catch (err) {
      warn(`Kann ${compXmlPath} nicht lesen: ${(err as Error).message}`);
      totalSkipped++;
      continue;
    }

    const instanceRe = new RegExp(`<[^>]+componentId="${componentId}"[^>]*/?>`, 'gs');
    const instances = [...xml.matchAll(instanceRe)];
    if (instances.length === 0) continue;

    log(`  ✓ ${componentId} (${name}): ${instances.length} instance(s) → inline XML (${componentXml.length} chars)`);

    expanded = expanded.replace(
      new RegExp(`(<[^>]+)componentId="${componentId}"([^>]*/?>)`, 'gs'),
      (_match, before, after) => {
        const instanceAttrs = before + after;

        const rootTagMatch = componentXml.match(/^<(\w[\w.-]*)\s*/);
        if (!rootTagMatch) return _match;

        const cleanedInstanceAttrs = instanceAttrs
          .replace(/componentId="[^"]*"\s*/g, '')
          .replace(/^<\s*\w[\w.-]*\s*/, '')
          .replace(/\/?>$/, '')
          .trim();

        const injectedXml = componentXml.replace(
          /^(<\w[\w.-]*)(\s|>)/,
          `$1 data-framer-instance="true" ${cleanedInstanceAttrs}$2`,
        );

        return `<!-- component:${componentId} name:${name} -->\n${injectedXml}`;
      },
    );

    totalExpanded++;
  }

  return { expanded, totalExpanded, totalSkipped };
}

// ─── Load component XML files ─────────────────────────────────────────────────

const componentFiles: Record<string, string> = {};
let foundCount = 0;

for (const { componentId } of components) {
  const compXmlPath = path.join(componentsDir!, `${componentId}.xml`);
  if (fs.existsSync(compXmlPath)) {
    componentFiles[componentId] = compXmlPath;
    foundCount++;
    log(`  Found: ${componentId}.xml`);
  } else {
    log(`  Missing: ${componentId}.xml (will keep as componentId reference)`);
  }
}

info(`Component XMLs: ${foundCount}/${components.length} gefunden in ${componentsDir}`);

if (foundCount === 0) {
  warn('Keine Component-XMLs gefunden. Erstelle zuerst den Plan und rufe getNodeXml() auf:');
  warn(`  node --import tsx scripts/expand-components.ts --xml ${xmlPath} --plan-only --output component-plan.json`);
  if (outputPath) {
    fs.writeFileSync(outputPath, xmlContent, 'utf8');
  } else {
    process.stdout.write(xmlContent);
  }
  process.exit(1);
}

// ─── Execute expansion ────────────────────────────────────────────────────────

const { expanded, totalExpanded, totalSkipped } = expandComponentsInXml(xmlContent, componentFiles);

// ─── Write output ─────────────────────────────────────────────────────────────

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, expanded, 'utf8');
  process.stderr.write(`✓ Expanded XML → ${outputPath}\n`);
  process.stderr.write(`  Components expanded: ${totalExpanded}/${components.length}\n`);
  if (totalSkipped > 0) {
    process.stderr.write(`  Skipped (no XML): ${totalSkipped} — these remain as e-component downgrade nodes\n`);
  }
} else {
  process.stdout.write(expanded);
}

process.exit(totalSkipped > 0 ? 1 : 0);
