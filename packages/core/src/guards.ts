/**
 * Generic guard system — used by both V3 and V4 targets.
 * Each target defines its own guards; this file provides the runner.
 */

export type GuardSeverity = 'critical' | 'warning' | 'info';

export interface GuardResult {
  readonly passed: boolean;
  readonly message: string;
  readonly details?: string;
}

export interface Guard<T> {
  readonly name: string;
  readonly severity: GuardSeverity;
  check(tree: T): GuardResult;
}

export interface GuardReportEntry {
  readonly name: string;
  readonly severity: GuardSeverity;
  readonly result: GuardResult;
}

export interface GuardReport {
  /** 0–100 score after applying penalties. */
  readonly score: number;
  /** true when score >= threshold AND no critical failures. */
  readonly passed: boolean;
  /** Score threshold used (default 85). */
  readonly threshold: number;
  readonly results: readonly GuardReportEntry[];
}

const SCORE_PENALTY: Record<GuardSeverity, number> = {
  critical: 20,
  warning: 5,
  info: 0,
};

/**
 * Run a suite of guards against a tree.
 * Score starts at 100; each failed guard subtracts its penalty.
 * passed = score >= threshold AND no critical guard failed.
 */
export function runGuards<T>(
  tree: T,
  guards: ReadonlyArray<Guard<T>>,
  threshold = 85,
): GuardReport {
  let score = 100;
  const results: GuardReportEntry[] = [];
  let hasCriticalFailure = false;

  for (const guard of guards) {
    const result = guard.check(tree);
    results.push({ name: guard.name, severity: guard.severity, result });
    if (!result.passed) {
      score = Math.max(0, score - SCORE_PENALTY[guard.severity]);
      if (guard.severity === 'critical') hasCriticalFailure = true;
    }
  }

  return {
    score,
    passed: score >= threshold && !hasCriticalFailure,
    threshold,
    results,
  };
}

/**
 * Format a GuardReport as human-readable CLI output.
 */
export function formatGuardReport(report: GuardReport): string {
  const status = report.passed ? '✅ PASSED' : '❌ FAILED';
  const lines: string[] = [
    `Guard Score: ${report.score}/100 — ${status} (threshold: ${report.threshold})`,
  ];

  for (const entry of report.results) {
    const icon = entry.result.passed ? '✓' : entry.severity === 'critical' ? '✗' : '⚠';
    const line = `  ${icon} [${entry.name}] ${entry.result.message}`;
    lines.push(entry.result.details ? `${line}\n    ↳ ${entry.result.details}` : line);
  }

  return lines.join('\n');
}
