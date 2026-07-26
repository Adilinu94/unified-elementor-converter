#!/usr/bin/env node
/**
 * html-to-widget-plan.ts
 *
 * Brücke zu novamira/adrians-html-to-elementor-widget-plan.
 * Analysiert Framer-Export HTML und erstellt einen strukturierten
 * Elementor V4 Widget-Konvertierungsplan.
 *
 * Usage:
 *   node --import tsx scripts/html-to-widget-plan.ts \
 *     --html ./FramerExport/index.html \
 *     --output ./FramerExport/tokens/widget-plan.json \
 *     --execute
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface WidgetPlanStats {
  total_elements?: number;
  native_candidates?: number;
  container_candidates?: number;
  html_required?: number;
  css_blocks?: number;
  script_blocks?: number;
  images?: number;
  links?: number;
  forms?: number;
}

interface InventoryBlock {
  selector_hint: string;
  length: number;
  features: string[];
}

interface CssInventory {
  blocks?: InventoryBlock[];
  count?: number;
}

interface JsInventory {
  blocks?: InventoryBlock[];
  count?: number;
}

interface UnconvertedItem {
  tag: string;
  selector_hint: string;
  reason: string;
}

interface WidgetPlanSummary {
  recommended_build_strategy?: string;
  [key: string]: unknown;
}

interface WidgetPlan {
  success?: boolean;
  native_widget_ratio?: number;
  target_surface?: string;
  stats?: WidgetPlanStats;
  summary?: WidgetPlanSummary;
  recommendations?: string[];
  css_inventory?: CssInventory;
  js_inventory?: JsInventory;
  unconverted?: UnconvertedItem[];
  error?: string;
  tree?: unknown;
}

interface PlanMeta {
  generated_by: string;
  html_source: string;
  html_size_bytes: number;
  generated_at: string;
}

interface EnrichedPlan extends WidgetPlan {
  _meta: PlanMeta;
}

interface McpBridgeClass {
  fromConfig(): Promise<McpBridgeInstance>;
}

interface McpBridgeInstance {
  mcpUrl: string;
  call(ability: string, params: Record<string, unknown>): Promise<WidgetPlan>;
}

interface PlanFallback {
  type: string;
  target_surface: string;
  max_nodes: number;
  html_size_bytes: number;
  agent_instruction: string[];
  mcp_call: {
    ability: string;
    params: Record<string, unknown>;
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    html:             { type: 'string' },
    'html-string':    { type: 'string' },
    'target-surface': { type: 'string', default: 'v4' },
    output:           { type: 'string' },
    'max-nodes':      { type: 'string', default: '250' },
    execute:          { type: 'boolean', default: false },
    verbose:          { type: 'boolean', default: false },
    help:             { type: 'boolean', default: false },
  },
  strict: false,
});

const htmlPath: string | undefined = args.html as string | undefined;
const htmlString: string | undefined = args['html-string'] as string | undefined;
const targetSurfaceArg: string = (args['target-surface'] as string) || 'v4';
const outputPath: string | undefined = args.output as string | undefined;

if (args.help) {
  console.log(`
html-to-widget-plan.ts

ZWECK:
  Analysiert Framer-Export HTML (index.html) und erstellt einen
  strukturierten Elementor V4 Widget-Konvertierungsplan via
  novamira/adrians-html-to-elementor-widget-plan.

OPTIONEN:
  --html FILE            HTML-Datei (z.B. FramerExport/index.html)
  --html-string STRING   HTML direkt als String (statt --html FILE)
  --target-surface v4|v3 Ziel-Elementor-Oberfläche  [default: v4]
  --output FILE          Output-Pfad für Widget-Plan JSON
  --max-nodes N          Maximale DOM-Nodes  [default: 250]
  --execute              Direkter McpBridge-Call (statt Plan-Generator)
  --verbose              Ausführliche Logs
  --help                 Diese Hilfe

WORKFLOW:
  1. node html-to-widget-plan.ts --html index.html --output widget-plan.json --execute
     → Ruft novamira/adrians-html-to-elementor-widget-plan via McpBridge auf

EXIT-CODES:
  0  Analyse erfolgreich
  1  Warnungen (HTML nicht lesbar, McpBridge-Fallback verwendet)
  2  HTML nicht gefunden oder leer
`);
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────────────

const log = (...a: string[]) => args.verbose && process.stderr.write('[html-plan] ' + a.join(' ') + '\n');
const warn = (...a: string[]) => process.stderr.write('[WARN] ' + a.join(' ') + '\n');
const fatal = (msg: string, code = 2): never => {
  process.stderr.write('[FATAL] ' + msg + '\n');
  process.exit(code);
};

const TARGET_SURFACE = ['v4', 'v3'].includes(targetSurfaceArg) ? targetSurfaceArg : 'v4';

const rawNodes = parseInt(args['max-nodes'] as string ?? '250', 10);
const MAX_NODES = isNaN(rawNodes) ? 250 : Math.max(1, Math.min(1000, rawNodes));

// ── HTML laden ─────────────────────────────────────────────────────────────

let htmlContent = '';

if (htmlString) {
  htmlContent = htmlString;
} else if (htmlPath) {
  const resolvedPath = resolve(htmlPath);
  if (!existsSync(resolvedPath)) {
    fatal(`HTML-Datei nicht gefunden: ${resolvedPath}`);
  }
  try {
    htmlContent = readFileSync(resolvedPath, 'utf8');
  } catch (e) {
    fatal(`HTML nicht lesbar: ${resolvedPath} — ${(e as Error).message}`);
  }
  log(`HTML geladen: ${resolvedPath} (${(htmlContent.length / 1024).toFixed(1)} KB)`);
} else {
  fatal('--html FILE oder --html-string STRING ist erforderlich');
}

if (!htmlContent || htmlContent.trim().length === 0) {
  fatal('HTML ist leer');
}

// ── McpBridge-Call ─────────────────────────────────────────────────────────

async function callWidgetPlan(
  mcp: McpBridgeInstance,
  html: string,
  targetSurface: string,
  maxNodes: number,
): Promise<WidgetPlan> {
  process.stderr.write(`[html-plan] Rufe adrians-html-to-elementor-widget-plan auf (${targetSurface}, max ${maxNodes} Nodes)...\n`);
  return mcp.call('novamira/adrians-html-to-elementor-widget-plan', {
    html,
    target_surface: targetSurface,
    include_tree: true,
    max_nodes: maxNodes,
  });
}

// ── Plan-Fallback (wenn McpBridge nicht verfügbar) ────────────────────────

function writePlanFallback(): void {
  const plan: PlanFallback = {
    type: 'html-to-widget-plan',
    target_surface: TARGET_SURFACE,
    max_nodes: MAX_NODES,
    html_size_bytes: htmlContent.length,
    agent_instruction: [
      'Führe den folgenden MCP-Call aus:',
      '',
      '  novamira/adrians-html-to-elementor-widget-plan',
      `  {`,
      `    "html": "<HTML-Inhalt (${(htmlContent.length / 1024).toFixed(1)} KB)>",`,
      `    "target_surface": "${TARGET_SURFACE}",`,
      `    "include_tree": true,`,
      `    "max_nodes": ${MAX_NODES}`,
      `  }`,
      '',
      'Speichere das Ergebnis als widget-plan.json.',
      '',
      'ERGEBNIS-INTERPRETATION:',
      `  - native_widget_ratio ≥ 85% → Direkter V4 Atomic Build möglich`,
      `  - native_widget_ratio < 70% → Erst HTML-Referenz, dann inkrementell`,
      '  - stats.tag_counts → Häufigste HTML-Tags (Container-Kandidaten)',
      '  - css_inventory → CSS-Blöcke die in Global Classes ausgelagert werden sollten',
      '  - js_inventory → JS-Blöcke für page_css/page_js',
      '  - unconverted → Nicht konvertierbare Elemente (style, script, form, canvas)',
      '  - recommendations → Konkrete Handlungsempfehlungen',
      '  - tree → Vereinfachter Konvertierungsbaum (elementor_target pro Node)',
    ],
    mcp_call: {
      ability: 'novamira/adrians-html-to-elementor-widget-plan',
      params: {
        html: '<HTML_INHALT_HIER>',
        target_surface: TARGET_SURFACE,
        include_tree: true,
        max_nodes: MAX_NODES,
      },
    },
  };

  const outPath = outputPath || 'widget-plan.json';
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), JSON.stringify(plan, null, 2), 'utf8');

  process.stderr.write(
    `[html-plan] Widget-Plan-Fallback → ${outPath}\n` +
    '[html-plan] Agent: MCP-Call aus mcp_call ausführen, Ergebnis als widget-plan.json speichern.\n',
  );
}

// ── Report aus Widget-Plan generieren ──────────────────────────────────────

function printReport(plan: WidgetPlan): void {
  if (!plan || !plan.success) {
    warn(`Widget-Plan fehlgeschlagen: ${plan?.error || 'Unbekannter Fehler'}`);
    return;
  }

  const ratio = plan.native_widget_ratio ?? 0;
  const ratioPct = (ratio * 100).toFixed(1);
  const stats = plan.stats || {};
  const summary = plan.summary || {};

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  HTML → ELEMENTOR V4 WIDGET-PLAN');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Ziel-Oberfläche:    ${plan.target_surface?.toUpperCase()}`);
  console.log(`  Native Coverage:    ${ratioPct}%`);
  console.log(`  Build-Strategie:    ${summary.recommended_build_strategy || 'N/A'}`);
  console.log(`${'─'.repeat(60)}`);
  console.log('  STATISTIK:');
  console.log(`    Total Elements:        ${stats.total_elements ?? '?'}`);
  console.log(`    Native Candidates:     ${stats.native_candidates ?? '?'}`);
  console.log(`    Container Candidates:  ${stats.container_candidates ?? '?'}`);
  console.log(`    HTML Required:         ${stats.html_required ?? '?'}`);
  console.log(`    CSS Blocks:            ${stats.css_blocks ?? '?'}`);
  console.log(`    Script Blocks:         ${stats.script_blocks ?? '?'}`);
  console.log(`    Images:                ${stats.images ?? '?'}`);
  console.log(`    Links:                 ${stats.links ?? '?'}`);
  console.log(`    Forms:                 ${stats.forms ?? '?'}`);
  console.log(`${'─'.repeat(60)}`);

  if (plan.recommendations && plan.recommendations.length > 0) {
    console.log('  EMPFEHLUNGEN:');
    for (const rec of plan.recommendations) {
      console.log(`    → ${rec}`);
    }
    console.log(`${'─'.repeat(60)}`);
  }

  if (plan.css_inventory?.blocks && Object.keys(plan.css_inventory.blocks).length > 0) {
    console.log(`  CSS-INVENTAR: ${plan.css_inventory.count} Blöcke`);
    for (const block of (plan.css_inventory.blocks || []).slice(0, 5)) {
      console.log(`    ${block.selector_hint}: ${block.length}B, Features: [${(block.features || []).join(', ')}]`);
    }
    console.log(`${'─'.repeat(60)}`);
  }

  if (plan.js_inventory?.blocks && Object.keys(plan.js_inventory.blocks).length > 0) {
    console.log(`  JS-INVENTAR: ${plan.js_inventory.count} Blöcke`);
    for (const block of (plan.js_inventory.blocks || []).slice(0, 5)) {
      console.log(`    ${block.selector_hint}: ${block.length}B, Features: [${(block.features || []).join(', ')}]`);
    }
    console.log(`${'─'.repeat(60)}`);
  }

  if (plan.unconverted && plan.unconverted.length > 0) {
    console.log(`  NICHT KONVERTIERBAR: ${plan.unconverted.length} Elemente`);
    for (const item of plan.unconverted.slice(0, 10)) {
      console.log(`    <${item.tag}> ${item.selector_hint} — ${item.reason}`);
    }
    console.log(`${'─'.repeat(60)}`);
  }

  // Bewertung
  console.log(`\n  BEWERTUNG: ${ratio >= 0.85 ? '✅ DIREKTER BUILD MÖGLICH' : ratio >= 0.7 ? '⚠️  MIT HTML-FALLBACKS' : '❌ ERST HTML-REFERENZ'}`);
  console.log(`${'═'.repeat(60)}\n`);
}

// ── MAIN ───────────────────────────────────────────────────────────────────

// --execute: Direkter McpBridge-Call
if (args.execute) {
  let McpBridge: McpBridgeClass | undefined;
  try {
    const mod = await import('./lib/mcp-bridge.js') as { McpBridge: McpBridgeClass };
    McpBridge = mod.McpBridge;
  } catch {
    writePlanFallback();
    process.exit(0);
  }

  let mcp: McpBridgeInstance;
  try {
    mcp = await McpBridge.fromConfig();
    process.stderr.write(`[html-plan] MCP-Bridge verbunden: ${mcp.mcpUrl}\n`);
  } catch {
    writePlanFallback();
    process.exit(0);
  }

  try {
    const plan = await callWidgetPlan(mcp, htmlContent, TARGET_SURFACE, MAX_NODES);

    if (!plan || !plan.success) {
      const errMsg = plan?.error || 'Unbekannter Fehler vom MCP-Server';
      process.stderr.write(`[html-plan] ❌ Widget-Plan fehlgeschlagen: ${errMsg}\n`);
      writePlanFallback();
      process.exit(1);
    }

    // Report ausgeben
    if (args.verbose) {
      printReport(plan);
    }

    // Output schreiben
    const enrichedPlan: EnrichedPlan = {
      ...plan,
      _meta: {
        generated_by: 'html-to-widget-plan.ts',
        html_source: htmlPath || '<html-string>',
        html_size_bytes: htmlContent.length,
        generated_at: new Date().toISOString(),
      },
    };

    const outPath = outputPath || 'widget-plan.json';
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(resolve(outPath), JSON.stringify(enrichedPlan, null, 2), 'utf8');

    const ratioPct = ((plan.native_widget_ratio ?? 0) * 100).toFixed(1);
    process.stderr.write(
      `[html-plan] ✅ Widget-Plan: ${ratioPct}% native Coverage → ${outPath}\n`,
    );

    process.exit(0);

  } catch {
    writePlanFallback();
    process.exit(1);
  }
}

// Standard-Modus: Plan-Generator (kein --execute)
process.stderr.write(`[html-plan] Plan-Modus: ${(htmlContent.length / 1024).toFixed(1)} KB HTML, ${TARGET_SURFACE}, max ${MAX_NODES} Nodes\n`);
writePlanFallback();
process.exit(0);
