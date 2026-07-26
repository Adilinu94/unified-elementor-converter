#!/usr/bin/env node
/**
 * scripts/post-build-auto-fix.ts  —  Phase 2: Post-Build Auto-Fix
 *
 * Liest einen QA-Report (qa-report.json) und generiert MCP-Execution-Pläne
 * für automatisch behebbare Issues.
 *
 * Usage:
 *   node --import tsx scripts/post-build-auto-fix.ts \
 *     --qa-report qa-report.json \
 *     --post-id 123 \
 *     --output auto-fix-plan.json
 *
 *   node --import tsx scripts/post-build-auto-fix.ts --apply-results auto-fix-results.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface FixedItem {
  ability?: string;
  element_id?: string | null;
  applied?: boolean;
  count?: number;
  error?: string | null;
}

interface FixSummaryDetail {
  ability: string;
  element_id: string | null;
  applied: boolean;
  count: number;
  error: string | null;
}

interface FixSummary {
  generated_at: string;
  applied: number;
  dry_run: number;
  failed: number;
  details: FixSummaryDetail[];
}

interface QALayoutIssue {
  check?: string;
  element_id?: string;
  severity?: string;
  suggestion?: string;
  type?: string;
  message?: string;
}

interface QAVisualIssue {
  type?: string;
  element_id?: string;
  severity?: string;
  message?: string;
}

interface QAActionItem {
  type?: string;
  element_id?: string;
  priority?: string;
  ability?: string;
  fix?: string;
}

interface QAVariableDrift {
  variable?: string;
  from?: string;
  to?: string;
}

interface QAReport {
  post_id?: number;
  layout?: { issues?: QALayoutIssue[] };
  visual?: { issues?: QAVisualIssue[] };
  action_items?: QAActionItem[];
  variables?: { drift?: QAVariableDrift[] };
  results?: QAResult[];
  meta?: { post_id?: number };
}

interface QAResult {
  breakpoint: string;
  details?: {
    a11y?: {
      violations?: A11yViolation[];
    };
  };
}

interface A11yViolation {
  id?: string;
  impact?: string;
  help?: string;
  helpUrl?: string;
}

interface ClassifiedIssue {
  category: string;
  subcategory?: string;
  element_id?: string;
  severity?: string;
  impact?: string;
  help?: string;
  helpUrl?: string;
  breakpoint?: string;
  suggestion?: string;
  message?: string;
  count?: number;
  priority?: string;
  ability: string;
  params: Record<string, unknown>;
}

interface McpCall {
  ability: string;
  params: Record<string, unknown>;
  note?: string;
  phase: string;
  dry_run?: boolean;
}

interface PlanStats {
  total_issues: number;
  unique_calls: number;
  by_category: Record<string, number>;
  by_ability: Record<string, number>;
}

interface AutoFixPlan {
  description: string;
  generated_at: string;
  source: string;
  post_id: number | null;
  dry_run: boolean;
  stats: PlanStats;
  mcp_calls: McpCall[];
  agent_instruction: string;
}

// ─── CLI ARGS ─────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'qa-report':       { type: 'string' },
    'post-id':         { type: 'string' },
    output:            { type: 'string' },
    'fix-types':       { type: 'string', default: 'contrast,alt-text,seo,layout,variables' },
    'apply-results':   { type: 'string' },
    'dry-run':         { type: 'boolean', default: false },
    verbose:           { type: 'boolean', default: false },
    help:              { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help) {
  showHelp();
  process.exit(0);
}

const log = (...m: string[]) => { if (args.verbose) process.stderr.write('[auto-fix] ' + m.join(' ') + '\n'); };

// ─── Apply-Results Modus ─────────────────────────────────────────────────────

if (args['apply-results']) {
  const resultsFile = args['apply-results'] as string;
  if (!existsSync(resultsFile)) {
    console.error(`ERROR: Datei nicht gefunden: ${resultsFile}`);
    process.exit(1);
  }

  const results = JSON.parse(readFileSync(resultsFile, 'utf8'));
  const fixes: FixedItem[] = Array.isArray(results) ? results : results.results || [];

  const summary: FixSummary = {
    generated_at: new Date().toISOString(),
    applied: fixes.filter(f => f.applied !== false).length,
    dry_run: fixes.filter(f => f.applied === false).length,
    failed:  fixes.filter(f => f.error).length,
    details: fixes.map(f => ({
      ability:    f.ability || '',
      element_id: f.element_id || null,
      applied:    f.applied !== false,
      count:      f.count || 0,
      error:      f.error || null,
    })),
  };

  const outputFile = 'auto-fix-summary.json';
  writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  console.log(`\n✅ Auto-Fix-Summary gespeichert: ${outputFile}`);
  console.log(`   ${summary.applied} Fixes applied`);
  console.log(`   ${summary.dry_run} dry-runs`);
  console.log(`   ${summary.failed} Fehler`);
  process.exit(0);
}

// ─── Validierung ──────────────────────────────────────────────────────────────

if (!args['qa-report']) {
  console.error('Error: --qa-report <pfad> required');
  process.exit(2);
}

const qaReportPath = args['qa-report'] as string;
if (!existsSync(qaReportPath)) {
  console.error(`Error: QA-Report nicht gefunden: ${qaReportPath}`);
  process.exit(2);
}

const postId = args['post-id'] ? parseInt(args['post-id'] as string, 10) : undefined;
const enabledTypes = new Set((args['fix-types'] as string).split(',').map(t => t.trim().toLowerCase()));
const qaReport: QAReport = JSON.parse(readFileSync(qaReportPath, 'utf8'));

if (!postId && !qaReport.post_id && !qaReport.meta?.post_id) {
  console.error('Error: Keine Post-ID gefunden. Setze --post-id <id> oder stelle sicher, dass der QA-Report eine post_id enthält.');
  process.exit(2);
}

log('QA-Report geladen:', basename(qaReportPath));
log('Fix-Typen:', [...enabledTypes].join(', '));

// ─── ISSUE CLASSIFICATION ─────────────────────────────────────────────────────

function classifyIssues(report: QAReport): ClassifiedIssue[] {
  const issues: ClassifiedIssue[] = [];

  if (report.layout?.issues?.length) {
    for (const issue of report.layout.issues) {
      if (issue.check === 'deep_nesting' && enabledTypes.has('layout')) {
        issues.push({
          category: 'layout',
          subcategory: 'deep_nesting',
          element_id: issue.element_id,
          severity: issue.severity,
          suggestion: issue.suggestion,
          ability: 'novamira/adrians-patch-element-styles',
          params: {
            post_id: postId || report.post_id,
            element_id: issue.element_id,
            patches: [{ property: 'layout', action: 'restructure', note: issue.suggestion }],
          },
        });
      }
    }
  }

  if (report.visual?.issues?.length) {
    for (const issue of report.visual.issues) {
      if (issue.type === 'fixed_dimensions' && enabledTypes.has('layout')) {
        issues.push({
          category: 'layout',
          subcategory: 'fixed_dimensions',
          element_id: issue.element_id,
          severity: issue.severity,
          message: issue.message,
          ability: 'novamira/adrians-patch-element-styles',
          params: {
            post_id: postId || report.post_id,
            element_id: issue.element_id,
            patches: [{ property: 'height', action: 'remove_fixed', note: issue.message }],
          },
        });
      }
    }
  }

  if (report.action_items?.length) {
    for (const item of report.action_items) {
      const category = mapActionType(item.type);
      if (category && enabledTypes.has(category)) {
        issues.push({
          category,
          subcategory: item.type,
          element_id: item.element_id,
          priority: item.priority,
          ability: item.ability || mapAbilityForType(item.type),
          params: {
            post_id: postId || report.post_id,
            element_id: item.element_id,
            ...(item.fix ? { patches: [{ note: item.fix }] } : {}),
          },
        });
      }
    }
  }

  if (report.variables?.drift?.length && enabledTypes.has('variables')) {
    issues.push({
      category: 'variables',
      subcategory: 'drift',
      count: report.variables.drift.length,
      ability: 'novamira/adrians-patch-element-styles',
      params: {
        post_id: postId || report.post_id,
        patches: report.variables.drift.map(v => ({
          property: v.variable || 'variable',
          action: 'reassign',
          note: `Drift: ${v.from || '?'} → ${v.to || '?'}`,
        })),
      },
    });
  }

  if (report.results?.length) {
    for (const r of report.results) {
      const violations = r.details?.a11y?.violations || [];
      for (const v of violations) {
        if (isColorContrastViolation(v) && enabledTypes.has('contrast')) {
          issues.push({
            category: 'contrast',
            subcategory: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            breakpoint: r.breakpoint,
            ability: 'novamira-adrianv2/adrians-fix-color-contrast',
            params: {
              post_id: postId || report.meta?.post_id,
              apply: !(args['dry-run'] as boolean),
              target_ratio: 4.5,
            },
          });
        }

        if (isImageAltViolation(v) && enabledTypes.has('alt-text')) {
          issues.push({
            category: 'alt-text',
            subcategory: v.id,
            impact: v.impact,
            help: v.help,
            breakpoint: r.breakpoint,
            ability: 'novamira-adrianv2/adrians-add-alt-text-from-context',
            params: {
              post_id: postId || report.meta?.post_id,
              apply: !(args['dry-run'] as boolean),
            },
          });
        }
      }
    }
  }

  return issues;
}

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────

function deduplicateIssues(issues: ClassifiedIssue[]): McpCall[] {
  const groups = new Map<string, ClassifiedIssue[]>();

  for (const issue of issues) {
    const key = issue.ability;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(issue);
  }

  const mcpCalls: McpCall[] = [];

  for (const [ability, groupIssues] of groups) {
    if (ability === 'novamira-adrianv2/adrians-fix-color-contrast') {
      mcpCalls.push({
        ability,
        params: {
          post_id: groupIssues[0].params.post_id,
          apply: groupIssues[0].params.apply,
          target_ratio: 4.5,
        },
        note: `${groupIssues.length} contrast violation(s) detected`,
        phase: 'post-build-auto-fix',
        dry_run: !groupIssues[0].params.apply,
      });
    } else if (ability === 'novamira-adrianv2/adrians-add-alt-text-from-context') {
      mcpCalls.push({
        ability,
        params: {
          post_id: groupIssues[0].params.post_id,
          apply: groupIssues[0].params.apply,
        },
        note: `${groupIssues.length} image(s) missing alt text`,
        phase: 'post-build-auto-fix',
        dry_run: !groupIssues[0].params.apply,
      });
    } else if (ability === 'novamira/adrians-patch-element-styles') {
      const seen = new Set<string>();
      for (const issue of groupIssues) {
        const elId = issue.params.element_id as string | undefined;
        if (elId && !seen.has(elId)) {
          seen.add(elId);
          mcpCalls.push({
            ability,
            params: {
              post_id: issue.params.post_id,
              element_id: elId,
              patches: issue.params.patches || [],
            },
            note: issue.subcategory || issue.category,
            phase: 'post-build-auto-fix',
          });
        }
      }
    }
  }

  return mcpCalls;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isColorContrastViolation(violation: A11yViolation): boolean {
  const id = (violation.id || '').toLowerCase();
  return id.includes('color-contrast') || id.includes('contrast');
}

function isImageAltViolation(violation: A11yViolation): boolean {
  const id = (violation.id || '').toLowerCase();
  return id.includes('image-alt') || id.includes('image-redundant-alt') ||
         id.includes('alt') || id.includes('aria-input');
}

function mapActionType(type?: string): string | null {
  const map: Record<string, string> = {
    layout: 'layout',
    style: 'layout',
    color: 'contrast',
    contrast: 'contrast',
    alt: 'alt-text',
    'alt-text': 'alt-text',
    seo: 'seo',
    meta: 'seo',
    schema: 'seo',
    variable: 'variables',
    drift: 'variables',
  };
  return map[type?.toLowerCase() || ''] || null;
}

function mapAbilityForType(type?: string): string {
  const map: Record<string, string> = {
    layout: 'novamira/adrians-patch-element-styles',
    style: 'novamira/adrians-patch-element-styles',
    color: 'novamira-adrianv2/adrians-fix-color-contrast',
    contrast: 'novamira-adrianv2/adrians-fix-color-contrast',
    alt: 'novamira-adrianv2/adrians-add-alt-text-from-context',
    'alt-text': 'novamira-adrianv2/adrians-add-alt-text-from-context',
    seo: 'novamira-adrianv2/adrians-generate-meta-tags',
    variable: 'novamira/adrians-patch-element-styles',
  };
  return map[type?.toLowerCase() || ''] || 'novamira/adrians-patch-element-styles';
}

function countBy(arr: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    const val = (item[key] as string) || 'unknown';
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

function showHelp(): void {
  console.log(`
post-build-auto-fix.ts — QA-Report → Auto-Fix MCP-Plan

Liest einen QA-Report und generiert MCP-Execution-Pläne für
automatisch behebbare Issues mit Novamira-Abilities.

Auto-Fix Kategorien:
  contrast   → novamira-adrianv2/adrians-fix-color-contrast
  alt-text   → novamira-adrianv2/adrians-add-alt-text-from-context
  seo        → novamira-adrianv2/adrians-generate-meta-tags + generate-schema-markup
  layout     → novamira/adrians-patch-element-styles
  variables  → novamira/adrians-patch-element-styles

Usage:
  node --import tsx scripts/post-build-auto-fix.ts \\
    --qa-report qa-report.json \\
    --post-id 123 \\
    --output auto-fix-plan.json

  # Nur bestimmte Fix-Typen:
  node --import tsx scripts/post-build-auto-fix.ts \\
    --qa-report qa-report.json \\
    --post-id 123 \\
    --fix-types contrast,alt-text

  # Dry-Run (keine Änderungen):
  node --import tsx scripts/post-build-auto-fix.ts \\
    --qa-report qa-report.json \\
    --post-id 123 \\
    --dry-run

  # Ergebnisse einlesen:
  node --import tsx scripts/post-build-auto-fix.ts --apply-results auto-fix-results.json

Output: auto-fix-plan.json — direkt vom Agent ausführbar via:
  novamira-yoursite-local:mcp-adapter-execute-ability
`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const issues = classifyIssues(qaReport);
log(`${issues.length} classifiable issues found`);

const mcpCalls = deduplicateIssues(issues);
log(`${mcpCalls.length} unique MCP calls after dedup`);

const effectivePostId = postId || qaReport.post_id || qaReport.meta?.post_id;

if (enabledTypes.has('seo') && effectivePostId) {
  const hasMetaCalls = mcpCalls.some(c => c.ability === 'novamira-adrianv2/adrians-generate-meta-tags');
  const hasSchemaCalls = mcpCalls.some(c => c.ability === 'novamira-adrianv2/adrians-generate-schema-markup');

  if (!hasMetaCalls) {
    mcpCalls.push({
      ability: 'novamira-adrianv2/adrians-generate-meta-tags',
      params: { post_id: effectivePostId },
      note: 'SEO Meta-Tags vorsorglich generieren (keine Issues im Report, aber Best Practice)',
      phase: 'post-build-auto-fix',
    });
    log('SEO meta-tags: added (best practice)');
  }

  if (!hasSchemaCalls) {
    mcpCalls.push({
      ability: 'novamira-adrianv2/adrians-generate-schema-markup',
      params: { post_id: effectivePostId },
      note: 'Schema-Markup vorsorglich generieren',
      phase: 'post-build-auto-fix',
    });
    log('Schema markup: added (best practice)');
  }
}

// ─── BUILD PLAN ───────────────────────────────────────────────────────────────

const plan: AutoFixPlan = {
  description: 'Post-Build Auto-Fix MCP-Plan',
  generated_at: new Date().toISOString(),
  source: basename(qaReportPath),
  post_id: postId || qaReport.post_id || null,
  dry_run: (args['dry-run'] as boolean),
  stats: {
    total_issues: issues.length,
    unique_calls: mcpCalls.length,
    by_category: countBy(issues as unknown as Array<Record<string, unknown>>, 'category'),
    by_ability: countBy(mcpCalls.map(c => ({ category: c.ability })) as unknown as Array<Record<string, unknown>>, 'category'),
  },
  mcp_calls: mcpCalls,
  agent_instruction:
    `Führe ${mcpCalls.length} MCP-Calls aus auto-fix-plan.json sequenziell aus.\n` +
    `Tool: novamira-yoursite-local:mcp-adapter-execute-ability\n` +
    (args['dry-run']
      ? `Alle contrast/alt-text/seo Calls sind DRY-RUN (keine Änderungen).\n`
        + `Prüfe die Ergebnisse und führe mit --apply-results erneut aus.\n`
      : `Contrast/alt-text Calls sind auf apply:true gesetzt (Änderungen werden geschrieben).\n`) +
    `\nErgebnisse als auto-fix-results.json speichern, dann:\n` +
    `  node scripts/post-build-auto-fix.js --apply-results auto-fix-results.json`,
};

// ─── OUTPUT ───────────────────────────────────────────────────────────────────

const output = JSON.stringify(plan, null, 2);

if (args.output) {
  writeFileSync(resolve(args.output as string), output, 'utf8');
  process.stderr.write(`[auto-fix] Saved to ${args.output}\n`);
} else {
  process.stdout.write(output + '\n');
}

// ─── HUMAN SUMMARY ────────────────────────────────────────────────────────────

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║  post-build-auto-fix.ts                              ║`);
console.log(`╚══════════════════════════════════════════════════════╝`);
console.log(`\n  📋 Source:        ${basename(qaReportPath)}`);
console.log(`  🎯 Post-ID:       ${postId || qaReport.post_id || '(nicht gesetzt)'}`);
console.log(`  🐛 Issues total:  ${issues.length}`);
console.log(`  🔧 MCP-Calls:     ${mcpCalls.length} (dedupliziert)`);

if (mcpCalls.length === 0) {
  console.log(`\n  ✅ Keine auto-fixbaren Issues gefunden.`);
  console.log(`  → QA-Report ist clean oder enthält nur manuell behebbare Issues.`);
} else {
  console.log(`\n  ─── Calls ──────────────────────────────────────────`);
  for (const call of mcpCalls) {
    const dryFlag = call.dry_run ? ' 🔍[DRY-RUN]' : '';
    const note = call.note ? `  (${call.note})` : '';
    console.log(`  ${call.ability.padEnd(46)}${dryFlag}${note}`);
  }

  console.log(`\n  ─── Nächster Schritt ───────────────────────────────`);
  console.log(`  Agent: Führe MCP-Calls aus auto-fix-plan.json aus`);
  if (args['dry-run']) {
    console.log(`  → ALLE Calls sind DRY-RUN — keine Änderungen.`);
    console.log(`  → Ergebnisse prüfen, dann ohne --dry-run wiederholen.`);
  }
}

console.log('');

process.exit(0);
