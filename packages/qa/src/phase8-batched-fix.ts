/**
 * Phase 8: Batched Auto-Fix Scheduler.
 *
 * Per Plan §11.3 (corrected 2026-06-17):
 * - V1 fixes only 1 issue per round → O(n) rounds, slow convergence.
 * - Phase 8 batches all issues of the SAME type into one fix call.
 * - Max 4 distinct types per round (prevent thrashing when too many detectors fire).
 * - Iterates up to maxRounds times until target reached or no progress.
 *
 * Output: BatchedFixReport with per-round batch-stats and convergence info.
 */

import type { Issue, IssueType } from './issue-detector.js';
import type { Strictness, StrictnessProfile } from './strictness.js';
import {
  getIssueTypeHint,
  type ExtendedIssueType,
  type IssueTypeHint,
} from './phase8-issue-types.js';

/**
 * A single batch of issues sharing the same type, processed atomically.
 */
export interface IssueBatch {
  type: ExtendedIssueType;
  hint: IssueTypeHint;
  issues: Issue[];
}

/**
 * Result of applying a single batch-fix.
 */
export interface BatchFixResult {
  batch: IssueBatch;
  ok: boolean;
  message: string;
  durationMs: number;
  fixedIssueCount: number;
  remainingIssueCount: number;
}

/**
 * Per-round summary (Phase 8: up to 4 types per round).
 */
export interface BatchedRoundResult {
  round: number;
  batches: BatchFixResult[];
  issuesBefore: number;
  issuesAfter: number;
  typesCovered: ExtendedIssueType[];
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * Full batched-fix report.
 */
export interface BatchedFixReport {
  strictness: Strictness;
  maxRounds: number;
  maxTypesPerRound: number;
  totalRounds: number;
  converged: boolean;
  initialIssueCount: number;
  finalIssueCount: number;
  rounds: BatchedRoundResult[];
  outstandingIssues: Issue[];
  generatedAt: string;
  startedAt: string;
}

/**
 * Fixer function signature for batched-fix.
 * Receives the entire batch (all issues of one type) and applies the fix.
 * Returns ok=true if at least one issue was fixed; false if batch-fix failed entirely.
 */
export type BatchedFixer = (batch: IssueBatch, round: number) => Promise<{
  ok: boolean;
  message: string;
  fixedIssueIds: string[];
}>;

export interface BatchedFixOptions {
  initialIssues: readonly Issue[];
  strictness: Strictness;
  /** @deprecated kept for future per-profile thresholds; not used in Phase 8 default gate. */
  profile?: StrictnessProfile;
  fixers: Partial<Record<ExtendedIssueType, BatchedFixer>>;
  maxRounds?: number;
  maxTypesPerRound?: number;
  detectAfterRound?: (previousIssues: readonly Issue[]) => Promise<Issue[]>;
  onRoundComplete?: (round: BatchedRoundResult, report: BatchedFixReport) => Promise<void> | void;
  issueKey?: (issue: Issue) => string;
  now?: () => Date;
}

const DEFAULT_MAX_ROUNDS = 4;
const DEFAULT_MAX_TYPES_PER_ROUND = 4;
const DEFAULT_ISSUE_KEY = (issue: Issue): string =>
  `${issue.type}:${issue.region.x}:${issue.region.y}:${issue.region.width}:${issue.region.height}`;
const DEFAULT_NOW = (): Date => new Date();

/**
 * Group issues into batches keyed by type.
 * Filters out issue-types with no available fixer (they stay in outstanding list).
 */
export function batchIssuesByType(
  issues: readonly Issue[],
  fixers: Partial<Record<ExtendedIssueType, BatchedFixer>>,
): IssueBatch[] {
  const groups = new Map<ExtendedIssueType, Issue[]>();
  for (const issue of issues) {
    const type = issue.type as ExtendedIssueType;
    const fixer = fixers[type];
    if (!fixer) continue; // skip types without fixer; they remain outstanding
    const list = groups.get(type) ?? [];
    list.push(issue);
    groups.set(type, list);
  }
  const batches: IssueBatch[] = [];
  for (const [type, list] of groups) {
    const hint = getIssueTypeHint(type);
    if (!hint) continue;
    batches.push({ type, hint, issues: list });
  }
  // Sort by severity (high first) then by count desc (biggest impact first)
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  batches.sort((a, b) => {
    const sa = severityOrder[a.hint.defaultSeverity] ?? 3;
    const sb = severityOrder[b.hint.defaultSeverity] ?? 3;
    if (sa !== sb) return sa - sb;
    return b.issues.length - a.issues.length;
  });
  return batches;
}

/**
 * Pick the batches to process this round.
 * Max 4 types per round (Plan §11.3).
 */
export function pickBatchesForRound(
  batches: readonly IssueBatch[],
  maxTypesPerRound: number,
): IssueBatch[] {
  return batches.slice(0, Math.max(0, maxTypesPerRound));
}

/**
 * Check if profile target was reached (per Plan §10 strictness profiles).
 */
export function hasReachedTarget(
  issues: readonly Issue[],
  _profile?: StrictnessProfile,
): boolean {
  // Target = no high-severity issues remain (Phase 8 default gate)
  const highSeverityCount = issues.filter((i) => i.severity === 'high').length;
  return highSeverityCount === 0;
}

/**
 * Main entry: run batched-fix loop until target reached or maxRounds exhausted.
 */
export async function runBatchedFix(options: BatchedFixOptions): Promise<BatchedFixReport> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxTypesPerRound = options.maxTypesPerRound ?? DEFAULT_MAX_TYPES_PER_ROUND;
  const now = options.now ?? DEFAULT_NOW;
  const issueKey = options.issueKey ?? DEFAULT_ISSUE_KEY;

  const startedAt = now().toISOString();
  const initialIssues = [...options.initialIssues];
  const rounds: BatchedRoundResult[] = [];
  let currentIssues: Issue[] = [...initialIssues];
  let converged = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    const roundStart = now();
    const batches = batchIssuesByType(currentIssues, options.fixers);
    const selectedBatches = pickBatchesForRound(batches, maxTypesPerRound);

    if (selectedBatches.length === 0) {
      // No fixable issues remaining
      converged = hasReachedTarget(currentIssues, options.profile);
      break;
    }

    const batchResults: BatchFixResult[] = [];
    const allFixedKeys = new Set<string>();

    for (const batch of selectedBatches) {
      const batchStart = now();
      const fixer = options.fixers[batch.type];
      if (!fixer) continue;

      let result: { ok: boolean; message: string; fixedIssueIds: string[] };
      try {
        result = await fixer(batch, round);
      } catch (err) {
        result = {
          ok: false,
          message: `Fixer threw: ${(err as Error).message ?? String(err)}`,
          fixedIssueIds: [],
        };
      }

      const batchEnd = now();
      for (const id of result.fixedIssueIds) {
        allFixedKeys.add(id);
      }
      batchResults.push({
        batch,
        ok: result.ok,
        message: result.message,
        durationMs: batchEnd.getTime() - batchStart.getTime(),
        fixedIssueCount: result.fixedIssueIds.length,
        remainingIssueCount: batch.issues.length - result.fixedIssueIds.length,
      });
    }

    // Compute new issue list (re-detect if handler provided, otherwise drop fixed)
    let nextIssues: Issue[];
    if (options.detectAfterRound) {
      nextIssues = await options.detectAfterRound(currentIssues);
    } else {
      const fixedKeys = new Set<string>();
      for (const result of batchResults) {
        for (const issue of result.batch.issues) {
          if (allFixedKeys.has(issueKey(issue))) {
            fixedKeys.add(issueKey(issue));
          }
        }
      }
      nextIssues = currentIssues.filter((issue) => !fixedKeys.has(issueKey(issue)));
    }

    const roundEnd = now();
    const roundResult: BatchedRoundResult = {
      round,
      batches: batchResults,
      issuesBefore: currentIssues.length,
      issuesAfter: nextIssues.length,
      typesCovered: selectedBatches.map((b) => b.type),
      durationMs: roundEnd.getTime() - roundStart.getTime(),
      startedAt: roundStart.toISOString(),
      finishedAt: roundEnd.toISOString(),
    };
    rounds.push(roundResult);
    currentIssues = nextIssues;

    if (options.onRoundComplete) {
      await options.onRoundComplete(roundResult, {
        strictness: options.strictness,
        maxRounds,
        maxTypesPerRound,
        totalRounds: round,
        converged: false,
        initialIssueCount: initialIssues.length,
        finalIssueCount: currentIssues.length,
        rounds,
        outstandingIssues: currentIssues,
        generatedAt: now().toISOString(),
        startedAt,
      });
    }

    if (hasReachedTarget(currentIssues, options.profile)) {
      converged = true;
      break;
    }

    if (currentIssues.length === 0) break;
  }

  return {
    strictness: options.strictness,
    maxRounds,
    maxTypesPerRound,
    totalRounds: rounds.length,
    converged,
    initialIssueCount: initialIssues.length,
    finalIssueCount: currentIssues.length,
    rounds,
    outstandingIssues: currentIssues,
    generatedAt: now().toISOString(),
    startedAt,
  };
}

/**
 * Helper: count batched-fix stats by type across all rounds.
 */
export function countBatchedFixByType(
  report: BatchedFixReport,
): Map<ExtendedIssueType, { roundsProcessed: number; totalFixed: number; totalRemaining: number }> {
  const counts = new Map<ExtendedIssueType, { roundsProcessed: number; totalFixed: number; totalRemaining: number }>();
  for (const round of report.rounds) {
    for (const result of round.batches) {
      const entry = counts.get(result.batch.type) ?? { roundsProcessed: 0, totalFixed: 0, totalRemaining: 0 };
      entry.roundsProcessed += 1;
      entry.totalFixed += result.fixedIssueCount;
      entry.totalRemaining += result.remainingIssueCount;
      counts.set(result.batch.type, entry);
    }
  }
  return counts;
}

/**
 * Helper: build Issue[] from a Phase 8 detector output (preserves V1 Issue interface).
 */
export function issueTypeKeysPresent(issues: readonly Issue[]): Set<IssueType> {
  return new Set(issues.map((i) => i.type));
}