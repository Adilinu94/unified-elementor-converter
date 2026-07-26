#!/usr/bin/env node
/**
 * session-init.ts  —  Prio 2: Session-Start als ausführbares Script
 *
 * Usage:
 *   node --import tsx scripts/session-init.ts
 *   node --import tsx scripts/session-init.ts --json
 *   node --import tsx scripts/session-init.ts --update-session-state
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface SessionExperiments {
  e_atomic_elements: string;
  e_opt_in_v4: string;
  e_variables: string;
  e_classes: string;
}

interface SessionResult {
  ok: boolean;
  mcp_reachable: boolean;
  helpers_class_available: boolean;
  batch_create_variables_ok: boolean;
  elementor_version: string | null;
  elementor_pro_active: boolean;
  atomic_available: boolean;
  experiments: SessionExperiments;
  existing_variables: string[];
  issues: string[];
  warnings: string[];
  timestamp: string;
}

interface McpCallEntry {
  step: number;
  label: string;
  ability: string;
  params: Record<string, unknown>;
  expect: string;
  on_fail: string;
  result_key?: string;
  result_truthy_if?: string;
  result_keys?: Record<string, string>;
  note?: string;
  fallback?: string;
}

interface SessionInitOutput {
  mode: string;
  instructions: string;
  calls: McpCallEntry[];
  result_template: SessionResult;
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    json:       { type: 'boolean', default: false },
    verbose:    { type: 'boolean', default: false },
    'read-vars': { type: 'boolean', default: false },
    'update-session-state': { type: 'boolean', default: false },
    'repo-url':  { type: 'string', default: 'https://github.com/Adilinu94/Framer-to-Elementor-V4-Pipeline' },
  },
  strict: false,
});

// ─── Fix #3: SESSION-STATE.md Auto-Update ────────────────────────────────────

function updateSessionState(): void {
  const pkgPath = resolve(__dirname, '..', 'package.json');
  const statePath = resolve(__dirname, '..', 'SESSION-STATE.md');

  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    version = pkg.version || version;
  } catch { /* package.json nicht lesbar */ }

  const repoUrl = (args['repo-url'] as string) || 'https://github.com/Adilinu94/Framer-to-Elementor-V4-Pipeline';
  const today = new Date().toISOString().split('T')[0];

  let openTasks = '';
  if (existsSync(statePath)) {
    const existing = readFileSync(statePath, 'utf8');
    const taskMatch = existing.match(/## Offene Tasks[\s\S]*?(?=\n## |\n---|\s*$)/);
    openTasks = taskMatch ? taskMatch[0] : '';
  }

  const content = `# SESSION-STATE.md — framer-v4-pipeline-v2

> **Letzte Aktualisierung:** ${today}  
> **Pipeline-Version:** v${version}  
> **Repo:** ${repoUrl}  
> **Primäre MCP-Verbindung:** \`novamira-yoursite-local\` → \`http://yoursite.local/wp-json/mcp/novamira\`

---

## Aktueller Status

| Bereich | Status |
|---------|--------|
| CI-Workflow | ✅ Aktiv |
| Pipeline-Version | v${version} |
| Zuletzt aktualisiert | ${today} |

---

${openTasks || `## Offene Tasks

Siehe \`tasks/todo.md\` für die vollständige Aufgabenliste.`}

---

## Wichtige IDs & Sessions

> **Hinweis:** Session-abhängige IDs (e-gv-*, gc-*) werden NICHT hier gespeichert.  

---

## Environment

- **Lokale WP-Sites:** \`yoursite.local\` (LocalWP), \`treetsshop.local\`
- **Node-Version:** 18 / 20 / 22 (CI-Matrix)
- **Primärer Branch:** \`main\`
`;

  writeFileSync(statePath, content, 'utf8');
  process.stderr.write(`✓ SESSION-STATE.md aktualisiert: v${version} | ${today} | ${repoUrl}\n`);
}

if (args['update-session-state']) {
  updateSessionState();
  process.exit(0);
}

const log = (...m: string[]) => { if (args.verbose && !args.json) process.stderr.write('[session-init] ' + m.join(' ') + '\n'); };

// ─── Result object ────────────────────────────────────────────────────────────

const result: SessionResult = {
  ok: false,
  mcp_reachable: false,
  helpers_class_available: false,
  batch_create_variables_ok: false,
  elementor_version: null,
  elementor_pro_active: false,
  atomic_available: false,
  experiments: {
    e_atomic_elements: 'unknown',
    e_opt_in_v4:       'unknown',
    e_variables:       'unknown',
    e_classes:         'unknown',
  },
  existing_variables: [],
  issues: [],
  warnings: [],
  timestamp: new Date().toISOString(),
};

// ─── Build checklist ──────────────────────────────────────────────────────────

function buildReport(): McpCallEntry[] {
  const calls: McpCallEntry[] = [
    {
      step: 1,
      label: 'MCP Verbindung (discover-abilities)',
      ability: 'novamira-test4-nick-webde:mcp-adapter-discover-abilities',
      params: {},
      expect: 'Liste von ≥10 Abilities',
      on_fail: 'KRITISCH: MCP nicht erreichbar. Plugin aktiv? WordPress läuft?',
      result_key: 'mcp_reachable',
      result_truthy_if: 'response.abilities.length > 10',
    },
    {
      step: 2,
      label: 'Elementor Check Setup (Version + Atomic)',
      ability: 'novamira-test4-nick-webde:mcp-adapter-execute-ability',
      params: { ability_name: 'novamira/elementor-check-setup', parameters: '{}' },
      expect: 'elementor.active: true, atomic.runtime_available: true',
      on_fail: 'KRITISCH: Elementor inaktiv oder Atomic nicht verfügbar.',
      result_keys: {
        'elementor_version':  'response.data.elementor.version',
        'atomic_available':   'response.data.atomic.runtime_available',
        'elementor_pro_active': 'response.data.elementor_pro.active',
      },
      note: 'Experiments (e_atomic_elements etc.) werden von check-setup NICHT geliefert — separat in WP Admin prüfen oder Plugin-Erweiterung implementieren.',
    },
    {
      step: 3,
      label: 'Helpers-Class Guard (batch-create-variables Smoke-Test)',
      ability: 'novamira-test4-nick-webde:mcp-adapter-execute-ability',
      params: {
        ability_name: 'novamira-adrianv2/batch-create-variables',
        parameters: JSON.stringify({
          strategy: 'skip',
          variables: [{ label: '_session_probe', type: 'color', value: '#000000' }],
        }),
      },
      expect: 'success: true ODER "Class not found" → Fallback aktivieren',
      on_fail: 'WARNUNG: batch-create-variables nicht verfügbar → sequenziellen Fallback nutzen.',
      result_key: 'helpers_class_available',
      result_truthy_if: 'response.success === true',
      fallback: 'novamira/elementor-create-variable (sequential)',
    },
  ];

  return calls;
}

// ─── Output ───────────────────────────────────────────────────────────────────

const calls = buildReport();

if (args.json) {
  const output: SessionInitOutput = {
    mode: 'preflight-checklist',
    instructions: 'Führe die calls in order aus und trage Ergebnisse in result ein.',
    calls,
    result_template: result,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
} else {
  process.stdout.write(`
╔══════════════════════════════════════════════════════════════════╗
║  SESSION INIT  —  Framer → Elementor V4 Pipeline               ║
║  ${new Date().toISOString()}                          ║
╚══════════════════════════════════════════════════════════════════╝

Führe diese ${calls.length} Calls in der angegebenen Reihenfolge aus:

`);

  for (const call of calls) {
    process.stdout.write(`── SCHRITT ${call.step}: ${call.label}\n`);
    process.stdout.write(`   Ability : ${call.ability}\n`);
    process.stdout.write(`   Params  : ${JSON.stringify(call.params)}\n`);
    process.stdout.write(`   Erwarte : ${call.expect}\n`);
    process.stdout.write(`   On Fail : ${call.on_fail}\n`);
    if (call.note) process.stdout.write(`   Hinweis : ${call.note}\n`);
    if (call.fallback) process.stdout.write(`   Fallback: ${call.fallback}\n`);
    process.stdout.write('\n');
  }

  process.stdout.write(`
── NACH DEN CHECKS: Trage die Ergebnisse in SESSION-STATE.md ein.
   Relevante Werte:
   • GV-IDs aus bestehenden Variablen (e-gv-*)
   • helpers_class_available → bestimmt ob batch oder sequenziell
   • atomic_available → Pflicht für V4-Build
   • elementor_version → Compatibility-Check

── FRAMER PREFLIGHT:
   1. Unframer MCP: getProjectXml() → scripts/extract-style-map.ts --output FramerExport/tokens/style-map.json
   2. Ziel-Node-XML: getNodeXml(nodeId) → FramerExport/section-name.xml
   3. Konvertierung: node --import tsx scripts/convert-xml-to-v4.ts \\\\
        --xml FramerExport/section-name.xml \\\\
        --tokens FramerExport/tokens/token-mapping.json \\\\
        --style-map FramerExport/tokens/style-map.json \\\\
        --output FramerExport/v4-tree/section-name.json \\\\
        --validate

`);
}

process.exit(0);
