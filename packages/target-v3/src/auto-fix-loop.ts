/**
 * Closed-loop CSS fixer for the retained V3 build orchestrator.
 *
 * The current QA package deliberately exposes pure probe evaluation rather than
 * a browser/network runner. A runner is therefore injected by callers; when it
 * is absent this module returns an explicit skipped result instead of inventing
 * a score or making an unverified network call.
 */

import type { GeometryProbeReport, ProbeExpectation, ProbeResult, StyleDiff } from '@elconv/qa';

export type ProbeCheck = ProbeExpectation;

export interface ProbeRunner {
  (url: string, checks: ProbeCheck[], waitMs: number): Promise<GeometryProbeReport[]>;
}

export interface WpcodeUpdatePort {
  update(title: string, code: string, pageId?: number): Promise<void>;
}

export interface AutoFixOptions {
  probe: { url: string; checks: ProbeCheck[] };
  wpcode: WpcodeUpdatePort;
  cssSnippetTitle: string;
  pageId: number;
  maxRounds?: number;
  threshold?: number;
  waitMs?: number;
  probeRunner?: ProbeRunner;
}

export interface FixRound {
  round: number;
  passPctBefore: number;
  fixesApplied: number;
  passPctAfter: number;
  cssAdded: string[];
  remainingFailures: Array<{ label: string; selector: string; diffs: string[] }>;
}

export interface AutoFixResult {
  rounds: FixRound[];
  finalPassPct: number;
  reachedThreshold: boolean;
  totalFixesApplied: number;
  finalCss: string;
  /** Last browser reports observed by the loop, for downstream reporting. */
  finalReports?: GeometryProbeReport[];
  skipped?: boolean;
  skipReason?: string;
}

export async function runAutoFixLoop(opts: AutoFixOptions): Promise<AutoFixResult> {
  if (!opts.probeRunner) {
    return {
      rounds: [],
      finalPassPct: 0,
      reachedThreshold: false,
      totalFixesApplied: 0,
      finalCss: '',
      finalReports: [],
      skipped: true,
      skipReason: 'No probe runner was injected; geometry QA remains a separate browser step.',
    };
  }

  const maxRounds = opts.maxRounds ?? 3;
  const threshold = opts.threshold ?? 90;
  const rounds: FixRound[] = [];
  let currentCss = '';
  let totalFixes = 0;
  let finalReports: GeometryProbeReport[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const reports = await opts.probeRunner(opts.probe.url, opts.probe.checks, opts.waitMs ?? 2500);
    finalReports = reports;
    const report = reports[0];
    if (!report) break;

    const passBefore = report.score;
    const fixes = generateFixes(report.results, opts.pageId);
    if (fixes.length === 0 && round > 1) {
      rounds.push({
        round,
        passPctBefore: passBefore,
        fixesApplied: 0,
        passPctAfter: passBefore,
        cssAdded: [],
        remainingFailures: collectFailures(report.results),
      });
      break;
    }

    currentCss = mergeCss(currentCss, fixes);
    if (fixes.length > 0) {
      await opts.wpcode.update(opts.cssSnippetTitle, currentCss, opts.pageId);
      totalFixes += fixes.length;
    }

    const afterReports = await opts.probeRunner(opts.probe.url, opts.probe.checks, opts.waitMs ?? 2500);
    finalReports = afterReports;
    const after = afterReports[0];
    const passAfter = after?.score ?? passBefore;
    rounds.push({
      round,
      passPctBefore: passBefore,
      fixesApplied: fixes.length,
      passPctAfter: passAfter,
      cssAdded: fixes,
      remainingFailures: collectFailures(after?.results ?? []),
    });

    if (passAfter >= threshold) {
      return { rounds, finalPassPct: passAfter, reachedThreshold: true, totalFixesApplied: totalFixes, finalCss: currentCss, finalReports };
    }
  }

  const finalPassPct = rounds.at(-1)?.passPctAfter ?? 0;
  return {
    rounds,
    finalPassPct,
    reachedThreshold: finalPassPct >= threshold,
    totalFixesApplied: totalFixes,
    finalCss: currentCss,
    finalReports,
  };
}

function generateFixes(results: ProbeResult[], pageId: number): string[] {
  const guard = `body.page-id-${pageId} `;
  const fixes: string[] = [];
  for (const result of results) {
    if (result.match) continue;
    for (const diff of result.diffs) {
      fixes.push(`${guard}${result.selector} { ${camelToKebab(diff.property)}: ${diff.expected} !important; }`);
    }
  }
  return dedupe(fixes);
}

function collectFailures(results: ProbeResult[]): Array<{ label: string; selector: string; diffs: string[] }> {
  return results
    .filter((result) => !result.match)
    .map((result) => ({
      label: result.label,
      selector: result.selector,
      diffs: result.diffs.map(formatDiff),
    }));
}

function formatDiff(diff: StyleDiff): string {
  return `${diff.property}: ${diff.actual} (exp ${diff.expected})`;
}

function mergeCss(existing: string, additions: string[]): string {
  return dedupe([...(existing ? existing.split('\n') : []), ...additions]).join('\n');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function camelToKebab(value: string): string {
  return value.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export function formatAutoFixResult(result: AutoFixResult): string {
  if (result.skipped) return `Auto-Fix Loop: skipped — ${result.skipReason}`;
  const lines = [`Auto-Fix Loop: ${result.rounds.length} rounds, ${result.totalFixesApplied} fixes, final ${result.finalPassPct}% ${result.reachedThreshold ? '(threshold reached)' : '(threshold NOT reached)'}`, ''];
  for (const round of result.rounds) {
    lines.push(`Round ${round.round}: ${round.passPctBefore}% → ${round.passPctAfter}% (${round.fixesApplied} fixes)`);
    for (const css of round.cssAdded.slice(0, 5)) lines.push(`  + ${css.slice(0, 100)}`);
    if (round.remainingFailures.length) {
      lines.push('  remaining failures:');
      for (const failure of round.remainingFailures.slice(0, 5)) lines.push(`    ${failure.label}: ${failure.diffs.join('; ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
