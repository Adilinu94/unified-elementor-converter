/**
 * Auto Fix Loop (#10)
 *
 * Closed repair loop: geometry probe → for each diff, generate a CSS fix →
 * update the WPCode header snippet → re-probe → until pass rate >= threshold
 * or max rounds. Reduces the 5 manual fix rounds (Oral-Care build) to one
 * script call.
 *
 * The fixer trusts the `expected` values from the probe checks and emits
 * `selector { property: expected !important; }` rules. It merges new fixes
 * with the existing CSS in the snippet (so manual rules are preserved).
 *
 * @example
 * import { runAutoFixLoop } from './auto-fix-loop.js';
 * const result = await runAutoFixLoop({
 *   probe: { url, checks },
 *   wpcode: wpcodeHelper,
 *   cssSnippetTitle: 'Oral Care Header CSS',
 *   pageId: 4956,
 *   maxRounds: 3,
 * });
 */

import { runGeometryProbe, type GeometryProbeReport, type ProbeCheck, type ProbeResult } from '../qa/geometry-probe.js';
import type { WpcodeHelper } from './wpcode-helper.js';

export interface AutoFixOptions {
  /** Probe config: url + checks (selectors + expected styles). */
  probe: { url: string; checks: ProbeCheck[]; viewports?: GeometryProbeReport['viewport'][] extends never ? never : any };
  /** WPCode helper (for updating the CSS snippet). */
  wpcode: WpcodeHelper;
  /** Title of the CSS snippet to update (must be tracked by the helper). */
  cssSnippetTitle: string;
  /** Page id for body.page-id-N guard. */
  pageId: number;
  /** Max fix rounds. Default 3. */
  maxRounds?: number;
  /** Target pass rate %. Stop when reached. Default 90. */
  threshold?: number;
  /** Wait after load for probes (ms). Default 2500. */
  waitMs?: number;
}

export interface FixRound {
  round: number;
  passPctBefore: number;
  fixesApplied: number;
  passPctAfter: number;
  /** CSS rules added this round. */
  cssAdded: string[];
  /** Remaining failures. */
  remainingFailures: Array<{ label: string; selector: string; diffs: string[] }>;
}

export interface AutoFixResult {
  rounds: FixRound[];
  finalPassPct: number;
  reachedThreshold: boolean;
  totalFixesApplied: number;
  /** Final CSS in the snippet after all rounds. */
  finalCss: string;
}

/**
 * Run the auto-fix loop. Each round:
 *  1. Probe the live URL
 *  2. For each failed check, emit CSS fixes
 *  3. Merge with existing snippet CSS + update WPCode
 *  4. Re-probe next round
 */
export async function runAutoFixLoop(opts: AutoFixOptions): Promise<AutoFixResult> {
  const maxRounds = opts.maxRounds ?? 3;
  const threshold = opts.threshold ?? 90;
  const rounds: FixRound[] = [];
  let currentCss = '';
  let totalFixes = 0;

  for (let round = 1; round <= maxRounds; round++) {
    // 1. Probe
    const reports = await runGeometryProbe({
      url: opts.probe.url,
      checks: opts.probe.checks,
      waitMs: opts.waitMs ?? 2500,
    });
    const desktop = reports[0];
    if (!desktop) break;
    const passBefore = desktop.pass_pct;

    // 2. Generate fixes for failures
    const fixes = generateFixes(desktop.results, opts.pageId);
    if (fixes.length === 0 && round > 1) {
      // No new fixes possible — stop
      rounds.push({
        round,
        passPctBefore: passBefore,
        fixesApplied: 0,
        passPctAfter: passBefore,
        cssAdded: [],
        remainingFailures: collectFailures(desktop.results),
      });
      break;
    }

    // 3. Merge + update WPCode
    currentCss = mergeCss(currentCss, fixes);
    await opts.wpcode.update(opts.cssSnippetTitle, currentCss, opts.pageId);
    totalFixes += fixes.length;

    // 4. Re-probe to measure improvement
    const reReports = await runGeometryProbe({
      url: opts.probe.url,
      checks: opts.probe.checks,
      waitMs: opts.waitMs ?? 2500,
    });
    const reDesktop = reReports[0];
    const passAfter = reDesktop?.pass_pct ?? passBefore;

    rounds.push({
      round,
      passPctBefore: passBefore,
      fixesApplied: fixes.length,
      passPctAfter: passAfter,
      cssAdded: fixes,
      remainingFailures: collectFailures(reDesktop?.results ?? []),
    });

    if (passAfter >= threshold) {
      return {
        rounds,
        finalPassPct: passAfter,
        reachedThreshold: true,
        totalFixesApplied: totalFixes,
        finalCss: currentCss,
      };
    }
  }

  return {
    rounds,
    finalPassPct: rounds[rounds.length - 1]?.passPctAfter ?? 0,
    reachedThreshold: (rounds[rounds.length - 1]?.passPctAfter ?? 0) >= threshold,
    totalFixesApplied: totalFixes,
    finalCss: currentCss,
  };
}

/**
 * Generate CSS fix rules from failed probe results.
 * Maps camelCase CSS properties back to kebab-case.
 */
function generateFixes(results: ProbeResult[], pageId: number): string[] {
  const fixes: string[] = [];
  const guard = `body.page-id-${pageId} `;
  for (const r of results) {
    if (!r.found || r.matches) continue;
    for (const d of r.diff) {
      const prop = camelToKebab(d.property);
      // Skip properties that CSS !important can't fix reliably (e.g. layout-only)
      if (SKIP_PROPS.has(d.property)) continue;
      const expected = d.expected;
      fixes.push(`${guard}${r.selector} { ${prop}: ${expected} !important; }`);
    }
    if (r.boxDiff) {
      for (const b of r.boxDiff) {
        if (b.dimension === 'width') {
          fixes.push(`${guard}${r.selector} { width: ${b.expected}px !important; }`);
        } else if (b.dimension === 'height') {
          fixes.push(`${guard}${r.selector} { height: ${b.expected}px !important; }`);
        }
      }
    }
  }
  return dedupe(fixes);
}

const SKIP_PROPS = new Set<string>([]);

function collectFailures(results: ProbeResult[]): Array<{ label: string; selector: string; diffs: string[] }> {
  const out: Array<{ label: string; selector: string; diffs: string[] }> = [];
  for (const r of results) {
    if (r.found && !r.matches) {
      out.push({
        label: r.label,
        selector: r.selector,
        diffs: r.diff.map((d) => `${d.property}: ${d.actual} (exp ${d.expected})`),
      });
    }
  }
  return out;
}

function mergeCss(existing: string, additions: string[]): string {
  const all = [...(existing ? existing.split('\n') : []), ...additions];
  return dedupe(all).join('\n');
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

function camelToKebab(s: string): string {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** Format an AutoFixResult as a human-readable report. */
export function formatAutoFixResult(r: AutoFixResult): string {
  const lines = [
    `Auto-Fix Loop: ${r.rounds.length} rounds, ${r.totalFixesApplied} fixes, final ${r.finalPassPct}% ${r.reachedThreshold ? '(threshold reached)' : '(threshold NOT reached)'}`,
    '',
  ];
  for (const round of r.rounds) {
    lines.push(`Round ${round.round}: ${round.passPctBefore}% → ${round.passPctAfter}% (${round.fixesApplied} fixes)`);
    for (const css of round.cssAdded.slice(0, 5)) {
      lines.push(`  + ${css.slice(0, 100)}`);
    }
    if (round.remainingFailures.length) {
      lines.push(`  remaining failures:`);
      for (const f of round.remainingFailures.slice(0, 5)) {
        lines.push(`    ${f.label}: ${f.diffs.join('; ')}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
