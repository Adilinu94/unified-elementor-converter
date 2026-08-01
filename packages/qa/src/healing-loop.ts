/**
 * Self-Healing Loop — Vision-QA-driven iteration orchestration.
 * Capture → Diff → Fix → Re-Capture → Verify (max N rounds).
 */
import type { VisualDiffResult, FixAction, FixPriorityQueue } from './types.js';
import { inferFixType } from './auto-fix.js';
import {
  createPriorityQueue,
  getNextBatch,
  markFixApplied,
  markFixVerified,
} from './auto-fix.js';
import { createMockDiffResult } from './visual-diff.js';

export interface HealingIterationResult {
  iteration: number;
  scoreBefore: number;
  scoreAfter: number;
  issuesFound: number;
  fixesApplied: number;
  fixesSucceeded: number;
  /** IDs explicitly verified by the fix port after re-measurement. */
  verifiedFixIds?: string[];
  /** Issues retained for diagnosis but intentionally not sent to a fixer. */
  unfixableIssues?: Array<{
    regionId: string;
    semanticRole: string;
    reason: string;
  }>;
  startedAt: string;
  finishedAt: string;
}

export interface HealingLoopReport {
  totalIterations: number;
  initialScore: number;
  finalScore: number;
  targetScore: number;
  targetReached: boolean;
  iterations: HealingIterationResult[];
  generatedAt: string;
  startedAt: string;
}

export type CaptureFn = (url: string, outputPath: string) => Promise<string>;
export type DiffFn = (referencePath: string, clonePath: string) => Promise<VisualDiffResult>;
export type FixFn = (fixes: FixAction[]) => Promise<{
  applied: number;
  succeeded: number;
  succeededIds?: string[];
}>;

export interface HealingLoopOptions {
  referencePath: string;
  clonePath: string;
  cloneUrl?: string;
  outputDir: string;
  targetScore?: number;
  maxIterations?: number;
  maxFixesPerRound?: number;
  captureFn?: CaptureFn;
  diffFn?: DiffFn;
  fixFn?: FixFn;
  onIterationComplete?: (result: HealingIterationResult) => void | Promise<void>;
}

export async function runHealingLoop(options: HealingLoopOptions): Promise<HealingLoopReport> {
  const targetScore = options.targetScore ?? 90;
  const maxIterations = options.maxIterations ?? 3;
  const startedAt = new Date().toISOString();
  const iterations: HealingIterationResult[] = [];

  const initialDiff = options.diffFn
    ? await options.diffFn(options.referencePath, options.clonePath)
    : createMockDiffResult({ width: 1440, height: 900, label: 'desktop' }, 15);

  let currentScore = initialDiff.score;
  let currentDiff = initialDiff;
  const initialScore = currentScore;

  if (currentScore >= targetScore) {
    return {
      totalIterations: 0,
      initialScore,
      finalScore: currentScore,
      targetScore,
      targetReached: true,
      iterations,
      generatedAt: new Date().toISOString(),
      startedAt,
    };
  }

  for (let i = 1; i <= maxIterations; i++) {
    const iterStart = new Date().toISOString();
    const scoreBefore = currentScore;

    const unfixableIssues = currentDiff.regions
      .filter((region) => region.unfixable)
      .map((region) => ({
        regionId: region.id,
        semanticRole: region.semanticRole,
        reason: region.unfixableReason ?? 'No safe fixer is registered for this issue type.',
      }));
    const fixes: FixAction[] = currentDiff.regions
      .filter((region) => !region.unfixable)
      .map((region, idx) => ({
        id: `heal_${i}_${idx}`,
        regionId: region.id,
        region,
        type: region.fixType ?? inferFixType(region),
        priority: region.severity === 'critical' ? 10 : 5,
        description: region.description ?? `Fix ${region.semanticRole}`,
        applied: false,
        verified: false,
      }));

    const queue: FixPriorityQueue = createPriorityQueue(fixes, options.maxFixesPerRound ?? 3);
    const batch = getNextBatch(queue);

    let fixesApplied = 0;
    let fixesSucceeded = 0;
    let verifiedFixIds: string[] = [];
    if (options.fixFn && batch.length > 0) {
      const result = await options.fixFn(batch);
      fixesApplied = Math.min(Math.max(result.applied, 0), batch.length);
      const succeededIds = result.succeededIds;
      const batchIds = new Set(batch.map((fix) => fix.id));
      verifiedFixIds = succeededIds
        ? succeededIds.filter((id) => batchIds.has(id))
        : batch.slice(0, Math.min(result.succeeded, batch.length)).map((fix) => fix.id);
      fixesSucceeded = verifiedFixIds.length;
      for (const fix of batch) {
        const succeeded = verifiedFixIds.includes(fix.id);
        if (succeeded) {
          markFixApplied(queue, fix.id);
          markFixVerified(queue, fix.id);
        }
      }
    }

    if (options.captureFn && options.cloneUrl && options.diffFn) {
      const newClonePath = `${options.outputDir}/clone-iter-${i}.png`;
      await options.captureFn(options.cloneUrl, newClonePath);
      currentDiff = await options.diffFn(options.referencePath, newClonePath);
      currentScore = currentDiff.score;
    } else {
      // Compatibility fallback for callers that inject only a static diff
      // function (the historical pure-unit contract). Live healing always
      // takes the capture + diff branch above.
      const improvement = fixesSucceeded * 5;
      currentScore = Math.min(100, scoreBefore + improvement);
    }

    const iterResult: HealingIterationResult = {
      iteration: i,
      scoreBefore,
      scoreAfter: currentScore,
      // Count the pre-fix diagnostic set; a successful re-capture may have no
      // remaining regions, but the iteration must still explain what it saw.
      issuesFound: fixes.length + unfixableIssues.length,
      fixesApplied,
      fixesSucceeded,
      verifiedFixIds,
      unfixableIssues,
      startedAt: iterStart,
      finishedAt: new Date().toISOString(),
    };
    iterations.push(iterResult);

    if (options.onIterationComplete) {
      await options.onIterationComplete(iterResult);
    }

    if (currentScore >= targetScore) break;
  }

  return {
    totalIterations: iterations.length,
    initialScore,
    finalScore: currentScore,
    targetScore,
    targetReached: currentScore >= targetScore,
    iterations,
    generatedAt: new Date().toISOString(),
    startedAt,
  };
}
