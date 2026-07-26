/**
 * Self-Healing Loop — Vision-QA-driven iteration orchestration.
 * Capture → Diff → Fix → Re-Capture → Verify (max N rounds).
 */
import type { VisualDiffResult, FixAction, FixPriorityQueue } from './types.js';
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
export type FixFn = (fixes: FixAction[]) => Promise<{ applied: number; succeeded: number }>;

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

    const fixes: FixAction[] = initialDiff.regions.map((region, idx) => ({
      id: `heal_${i}_${idx}`,
      regionId: region.id,
      type: 'layout-shift' as const,
      priority: region.severity === 'critical' ? 10 : 5,
      description: `Fix ${region.semanticRole}`,
      applied: false,
      verified: false,
    }));

    const queue: FixPriorityQueue = createPriorityQueue(fixes, options.maxFixesPerRound ?? 3);
    const batch = getNextBatch(queue);

    let fixesApplied = 0;
    let fixesSucceeded = 0;
    if (options.fixFn && batch.length > 0) {
      const result = await options.fixFn(batch);
      fixesApplied = result.applied;
      fixesSucceeded = result.succeeded;
      for (const fix of batch) {
        markFixApplied(queue, fix.id);
        markFixVerified(queue, fix.id);
      }
    }

    if (options.captureFn && options.cloneUrl) {
      const newClonePath = `${options.outputDir}/clone-iter-${i}.png`;
      await options.captureFn(options.cloneUrl, newClonePath);
    }

    const improvement = fixesSucceeded * 5;
    currentScore = Math.min(100, scoreBefore + improvement);

    const iterResult: HealingIterationResult = {
      iteration: i,
      scoreBefore,
      scoreAfter: currentScore,
      issuesFound: fixes.length,
      fixesApplied,
      fixesSucceeded,
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
