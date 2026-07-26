#!/usr/bin/env node
/**
 * export-mcp-xml.ts
 * Erstellt einen Plan (export-plan.json) für alle getNodeXml-MCP-Calls.
 * Da das Script keinen direkten MCP-Zugriff hat, ist es ein Plan-Generator.
 *
 * Workflow:
 *   1. Agent ruft getProjectXml() auf → speichert Response als project-structure.json
 *   2. node --import tsx export-mcp-xml.ts --project-xml project-structure.json --outdir xml/
 *      → Erzeugt export-plan.json mit allen getNodeXml-Calls
 *   3. Agent iteriert durch export-plan.json.calls[], ruft getNodeXml pro nodeId auf,
 *      speichert XML in outputFile
 *   4. Optionaler Status-Update: node --import tsx export-mcp-xml.ts --update-from export-plan.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';

// ── Types ────────────────────────────────────────────────────────────────────

interface McpCallEntry {
  nodeId: string;
  label: string;
  type: 'page' | 'component';
  mcpTool: string;
  mcpParams: { nodeId: string };
  outputFile: string;
  status: 'pending' | 'done' | 'failed';
  error?: string;
}

interface PlanMeta {
  totalNodes: number;
  pages: number;
  components: number;
  exportedAt: string;
  outdir: string;
}

interface ExportPlan {
  meta: PlanMeta;
  calls: McpCallEntry[];
  agentInstructions: string[];
}

interface PageEntry {
  id: string;
  name?: string;
}

interface ComponentEntry {
  id: string;
  name?: string;
}

interface ProjectStructure {
  pages?: PageEntry[];
  components?: ComponentEntry[];
}

interface DependencyItem {
  component?: string;
  id?: string;
  nodeId?: string;
}

interface DependencyGraph {
  buildOrder?: (string | DependencyItem)[];
}

// ── CLI ────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'project-xml':       { type: 'string' },
    'node-id':           { type: 'string' },
    'node-label':        { type: 'string' },
    outdir:              { type: 'string', default: 'xml' },
    output:              { type: 'string' },
    'update-from':       { type: 'string' },
    'dependency-graph':  { type: 'string' },
    verbose:             { type: 'boolean', default: false },
    help:                { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
export-mcp-xml.ts

MODI:
  --project-xml FILE   Aus getProjectXml()-Response -> kompletter Plan
  --node-id ID         Einzelne Node -> Plan mit einem Eintrag
  --update-from FILE   Status eines bestehenden Plans aktualisieren (nach Agent-Iteration)

OPTIONEN:
  --outdir DIR         Ausgabe-Verzeichnis für XML-Files  [default: xml]
  --output FILE        Pfad für export-plan.json  [default: <outdir>/export-plan.json]
  --node-label TEXT    Anzeige-Label für --node-id Modus
  --dependency-graph FILE  Build-Reihenfolge aus build-dependency-graph.js
  --verbose            Ausführliche Logs nach stderr
  --help               Diese Hilfe

WORKFLOW:
  1. Agent: getProjectXml() aufrufen, Response als project-structure.json speichern
  2. node --import tsx export-mcp-xml.ts --project-xml project-structure.json --outdir FramerExport/xml/
  3. Agent: export-plan.json.calls[] iterieren, pro Eintrag:
       unframer/getNodeXml({ nodeId: call.mcpParams.nodeId }) aufrufen
       XML-String in call.outputFile speichern
       call.status = "done"
  4. node --import tsx export-mcp-xml.ts --update-from export-plan.json  (optional: Statistik)

RESULTS ZURÜCKSCHREIBEN:
  Agent speichert pro MCP-Call: { nodeId, xmlContent, error? } als Array in mcp-xml-results.json
  Dann: node --import tsx export-mcp-xml.ts --update-from mcp-xml-results.json

EXIT-CODES:
  0   Plan erstellt
  2   Input nicht gefunden oder fehlerhaft
`);
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────────────

const log = (...a: string[]) => args.verbose && process.stderr.write('[export-mcp-xml] ' + a.join(' ') + '\n');
const fatal = (msg: string, code = 2): never => { process.stderr.write('[FATAL] ' + msg + '\n'); process.exit(code); };

function slugifyLabel(name: string, type: 'page' | 'comp'): string {
  const prefix = type === 'page' ? 'page' : 'comp';
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `${prefix}-${slug}.xml`;
}

// Dedupliziert Dateinamen (falls zwei Nodes den gleichen Namen haben)
function deduplicateFilenames(calls: McpCallEntry[]): void {
  const seen = new Map<string, number>();
  for (const call of calls) {
    const base = call.outputFile;
    if (seen.has(base)) {
      const count = seen.get(base)! + 1;
      seen.set(base, count);
      call.outputFile = base.replace('.xml', `-${count}.xml`);
    } else {
      seen.set(base, 1);
    }
  }
}

// ── Modus: --update-from ───────────────────────────────────────────────────

if (args['update-from']) {
  const planPath = resolve(args['update-from']);
  if (!existsSync(planPath)) fatal(`Plan-Datei nicht gefunden: ${planPath}`);

  let plan!: ExportPlan;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8')) as ExportPlan;
  } catch (e) {
    fatal(`JSON-Parse-Fehler: ${(e as Error).message}`);
  }

  const calls = plan.calls ?? [];
  const done = calls.filter(c => c.status === 'done').length;
  const pending = calls.filter(c => c.status === 'pending').length;
  const failed = calls.filter(c => c.status === 'failed').length;

  console.log(`\n=== Export-Plan Status ===`);
  console.log(`Gesamt:  ${calls.length}`);
  console.log(`Done:    ${done}`);
  console.log(`Pending: ${pending}`);
  console.log(`Failed:  ${failed}`);

  if (failed > 0) {
    console.log('\nFehlgeschlagen:');
    for (const c of calls.filter(c => c.status === 'failed')) {
      console.log(`  ${c.label}: ${c.error ?? 'kein Fehler-Detail'}`);
    }
  }

  if (pending > 0) {
    console.log('\nNoch ausstehend:');
    for (const c of calls.filter(c => c.status === 'pending')) {
      console.log(`  ${c.label} (${c.nodeId})`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

// ── Modus: --node-id (Einzelne Node) ──────────────────────────────────────

let calls: McpCallEntry[] = [];

if (args['node-id']) {
  const nodeId = args['node-id'];
  const label = (args['node-label'] ?? nodeId) as string;
  const filename = slugifyLabel(label, 'comp');

  calls.push({
    nodeId,
    label: `${label} (single)`,
    type: 'component',
    mcpTool: 'unframer/getNodeXml',
    mcpParams: { nodeId },
    outputFile: join(args.outdir as string, filename),
    status: 'pending',
  });

  log(`Single-Node-Modus: ${nodeId} → ${filename}`);
}

// ── Modus: --project-xml ──────────────────────────────────────────────────

else if (args['project-xml']) {
  const projectXmlPath = resolve(args['project-xml']);
  if (!existsSync(projectXmlPath)) fatal(`project-structure.json nicht gefunden: ${projectXmlPath}`);

  let projectStructure!: ProjectStructure;
  try {
    projectStructure = JSON.parse(readFileSync(projectXmlPath, 'utf8')) as ProjectStructure;
  } catch (e) {
    fatal(`JSON-Parse-Fehler in project-structure.json: ${(e as Error).message}`);
  }

  const pages = projectStructure.pages ?? [];
  const components = projectStructure.components ?? [];

  log(`${pages.length} Pages, ${components.length} Components gefunden`);

  // Pages zuerst
  for (const page of pages) {
    const filename = slugifyLabel(page.name ?? page.id, 'page');
    calls.push({
      nodeId: page.id,
      label: `${page.name ?? page.id} (page)`,
      type: 'page',
      mcpTool: 'unframer/getNodeXml',
      mcpParams: { nodeId: page.id },
      outputFile: join(args.outdir as string, filename),
      status: 'pending',
    });
  }

  // Components danach (Leaf-Nodes zuerst wenn dependency-graph vorhanden)
  const sortedComponents = [...components];

  if (args['dependency-graph']) {
    const depGraphPath = resolve(args['dependency-graph']);
    if (existsSync(depGraphPath)) {
      try {
        const depGraph: DependencyGraph = JSON.parse(readFileSync(depGraphPath, 'utf8')) as DependencyGraph;
        const buildOrder = depGraph.buildOrder ?? [];
        const orderMap = new Map<string, number>(
          buildOrder.map((item, idx) => {
            const id = typeof item === 'string' ? item : (item.component ?? item.id ?? item.nodeId);
            return [id, idx] as [string, number];
          }).filter(([id]) => !!id)
        );

        sortedComponents.sort((a, b) => {
          const ai = orderMap.get(a.id) ?? 9999;
          const bi = orderMap.get(b.id) ?? 9999;
          return ai - bi;
        });
        log(`Dependency-Graph geladen, ${buildOrder.length} Nodes in Build-Reihenfolge`);
      } catch (e) {
        process.stderr.write(`[WARN] dependency-graph konnte nicht geladen werden: ${(e as Error).message}\n`);
      }
    } else {
      process.stderr.write(`[WARN] dependency-graph nicht gefunden: ${depGraphPath}\n`);
    }
  }

  for (const comp of sortedComponents) {
    const filename = slugifyLabel(comp.name ?? comp.id, 'comp');
    calls.push({
      nodeId: comp.id,
      label: `${comp.name ?? comp.id} (component)`,
      type: 'component',
      mcpTool: 'unframer/getNodeXml',
      mcpParams: { nodeId: comp.id },
      outputFile: join(args.outdir as string, filename),
      status: 'pending',
    });
  }
}

else {
  fatal('Einer der folgenden Flags ist required: --project-xml, --node-id\nFür Hilfe: --help');
}

// Dateinamen deduplizieren
deduplicateFilenames(calls);

// ── Ausgabe-Verzeichnis sicherstellen ──────────────────────────────────────

const outdirPath = resolve(args.outdir as string);
if (!existsSync(outdirPath)) {
  mkdirSync(outdirPath, { recursive: true });
  log(`Verzeichnis erstellt: ${outdirPath}`);
}

// ── export-plan.json schreiben ─────────────────────────────────────────────

const plan: ExportPlan = {
  meta: {
    totalNodes: calls.length,
    pages: calls.filter(c => c.type === 'page').length,
    components: calls.filter(c => c.type === 'component').length,
    exportedAt: new Date().toISOString(),
    outdir: outdirPath,
  },
  calls,
  agentInstructions: [
    'Iteriere durch calls[] und führe für jeden Eintrag aus:',
    '  1. unframer/getNodeXml({ nodeId: call.mcpParams.nodeId }) aufrufen',
    '  2. XML-String in call.outputFile speichern (Datei anlegen)',
    '  3. call.status = "done" setzen (oder "failed" bei Fehler)',
    'Nach Abschluss: node --import tsx export-mcp-xml.ts --update-from <diese Datei> für Statistik',
  ],
};

const defaultOut = join(outdirPath, 'export-plan.json');
const outPath = args.output ? resolve(args.output as string) : defaultOut;

writeFileSync(outPath, JSON.stringify(plan, null, 2), 'utf8');
process.stderr.write(`[export-mcp-xml] ${calls.length} Nodes in Plan geschrieben: ${outPath}\n`);

// Lesbare Zusammenfassung nach stdout
console.log(`\nExport-Plan erstellt:`);
console.log(`  Nodes: ${calls.length} (${plan.meta.pages} Pages, ${plan.meta.components} Components)`);
console.log(`  Plan:  ${outPath}`);
if (calls.length > 0) {
  console.log(`\nNächste Schritte:`);
  for (const step of plan.agentInstructions) console.log(`  ${step}`);
}

// Auch als JSON für Agent-Konsum
console.log('\n' + JSON.stringify(plan, null, 2));

process.exit(0);
