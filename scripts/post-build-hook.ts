#!/usr/bin/env node
/**
 * post-build-hook.ts  —  Fix #13: Automatischer Post-Build Visual QA Hook
 *
 * Usage:
 *   node --import tsx scripts/post-build-hook.ts \
 *     --post-id 4943 \
 *     --framer-url https://my-site.framer.app/ \
 *     --elementor-url http://yoursite.local/?p=4943 \
 *     --output reports/build-quality.json
 *
 * Exit-Codes:
 *   0 = Build OK
 *   1 = Build FAIL
 *   2 = Konfigurationsfehler
 */

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface PixelDiffEntry {
  bp: string;
  diffPct: number;
}

interface ScreenshotDiff {
  status: string;
  diffs?: PixelDiffEntry[];
  max_diff_pct?: number | null;
  report?: string;
}

interface QaAuditResult {
  status: string;
  critical?: number;
  warnings?: number;
  report?: string;
  reason?: string;
}

interface BuildQualitySummary {
  pass: boolean;
  diff_pct: number | null;
  critical_issues: string[];
  warnings: string[];
  agent_verdict: string;
}

interface BuildQualityResult {
  meta: {
    post_id: string;
    timestamp: string;
    threshold: number;
    dry_run: boolean;
  };
  screenshot_diff: ScreenshotDiff | null;
  qa_audit: QaAuditResult | null;
  summary: BuildQualitySummary;
}

interface PixelDiffData {
  ok?: boolean;
  diffPct?: number;
}

interface CompareReport {
  pixelDiffs?: Record<string, PixelDiffData>;
}

interface QaIssueEntry {
  message?: string;
}

interface QaReportFile {
  critical?: QaIssueEntry[];
  warnings?: QaIssueEntry[];
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    'post-id':         { type: 'string' },
    'framer-url':      { type: 'string' },
    'elementor-url':   { type: 'string' },
    section:           { type: 'string', default: 'section' },
    output:            { type: 'string', default: 'reports/build-quality.json' },
    'diff-threshold':  { type: 'string', default: '10' },
    'skip-screenshot': { type: 'boolean', default: false },
    'qa-only':         { type: 'boolean', default: false },
    'dry-run':         { type: 'boolean', default: false },
    verbose:           { type: 'boolean', default: false },
    help:              { type: 'boolean', default: false },
  },
  strict: false,
});

const postIdRaw: string | undefined = args['post-id'] as string | undefined;
const framerUrl: string | undefined = args['framer-url'] as string | undefined;
const elementorUrl: string | undefined = args['elementor-url'] as string | undefined;
const sectionName: string = (args.section as string) || 'section';

if (args.help) {
  process.stdout.write(`
post-build-hook.ts — Automatischer Post-Build Visual QA Hook

Optionen:
  --post-id <id>          WordPress Post-ID (erforderlich)
  --framer-url <url>      Publizierte Framer-URL für Screenshot-Vergleich
  --elementor-url <url>   Lokale Elementor-Seiten-URL
  --section <name>        Section-Name (default: section)
  --output <pfad>         Ausgabe-JSON (default: reports/build-quality.json)
  --diff-threshold <n>    Pixel-Diff Schwellwert in % (default: 10)
  --skip-screenshot       Kein Screenshot-Diff, nur QA-Audits
  --qa-only               Alias für --skip-screenshot
  --dry-run               Simuliert den Run
  --verbose               Ausführliche Logs

Exit-Codes:
  0 = Build OK
  1 = Build FAIL
  2 = Konfigurationsfehler
`);
  process.exit(0);
}

if (!postIdRaw) {
  process.stderr.write('Fehler: --post-id erforderlich\n');
  process.exit(2);
}

const postId         = postIdRaw;
const diffThreshold  = parseFloat((args['diff-threshold'] as string) || '10');
const skipScreenshot = !!(args['skip-screenshot'] || args['qa-only']);
const outputPath     = resolve((args.output as string) || 'reports/build-quality.json');
const reportsDir     = dirname(outputPath);
const log = (...m: string[]) => { if (args.verbose) process.stderr.write('[post-build-hook] ' + m.join(' ') + '\n'); };
const info = (m: string) => process.stderr.write(`ℹ [post-build-hook] ${m}\n`);
const warn = (m: string) => process.stderr.write(`⚠ [post-build-hook] ${m}\n`);
const okFn   = (m: string) => process.stderr.write(`✓ [post-build-hook] ${m}\n`);

mkdirSync(reportsDir, { recursive: true });

// ─── Ergebnis-Objekt ─────────────────────────────────────────────────────────

const result: BuildQualityResult = {
  meta: {
    post_id:    postId,
    timestamp:  new Date().toISOString(),
    threshold:  diffThreshold,
    dry_run:    !!args['dry-run'],
  },
  screenshot_diff: null,
  qa_audit:        null,
  summary: {
    pass: false,
    diff_pct: null,
    critical_issues: [],
    warnings: [],
    agent_verdict: '',
  },
};

// ─── Schritt 1: Screenshot-Diff ──────────────────────────────────────────────

if (!skipScreenshot) {
  if (!framerUrl || !elementorUrl) {
    warn('--framer-url und --elementor-url für Screenshot-Diff erforderlich. Überspringe Screenshot-Diff.');
    warn('Mit --skip-screenshot starten wenn kein Browser verfügbar.');
    result.summary.warnings.push('Screenshot-Diff übersprungen: URLs fehlen');
  } else {
    const compareReportPath = join(reportsDir, 'section-compare', 'compare-report.json');
    const compareDir        = join(reportsDir, 'section-compare');

    info(`Screenshot-Diff: ${framerUrl} ↔ ${elementorUrl}`);

    if (!args['dry-run']) {
      const compareResult = spawnSync(
        process.execPath,
        [
          join(__dirname, 'section-compare.js'),
          '--framer-url',    framerUrl,
          '--elementor-url', elementorUrl,
          '--section',       sectionName,
          '--output',        compareDir,
          ...(args.verbose ? ['--verbose'] : []),
        ],
        { stdio: 'inherit' },
      );

      if (compareResult.status === 0 && existsSync(compareReportPath)) {
        const compareReport: CompareReport = JSON.parse(readFileSync(compareReportPath, 'utf8'));
        const pixelDiffs = compareReport.pixelDiffs || {};

        const diffs: PixelDiffEntry[] = Object.entries(pixelDiffs)
          .filter(([, d]) => d?.ok && typeof d.diffPct === 'number')
          .map(([bp, d]) => ({ bp, diffPct: d.diffPct! }));

        const maxDiff = diffs.length > 0
          ? Math.max(...diffs.map(d => d.diffPct))
          : null;

        result.screenshot_diff = {
          status:   compareResult.status === 0 ? 'ok' : 'error',
          diffs,
          max_diff_pct: maxDiff,
          report:   compareReportPath,
        };

        if (maxDiff !== null) {
          result.summary.diff_pct = maxDiff;
          if (maxDiff >= diffThreshold) {
            result.summary.critical_issues.push(
              `Screenshot-Diff ${maxDiff}% ≥ Schwellwert ${diffThreshold}% — visueller Fehler!`,
            );
            okFn(`Screenshot-Diff: ${maxDiff}% (ÜBER Schwellwert ${diffThreshold}%) ❌`);
          } else {
            okFn(`Screenshot-Diff: ${maxDiff}% < Schwellwert ${diffThreshold}% ✅`);
          }
        } else {
          warn('Kein Pixel-Diff verfügbar (pngjs/pixelmatch nicht installiert?)');
          result.summary.warnings.push('Pixel-Diff nicht verfügbar — pngjs/pixelmatch fehlt');
        }
      } else {
        warn('section-compare.js fehlgeschlagen oder Browser nicht verfügbar');
        result.summary.warnings.push('Screenshot-Diff fehlgeschlagen — kein Playwright/Puppeteer?');
      }
    } else {
      info('[dry-run] Screenshot-Diff würde laufen');
      result.screenshot_diff = { status: 'dry-run' };
    }
  }
} else {
  info('Screenshot-Diff übersprungen (--skip-screenshot / --qa-only)');
}

// ─── Schritt 2: QA-Audits via run-post-build-qa.js ──────────────────────────

info(`QA-Audits für Post-ID ${postId}`);

const qaResultsPath = join(reportsDir, 'qa-results.json');
const qaReportPath  = join(reportsDir, 'qa-report.json');

if (!args['dry-run'] && existsSync(qaResultsPath)) {
  info(`Verwende vorhandene QA-Ergebnisse: ${qaResultsPath}`);
  const qaResult = spawnSync(
    process.execPath,
    [
      join(__dirname, 'run-post-build-qa.js'),
      '--post-id',    postId,
      '--qa-results', qaResultsPath,
      '--output',     qaReportPath,
      ...(args.verbose ? ['--verbose'] : []),
    ],
    { stdio: 'inherit' },
  );

  if (existsSync(qaReportPath)) {
    const qaReport: QaReportFile = JSON.parse(readFileSync(qaReportPath, 'utf8'));
    const criticals = (qaReport.critical || []) as QaIssueEntry[];
    const qaWarnings  = (qaReport.warnings || []) as QaIssueEntry[];

    result.qa_audit = {
      status:     qaResult.status === 0 ? 'pass' : 'issues',
      critical:   criticals.length,
      warnings:   qaWarnings.length,
      report:     qaReportPath,
    };

    if (criticals.length > 0) {
      for (const c of criticals) {
        result.summary.critical_issues.push(`QA: ${c.message || JSON.stringify(c)}`);
      }
    }
    result.summary.warnings.push(...qaWarnings.map(w => `QA: ${w.message || JSON.stringify(w)}`));

    okFn(`QA-Audit: ${criticals.length} kritisch, ${qaWarnings.length} Warnungen`);
  }
} else if (!args['dry-run']) {
  warn(`Kein qa-results.json unter ${qaResultsPath} — QA-Audit übersprungen.`);
  warn(`Workflow: Agent ruft MCP-Abilities auf → speichert Ergebnisse als ${qaResultsPath} → hook erneut starten.`);
  result.qa_audit = { status: 'skipped', reason: 'qa-results.json nicht vorhanden' };
  result.summary.warnings.push('QA-Audit nicht gelaufen — qa-results.json fehlt');
} else {
  info('[dry-run] QA-Audit würde laufen');
  result.qa_audit = { status: 'dry-run' };
}

// ─── Schritt 3: Gesamturteil ─────────────────────────────────────────────────

const hasCriticals = result.summary.critical_issues.length > 0;
result.summary.pass = !hasCriticals;

if (result.summary.pass) {
  const diffInfo = result.summary.diff_pct !== null ? ` (Diff: ${result.summary.diff_pct}%)` : '';
  result.summary.agent_verdict = `✅ BUILD AKZEPTIERT${diffInfo} — Kein kritischer Fehler. Nächster Schritt: MCP-Export.`;
} else {
  result.summary.agent_verdict = `❌ BUILD ABGELEHNT — ${result.summary.critical_issues.length} kritische Fehler:\n` +
    result.summary.critical_issues.map(i => `  • ${i}`).join('\n');
}

// ─── Schritt 4: Ausgabe ──────────────────────────────────────────────────────

writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

process.stderr.write('\n' + '─'.repeat(60) + '\n');
process.stderr.write(result.summary.agent_verdict + '\n');
if (result.summary.warnings.length > 0) {
  process.stderr.write(`⚠  ${result.summary.warnings.length} Warnungen:\n`);
  result.summary.warnings.forEach(w => process.stderr.write(`   • ${w}\n`));
}
process.stderr.write(`📄 Build-Quality-Report: ${outputPath}\n`);
process.stderr.write('─'.repeat(60) + '\n');

process.exit(result.summary.pass ? 0 : 1);
