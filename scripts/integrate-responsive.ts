#!/usr/bin/env node
/**
 * integrate-responsive.ts  —  Fix #12: Responsive Breakpoints Pipeline-Integration
 *
 * Verbindet extract-responsive-breakpoints.js + auto-scale-responsive.js
 * als einen einzigen Post-Convert-Schritt.
 *
 * Workflow:
 *   1. Lädt einen fertigen V4-Tree (--tree)
 *   2. Wenn --breakpoints-json vorhanden: nutzt die extrahierten Framer-Breakpoints
 *      für element-spezifische Skalierung (C5-Logik in auto-scale-responsive.js)
 *   3. Wenn --css vorhanden: extrahiert Breakpoints zuerst via extract-responsive-breakpoints.js
 *   4. Schreibt den Tree mit tablet/mobile Varianten zurück
 *
 * Usage:
 *   # Mit vorhandenem Breakpoints-JSON:
 *   node --import tsx scripts/integrate-responsive.ts \
 *     --tree FramerExport/v4-tree/hero.json \
 *     --breakpoints-json FramerExport/tokens/responsive-breakpoints.json \
 *     --output FramerExport/v4-tree/hero-responsive.json
 *
 *   # Mit CSS-Quelle (extrahiert Breakpoints + skaliert in einem Schritt):
 *   node --import tsx scripts/integrate-responsive.ts \
 *     --tree FramerExport/v4-tree/hero.json \
 *     --css FramerExport/index.html \
 *     --output FramerExport/v4-tree/hero-responsive.json
 *
 * Exit-Codes:
 *   0  — Responsive-Varianten eingefügt (oder bereits vorhanden)
 *   1  — Tree nicht gefunden
 *   2  — Keine CSS-Quelle verfügbar (kein --breakpoints-json und kein --css)
 */

import fs    from 'node:fs';
import path  from 'node:path';
import os    from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// ─── Typen ─────────────────────────────────────────────────────────────────────

interface StyleVariant {
  meta?: {
    breakpoint?: string;
  };
}

interface StyleEntry {
  variants?: StyleVariant[];
}

interface V4Element {
  styles?: Record<string, StyleEntry>;
  elements?: V4Element[];
  children?: V4Element[];
}

// ─── CLI-Args ──────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    tree:                { type: 'string' },   // V4-Tree JSON
    output:              { type: 'string' },   // Output-Pfad (default: überschreibt input)
    'breakpoints-json':  { type: 'string' },   // Vorhandenes responsive-breakpoints.json
    css:                 { type: 'string' },   // HTML/CSS für On-the-fly-Extraktion
    'skip-if-present':   { type: 'boolean', default: true },  // Bereits vorhandene Breakpoints nicht überschreiben
    verbose:             { type: 'boolean', default: false },
  },
  strict: false,
});

const log  = (...m: string[]) => {
  if (args.verbose) process.stderr.write('[integrate-responsive] ' + m.join(' ') + '\n');
};
const warn = (m: string) =>
  process.stderr.write(`⚠ [integrate-responsive] ${m}\n`);

// ─── Validation ──────────────────────────────────────────────────────────────

const treePath = args.tree as string | undefined;

if (!treePath) {
  process.stderr.write('Fehler: --tree <v4-tree.json> erforderlich\n');
  process.stderr.write('Nutzung: node --import tsx scripts/integrate-responsive.ts --tree <file> [--breakpoints-json <file> | --css <file>]\n');
  process.exit(1);
}

if (!fs.existsSync(treePath)) {
  process.stderr.write(`Fehler: Tree nicht gefunden: ${treePath}\n`);
  process.exit(1);
}

const outputPath: string = (args.output as string) || treePath;

// ─── Schritt 1: Breakpoints-JSON sicherstellen ───────────────────────────────

let breakpointsJsonPath: string | undefined = args['breakpoints-json'] as string | undefined;

if (!breakpointsJsonPath && args.css) {
  // On-the-fly Extraktion via extract-responsive-breakpoints.ts
  const cssPath = args.css as string;
  const tmpBp = path.join(os.tmpdir(), `responsive-bp-${Date.now()}.json`);
  log(`Extrahiere Breakpoints aus: ${cssPath}`);

  const extractResult = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'extract-responsive-breakpoints.ts'),
      '--css', cssPath,
      '--output', tmpBp,
      ...(args.verbose ? ['--verbose'] : []),
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );

  if (extractResult.status === 0 && fs.existsSync(tmpBp)) {
    breakpointsJsonPath = tmpBp;
    log(`Breakpoints extrahiert → ${tmpBp}`);
  } else {
    warn('Breakpoint-Extraktion fehlgeschlagen — nutze Standard-Skalierungsfaktoren (0.75 tablet, 0.6 mobile)');
  }
} else if (!breakpointsJsonPath) {
  warn('Kein --breakpoints-json und kein --css angegeben — nutze Standard-Skalierungsfaktoren');
}

// ─── Schritt 2: Tree prüfen ob Breakpoints schon vorhanden ──────────────────

const tree: V4Element[] | V4Element = JSON.parse(fs.readFileSync(treePath, 'utf8'));

function countExistingBreakpoints(node: V4Element): number {
  let count = 0;
  if (node?.styles) {
    for (const style of Object.values(node.styles)) {
      const variants = style.variants || [];
      if (variants.some(v => v.meta?.breakpoint === 'tablet' || v.meta?.breakpoint === 'mobile')) {
        count++;
      }
    }
  }
  for (const child of (node.elements || node.children || [])) {
    count += countExistingBreakpoints(child);
  }
  return count;
}

const existingBpCount = Array.isArray(tree)
  ? tree.reduce((s, n) => s + countExistingBreakpoints(n), 0)
  : countExistingBreakpoints(tree);

if (existingBpCount > 0 && args['skip-if-present']) {
  process.stderr.write(`ℹ [integrate-responsive] ${existingBpCount} Breakpoint-Varianten bereits vorhanden — übersprungen (--skip-if-present).\n`);
  process.stderr.write(`   Zum Überschreiben: --skip-if-present false\n`);
  process.exit(0);
}

// ─── Schritt 3: auto-scale-responsive.ts ausführen ──────────────────────────

log(`Starte auto-scale-responsive.ts für: ${treePath}`);

const scaleArgs: string[] = [
  path.join(__dirname, 'auto-scale-responsive.ts'),
  '--tree', treePath,
  '--output', outputPath,
];
if (breakpointsJsonPath && fs.existsSync(breakpointsJsonPath)) {
  scaleArgs.push('--breakpoints', breakpointsJsonPath);
}

const scaleResult = spawnSync(process.execPath, scaleArgs, { stdio: 'inherit' });

// Temp-Datei aufräumen
if (breakpointsJsonPath && breakpointsJsonPath.includes(os.tmpdir())) {
  try { fs.unlinkSync(breakpointsJsonPath); } catch { /* ignore */ }
}

if (scaleResult.status !== 0) {
  process.stderr.write('[integrate-responsive] auto-scale-responsive.ts fehlgeschlagen\n');
  process.exit(2);
}

process.stderr.write(`✓ Responsive-Integration abgeschlossen → ${outputPath}\n`);
