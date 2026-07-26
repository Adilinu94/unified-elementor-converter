#!/usr/bin/env node
/**
 * check-v4-requirements.ts
 *
 * FIX 2: Hard-Stop Guard für Elementor V4 Atomic Widgets.
 *
 * Das Problem:
 *   elementor-check-setup gibt atomic.runtime_available: false zurück und schreibt
 *   es als String in issues[] — aber mit exit code 0. Ein Agent der das übersieht
 *   baut den kompletten V4-Tree und scheitert erst bei elementor-set-content mit
 *   "type not available" — nach Minuten Arbeit.
 *
 * Diese Lösung:
 *   Liest die JSON-Ausgabe von elementor-check-setup und bricht mit exit 1 + klarer
 *   Anweisung ab, BEVOR irgendein Script den Tree baut.
 *
 * Zwei Modi:
 *   A) --check-setup-json <file>  Liest gespeicherte Ausgabe von elementor-check-setup
 *   B) --mcp-response <file>      Wie A, alias
 *   C) Kein Input                 Gibt nur die Prüf-Checkliste aus (dry guidance)
 *
 * Usage:
 *   # Vor dem Pipeline-Start: Ausgabe von elementor-check-setup prüfen
 *   node --import tsx scripts/check-v4-requirements.ts --check-setup-json setup.json
 *
 *   # In wizard.js eingebettet (liest von stdin):
 *   echo '<json>' | node --import tsx scripts/check-v4-requirements.ts --stdin
 *
 *   # Nur Guidance ausgeben (kein File nötig):
 *   node --import tsx scripts/check-v4-requirements.ts --guidance
 *
 * Exit codes:
 *   0 = alle V4-Anforderungen erfüllt
 *   1 = HARD STOP — V4 nicht nutzbar, Build darf nicht starten
 *   2 = Input-Fehler
 */

'use strict';

import { parseArgs }  from 'node:util';
import { readFileSync, existsSync } from 'node:fs';

const { values: args } = parseArgs({
  options: {
    'check-setup-json': { type: 'string' },
    'mcp-response':     { type: 'string' },
    'stdin':            { type: 'boolean', default: false },
    'auto-call':        { type: 'boolean', default: false },
    'guidance':         { type: 'boolean', default: false },
    'help':             { type: 'boolean', default: false },
  },
  strict: false,
});

// ─── ANSI ─────────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SetupData {
  atomic?: Record<string, unknown>;
  elementor?: { version?: string; min_version_met?: boolean };
  kit?: { active_breakpoints?: unknown[] };
  issues?: string[];
  elementor_pro?: { active?: boolean };
  [key: string]: unknown;
}

interface McpBridgeClass {
  fromConfig(): Promise<McpBridgeInstance>;
}

interface McpBridgeInstance {
  call(ability: string, params: Record<string, unknown>): Promise<unknown>;
}

interface CheckEntry {
  id: string;
  label: string;
  pass: boolean;
  severity: 'HARD_STOP' | 'WARNING';
  fix: string;
}

interface SummaryOutput {
  pass: boolean;
  hard_stops: number;
  warnings: number;
  atomic: Record<string, unknown>;
  elementor_version: string | undefined;
  kit_breakpoints: unknown[];
}

// ─── Guidance (immer ausgeben) ─────────────────────────────────────────────────
const GUIDANCE = `
${C.bold}Elementor V4 Atomic — Voraussetzungen checken${C.reset}

Bevor die Framer-Pipeline startet, diese 3 Punkte in WordPress prüfen:

  ${C.cyan}1. Atomic Widgets Experiment einschalten${C.reset}
     Elementor → Settings → Features → "Atomic Widgets" → ON
     (Ohne das: e-heading, e-flexbox usw. sind nicht registriert → Build schlägt fehl)

  ${C.cyan}2. elementor-check-setup aufrufen${C.reset}
     MCP: novamira/elementor-check-setup {}
     Erwartete Werte:
       atomic.runtime_available: true       ← PFLICHT
       atomic.global_classes_available: true ← PFLICHT für GC-Workflow
       atomic.variables_available: true      ← PFLICHT für e-gv-* Token
       elementor.min_version_met: true       ← Elementor ≥ 3.19

  ${C.cyan}3. Ausgabe prüfen lassen${C.reset}
     node --import tsx scripts/check-v4-requirements.ts --check-setup-json setup.json

${C.yellow}Wenn atomic.runtime_available: false:${C.reset}
  → Elementor → Settings → Features → Atomic Widgets → Aktivieren → Speichern
  → Cache leeren (Elementor → Tools → Regenerate Files)
  → elementor-check-setup erneut aufrufen
`;

if (args.help || args.guidance) {
  process.stdout.write(GUIDANCE);
  process.exit(0);
}

// ─── Load check-setup output ──────────────────────────────────────────────────

let setupData: SetupData | null = null;

const inputFile = (args['check-setup-json'] || args['mcp-response']) as string | undefined;

// ── NEU: --auto-call (Fix D) — Direkter elementor-check-setup via McpBridge ──
if (args['auto-call']) {
  try {
    const mod = await import('./lib/mcp-bridge.js') as { McpBridge: McpBridgeClass };
    const McpBridge = mod.McpBridge;
    const mcp = await McpBridge.fromConfig();
    process.stderr.write(`[check-v4] Rufe elementor-check-setup auf...\n`);
    const raw = await mcp.call('novamira/elementor-check-setup', {});
    setupData = (raw as { data?: SetupData }).data ?? (raw as SetupData);
    process.stderr.write(`[check-v4] elementor-check-setup erfolgreich.\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${C.red}[check-v4] Auto-Call fehlgeschlagen: ${message}${C.reset}\n`);
    process.stderr.write(`${C.yellow}[check-v4] Fallback: Speichere die Ausgabe von elementor-check-setup als JSON und verwende --check-setup-json <datei>${C.reset}\n`);
    process.exit(2);
  }
}

if (inputFile && !setupData) {
  // --check-setup-json wird nur genutzt wenn --auto-call nicht lief oder fehlschlug
  if (!existsSync(inputFile)) {
    process.stderr.write(`${C.red}FEHLER: Datei nicht gefunden: ${inputFile}${C.reset}\n`);
    process.exit(2);
  }
  try {
    const raw: SetupData = JSON.parse(readFileSync(inputFile, 'utf8'));
    // Accept both direct response and { data: {...} } wrapper
    setupData = (raw.data ?? raw) as SetupData;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${C.red}FEHLER: Ungültiges JSON in ${inputFile}: ${message}${C.reset}\n`);
    process.exit(2);
  }
} else if (!setupData && args.stdin) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) buf += chunk;
  try {
    const raw: SetupData = JSON.parse(buf);
    setupData = (raw.data ?? raw) as SetupData;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${C.red}FEHLER: Ungültiges JSON auf stdin: ${message}${C.reset}\n`);
    process.exit(2);
  }
} else if (!setupData) {
  // No input — just print guidance
  process.stdout.write(GUIDANCE);
  process.exit(0);
}

// ─── Guard: Sicherstellen dass setupData ein Objekt ist ───────────────────────
if (!setupData || typeof setupData !== 'object') {
  process.stderr.write(`${C.red}FEHLER: Keine gültigen Check-Setup-Daten. setupData ist ${typeof setupData}.${C.reset}\n`);
  process.stderr.write(`${C.yellow}Bitte elementor-check-setup erneut ausführen und Ausgabe als JSON speichern.${C.reset}\n`);
  process.exit(2);
}

// ─── Checks ──────────────────────────────────────────────────────────────────

const atomic   = (setupData.atomic   ?? {}) as Record<string, unknown>;
const elem     = (setupData.elementor ?? {}) as { version?: string; min_version_met?: boolean };
const kit      = (setupData.kit       ?? {}) as { active_breakpoints?: unknown[] };
const issues   = (setupData.issues    ?? []) as string[];

const checks: CheckEntry[] = [
  {
    id:       'ATOMIC_RUNTIME',
    label:    'atomic.runtime_available',
    pass:     atomic.runtime_available === true,
    severity: 'HARD_STOP',
    fix:      'Elementor → Settings → Features → "Atomic Widgets" einschalten, dann Cache leeren',
  },
  {
    id:       'ATOMIC_GLOBAL_CLASSES',
    label:    'atomic.global_classes_available',
    pass:     atomic.global_classes_available === true,
    severity: 'HARD_STOP',
    fix:      'Global Classes sind Teil von Atomic Widgets — Atomic Widgets Experiment muss ON sein',
  },
  {
    id:       'ATOMIC_VARIABLES',
    label:    'atomic.variables_available',
    pass:     atomic.variables_available === true,
    severity: 'HARD_STOP',
    fix:      'Variables (e-gv-*) benötigen Atomic Widgets Experiment ON',
  },
  {
    id:       'ATOMIC_STYLE_SCHEMA',
    label:    'atomic.style_schema_available',
    pass:     atomic.style_schema_available === true,
    severity: 'WARNING',
    fix:      'Style-Schema nicht verfügbar — $$type-Validierung eingeschränkt',
  },
  {
    id:       'ELEMENTOR_MIN_VERSION',
    label:    'elementor.min_version_met',
    pass:     elem.min_version_met === true,
    severity: 'HARD_STOP',
    fix:      `Elementor Version zu alt (${elem.version ?? '?'}) — mindestens 3.19.0 erforderlich`,
  },
  {
    id:       'ELEMENTOR_PRO_ACTIVE',
    label:    'elementor_pro.active',
    pass:     setupData.elementor_pro?.active === true,
    severity: 'WARNING',
    fix:      'Elementor Pro nicht aktiv — GC-Workflow und Variables benötigen Pro',
  },
];

// ─── Report ──────────────────────────────────────────────────────────────────

process.stderr.write(`\n${C.bold}check-v4-requirements.ts${C.reset}\n\n`);

const hardStops: CheckEntry[] = [];
const warnings: CheckEntry[]  = [];

for (const c of checks) {
  const icon = c.pass
    ? `${C.green}✓${C.reset}`
    : c.severity === 'HARD_STOP' ? `${C.red}✗${C.reset}` : `${C.yellow}⚠${C.reset}`;

  process.stderr.write(`  ${icon}  ${c.label.padEnd(40)} ${c.pass ? C.green + 'OK' + C.reset : C.red + 'FAIL' + C.reset}\n`);

  if (!c.pass) {
    if (c.severity === 'HARD_STOP') hardStops.push(c);
    else warnings.push(c);
  }
}

// Any issues from elementor-check-setup itself
const blockerIssues = issues.filter(i =>
  i.includes('e_atomic_elements') ||
  i.includes('not registered')    ||
  i.includes('experiment is OFF')
);

process.stderr.write('\n');

if (blockerIssues.length > 0) {
  process.stderr.write(`${C.red}${C.bold}Elementor Issues erkannt:${C.reset}\n`);
  for (const issue of blockerIssues) {
    process.stderr.write(`  ${C.red}→ ${issue}${C.reset}\n`);
  }
  process.stderr.write('\n');
}

if (hardStops.length > 0) {
  process.stderr.write(`${C.red}${C.bold}━━━ HARD STOP — Pipeline darf NICHT starten ━━━${C.reset}\n\n`);

  for (const c of hardStops) {
    process.stderr.write(`  ${C.red}✗ ${c.id}${C.reset}\n`);
    process.stderr.write(`    ${C.yellow}Fix:${C.reset} ${c.fix}\n\n`);
  }

  process.stderr.write(`${C.bold}Reihenfolge:${C.reset}\n`);
  process.stderr.write(`  1. WordPress → Elementor → Settings → Features → Atomic Widgets → ${C.green}ON${C.reset}\n`);
  process.stderr.write(`  2. Elementor → Tools → Regenerate CSS & Data → Cache leeren\n`);
  process.stderr.write(`  3. novamira/elementor-check-setup {} erneut aufrufen\n`);
  process.stderr.write(`  4. Ausgabe erneut mit diesem Script prüfen\n`);
  process.stderr.write(`  5. Erst dann: Pipeline starten\n\n`);

  process.exit(1);
}

if (warnings.length > 0) {
  process.stderr.write(`${C.yellow}${C.bold}Warnungen (Pipeline kann starten, aber überprüfen):${C.reset}\n`);
  for (const w of warnings) {
    process.stderr.write(`  ${C.yellow}⚠ ${w.id}${C.reset} — ${w.fix}\n`);
  }
  process.stderr.write('\n');
}

process.stderr.write(`${C.green}${C.bold}✓ Alle V4-Pflichtanforderungen erfüllt — Pipeline kann starten.${C.reset}\n\n`);

// Output JSON summary for scripting
const summary: SummaryOutput = {
  pass: true,
  hard_stops: 0,
  warnings: warnings.length,
  atomic: atomic as Record<string, unknown>,
  elementor_version: elem.version,
  kit_breakpoints: kit.active_breakpoints ?? [],
};

process.stdout.write(JSON.stringify(summary, null, 2) + '\n');

process.exit(0);
