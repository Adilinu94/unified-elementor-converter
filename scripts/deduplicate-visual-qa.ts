#!/usr/bin/env node
/**
 * deduplicate-visual-qa.ts
 *
 * FIX 1: Overlap-Deduplizierung für adrians-visual-qa Output.
 *
 * Usage:
 *   node --import tsx scripts/deduplicate-visual-qa.ts --input qa-raw.json --output qa-clean.json
 *
 * Exit codes:
 *   0 = keine errors oder warnings (nur info)
 *   1 = echte errors oder warnings vorhanden
 *   2 = Input-Fehler
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface VisualQaIssue {
  type?: string;
  severity?: string;
  element_id?: string;
  element_ids?: string[];
  message?: string;
  element_type?: string;
  group_index?: number;
  element_count?: number;
  pair_count?: number;
  widget_types?: string[];
  deduplicated_from?: number;
  [key: string]: unknown;
}

interface OverlapGroup {
  severity: string;
  type: string;
  group_index: number;
  element_count: number;
  pair_count: number;
  element_ids: string[];
  widget_types: string[];
  message: string;
  deduplicated_from: number;
}

interface DedupStats {
  before: number;
  after: number;
  overlap_pairs_raw: number;
  overlap_groups: number;
  noise_reduction: string;
}

interface SeverityCounts {
  error: number;
  warning: number;
  info: number;
}

interface CleanReport {
  total_issues: number;
  total_issues_raw: number;
  deduplication_stats: DedupStats;
  by_severity: SeverityCounts;
  issues: VisualQaIssue[];
  [key: string]: unknown;
}

// ── Modul-Export — importierbar ohne CLI-Ausfuehrung ──────────────────────────

export function deduplicateVisualIssues(rawIssues: VisualQaIssue[]): VisualQaIssue[] {
  const overlapIssues    = (rawIssues || []).filter(i => i.type === 'overlap');
  const nonOverlapIssues = (rawIssues || []).filter(i => i.type !== 'overlap');

  const adjacency = new Map<string, Set<string>>();
  for (const issue of overlapIssues) {
    const match   = issue.message?.match(/#([0-9a-f]+)/i);
    const sibling = match?.[1];
    const self    = issue.element_id;
    if (!self || !sibling) continue;
    if (!adjacency.has(self))    adjacency.set(self, new Set());
    if (!adjacency.has(sibling)) adjacency.set(sibling, new Set());
    adjacency.get(self)!.add(sibling);
    adjacency.get(sibling)!.add(self);
  }

  const visited = new Set<string>();
  const groups: Set<string>[] = [];
  for (const startId of adjacency.keys()) {
    if (visited.has(startId)) continue;
    const group = new Set<string>();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id); group.add(id);
      for (const neighbor of (adjacency.get(id) ?? new Set())) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    groups.push(group);
  }

  const dedupedOverlaps: VisualQaIssue[] = groups.map(group => ({
    type: 'overlap-group',
    element_ids: [...group],
    pair_count: (group.size * (group.size - 1)) / 2,
    severity: 'warning',
    message: `Overlap-Gruppe: ${group.size} Elemente (${(group.size * (group.size - 1)) / 2} Paare)`,
  }));

  return [...nonOverlapIssues, ...dedupedOverlaps];
}

// ── CLI-Guard: nur ausfuehren wenn direkt aufgerufen ─────────────────────────
const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {

const { values: args } = parseArgs({
  options: {
    input:   { type: 'string' },
    output:  { type: 'string' },
    verbose: { type: 'boolean', default: false },
    help:    { type: 'boolean', default: false },
  },
  strict: false,
});

const inputPath: string | undefined = args.input as string | undefined;
const outputPath: string | undefined = args.output as string | undefined;

if (args.help || !inputPath) {
  process.stdout.write(`
deduplicate-visual-qa.ts — Overlap-Deduplizierung für adrians-visual-qa

USAGE:
  node --import tsx scripts/deduplicate-visual-qa.ts --input <qa-raw.json> [--output <qa-clean.json>]

OPTIONEN:
  --input FILE    Raw JSON output von novamira/adrians-visual-qa (required)
  --output FILE   Bereinigter Report  [default: stdout]
  --verbose       Zeigt auch deduplizierte Overlap-Gruppen Details
  --help          Diese Hilfe

EXIT:
  0 = nur info-Issues (kein Handlungsbedarf)
  1 = echte errors oder warnings vorhanden
  2 = Input-Fehler
`);
  process.exit(args.help ? 0 : 2);
}

// ─── Load input ───────────────────────────────────────────────────────────────

if (!existsSync(inputPath)) {
  process.stderr.write(`FEHLER: Input nicht gefunden: ${inputPath}\n`);
  process.exit(2);
}

let rawReport: Record<string, unknown>;
try {
  const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
  rawReport = (raw.data as Record<string, unknown>) ?? raw;
} catch (e) {
  process.stderr.write(`FEHLER: Ungültiges JSON: ${(e as Error).message}\n`);
  process.exit(2);
}

const allIssues: VisualQaIssue[] = (rawReport.issues as VisualQaIssue[]) ?? [];

// ─── Split issues ────────────────────────────────────────────────────────────

const overlapIssues    = allIssues.filter(i => i.type === 'overlap');
const nonOverlapIssues = allIssues.filter(i => i.type !== 'overlap');

// ─── Deduplicate overlaps ─────────────────────────────────────────────────────

const adjacency = new Map<string, Set<string>>();

for (const issue of overlapIssues) {
  const match = issue.message?.match(/#([0-9a-f]+)/i);
  const sibling = match?.[1];
  const self    = issue.element_id;
  if (!self || !sibling) continue;

  if (!adjacency.has(self))    adjacency.set(self, new Set());
  if (!adjacency.has(sibling)) adjacency.set(sibling, new Set());
  adjacency.get(self)!.add(sibling);
  adjacency.get(sibling)!.add(self);
}

// Find connected components via BFS
const visited = new Set<string>();
const groups: Set<string>[] = [];

for (const startId of adjacency.keys()) {
  if (visited.has(startId)) continue;
  const group = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    group.add(id);
    for (const neighbor of (adjacency.get(id) ?? new Set())) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  groups.push(group);
}

// Build deduplicated overlap summaries
const deduplicatedOverlaps: OverlapGroup[] = groups.map((group, i) => {
  const elementIds = [...group];
  const pairCount  = (elementIds.length * (elementIds.length - 1)) / 2;

  // Collect widget types from original issues
  const widgetTypes = new Set<string>();
  for (const issue of overlapIssues) {
    if (group.has(issue.element_id || '')) {
      const typeMatch = issue.message?.match(/overlap with "([^"]+)"/);
      if (typeMatch) widgetTypes.add(typeMatch[1]);
      if (issue.element_type && issue.element_type !== 'absolute-positioned') {
        widgetTypes.add(issue.element_type);
      }
    }
  }

  const types = [...widgetTypes].join(', ') || 'mixed';

  return {
    severity:     'info',
    type:         'overlap_group',
    group_index:  i + 1,
    element_count: elementIds.length,
    pair_count:   pairCount,
    element_ids:  elementIds,
    widget_types: [...widgetTypes],
    message:      `Container group ${i + 1}: ${elementIds.length} absolute-positioned siblings (${types}) — ${pairCount} potential overlap pairs. Intentional layout or review z-index/positioning.`,
    deduplicated_from: pairCount,
  };
});

// ─── Build clean report ───────────────────────────────────────────────────────

const cleanIssues: VisualQaIssue[] = [
  ...nonOverlapIssues,
  ...deduplicatedOverlaps as VisualQaIssue[],
];

const beforeCount = allIssues.length;
const afterCount  = cleanIssues.length;
const reduction   = beforeCount > 0
  ? Math.round((1 - afterCount / beforeCount) * 100)
  : 0;

const bySeverity: SeverityCounts = { error: 0, warning: 0, info: 0 };
for (const i of cleanIssues) {
  const sev = i.severity || 'info';
  bySeverity[sev as keyof SeverityCounts] = (bySeverity[sev as keyof SeverityCounts] ?? 0) + 1;
}

const cleanReport: CleanReport = {
  ...rawReport,
  total_issues:          cleanIssues.length,
  total_issues_raw:      beforeCount,
  deduplication_stats: {
    before:            beforeCount,
    after:             afterCount,
    overlap_pairs_raw: overlapIssues.length,
    overlap_groups:    deduplicatedOverlaps.length,
    noise_reduction:   `${reduction}%`,
  },
  by_severity: bySeverity,
  issues:      cleanIssues,
};

// ─── Output ───────────────────────────────────────────────────────────────────

const json = JSON.stringify(cleanReport, null, 2);

if (outputPath) {
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(resolve(outputPath), json, 'utf8');
}

process.stdout.write(json + '\n');

// ─── Human summary ────────────────────────────────────────────────────────────

const C = { reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m' };

process.stderr.write(`\n${C.bold}deduplicate-visual-qa.ts${C.reset}\n\n`);
process.stderr.write(`  Issues vorher: ${C.yellow}${beforeCount}${C.reset}\n`);
process.stderr.write(`  Issues nachher: ${C.green}${afterCount}${C.reset}\n`);
process.stderr.write(`  Rausch-Reduktion: ${C.cyan}${reduction}%${C.reset}\n`);
process.stderr.write(`  Overlap-Paare → ${overlapIssues.length} Paare → ${deduplicatedOverlaps.length} Gruppen\n\n`);

if (bySeverity.error > 0) {
  process.stderr.write(`  ${C.red}${C.bold}${bySeverity.error} ERROR(S) — sofort beheben!${C.reset}\n`);
  for (const i of cleanIssues.filter(x => x.severity === 'error')) {
    process.stderr.write(`    ${C.red}✗${C.reset} [${i.type}] ${i.element_id ?? ''}: ${i.message}\n`);
  }
}
if (bySeverity.warning > 0) {
  process.stderr.write(`  ${C.yellow}${bySeverity.warning} WARNING(S)${C.reset}\n`);
  for (const i of cleanIssues.filter(x => x.severity === 'warning')) {
    process.stderr.write(`    ${C.yellow}⚠${C.reset} [${i.type}] ${i.element_id ?? ''}: ${i.message}\n`);
  }
}

if (args.verbose && deduplicatedOverlaps.length > 0) {
  process.stderr.write(`\n  ${C.cyan}Overlap-Gruppen:${C.reset}\n`);
  for (const g of deduplicatedOverlaps) {
    process.stderr.write(`    Gruppe ${g.group_index}: ${g.element_count} Elemente (${g.widget_types.join(', ')}) — ${g.pair_count} Paare\n`);
    if (args.verbose) process.stderr.write(`      IDs: ${g.element_ids.join(', ')}\n`);
  }
}

if (bySeverity.error === 0 && bySeverity.warning === 0) {
  process.stderr.write(`  ${C.green}✓ Keine echten Fehler — nur Info${C.reset}\n`);
}

process.stderr.write('\n');
process.exit(bySeverity.error > 0 || bySeverity.warning > 0 ? 1 : 0);

} // end isMain
