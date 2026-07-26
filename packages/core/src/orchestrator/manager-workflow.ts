/**
 * Phase 9 — Manager-Workflow (Per-Section Phase 1+2 Loop mit State-Reconciler).
 *
 * Orchestriert die per-Section-Pipeline:
 *   1. State-Snapshot (Phase 1: Pre-Flight + Site-Spec)
 *   2. Section-Verarbeitung (Phase 2: Section-Merger + Widget-Mapping)
 *   3. State-Reconciliation (Delta-Erkennung, Re-Trigger bei Drift)
 *
 * Bauplan §13: Manager-Workflow per Section mit max. 4 Iterations und
 * Drift-Detection (max 2 consecutive retries vor Re-Trigger).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SectionId = string;

export type SectionSpecState = {
  readonly specVersion: number;
  readonly hash: string;
  readonly updatedAt: number;
};

export type SectionSnapshot = {
  readonly sectionId: SectionId;
  readonly state: SectionSpecState;
  readonly dependencies: readonly SectionId[];
};

export type SectionProcessingResult = {
  readonly sectionId: SectionId;
  readonly ok: boolean;
  readonly newState?: SectionSpecState;
  readonly outputHash?: string;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
};

export type ManagerIterationResult = {
  readonly iteration: number;
  readonly results: readonly SectionProcessingResult[];
  readonly converged: boolean;
  readonly driftCount: number;
};

export type ManagerWorkflowOptions = {
  readonly maxIterations?: number;
  readonly maxConsecutiveDrifts?: number;
  readonly onIterationStart?: (iteration: number) => void;
  readonly onSectionProcessed?: (result: SectionProcessingResult) => void;
};

export type SectionProcessor = (
  snapshot: SectionSnapshot,
) => Promise<SectionProcessingResult> | SectionProcessingResult;

export const DEFAULT_MANAGER_WORKFLOW_OPTIONS = {
  maxIterations: 4,
  maxConsecutiveDrifts: 2,
} as const;

export const STATE_RECONCILER_KIND = {
  INITIAL: 'initial',
  FORWARD: 'forward',
  DRIFT: 'drift',
  RETRY: 'retry',
  CONVERGED: 'converged',
} as const;

export type StateReconcilerKind =
  (typeof STATE_RECONCILER_KIND)[keyof typeof STATE_RECONCILER_KIND];

export type StateReconcilerDecision = {
  readonly kind: StateReconcilerKind;
  readonly nextIteration: number;
  readonly reason: string;
  readonly driftedSections: readonly SectionId[];
};

export function reconcileState(
  previous: readonly SectionProcessingResult[],
  current: readonly SectionProcessingResult[],
  options: { iteration: number; maxIterations: number },
): StateReconcilerDecision {
  if (previous.length === 0) {
    return {
      kind: STATE_RECONCILER_KIND.INITIAL,
      nextIteration: options.iteration + 1,
      reason: 'initial-pass',
      driftedSections: [],
    };
  }

  const previousById = new Map(previous.map((r) => [r.sectionId, r]));
  const drifted: SectionId[] = [];

  for (const currentResult of current) {
    const prev = previousById.get(currentResult.sectionId);
    if (!prev) {
      continue;
    }
    const isHashChange =
      prev.newState && currentResult.newState
        ? prev.newState.hash !== currentResult.newState.hash
        : false;
    const hasNewError = currentResult.errors.length > prev.errors.length;
    const isOkChange = prev.ok !== currentResult.ok;

    if (isHashChange || hasNewError || isOkChange) {
      drifted.push(currentResult.sectionId);
    }
  }

  if (drifted.length === 0) {
    return {
      kind: STATE_RECONCILER_KIND.CONVERGED,
      nextIteration: options.iteration,
      reason: 'no-drift-detected',
      driftedSections: [],
    };
  }

  const isFinalIteration = options.iteration >= options.maxIterations;
  if (isFinalIteration) {
    return {
      kind: STATE_RECONCILER_KIND.CONVERGED,
      nextIteration: options.iteration,
      reason: 'max-iterations-reached',
      driftedSections: drifted,
    };
  }

  return {
    kind: STATE_RECONCILER_KIND.DRIFT,
    nextIteration: options.iteration + 1,
    reason: `${drifted.length}-section-drift`,
    driftedSections: drifted,
  };
}

export async function runManagerWorkflow(
  snapshots: readonly SectionSnapshot[],
  processor: SectionProcessor,
  options: ManagerWorkflowOptions = {},
): Promise<readonly ManagerIterationResult[]> {
  const maxIterations = options.maxIterations ?? DEFAULT_MANAGER_WORKFLOW_OPTIONS.maxIterations;
  const maxConsecutiveDrifts =
    options.maxConsecutiveDrifts ?? DEFAULT_MANAGER_WORKFLOW_OPTIONS.maxConsecutiveDrifts;

  const iterations: ManagerIterationResult[] = [];
  let previousResults: readonly SectionProcessingResult[] = [];
  let consecutiveDrifts = 0;

  for (let i = 0; i < maxIterations; i++) {
    options.onIterationStart?.(i);

    const currentResults: SectionProcessingResult[] = [];
    for (const snapshot of snapshots) {
      try {
        const result = await processor(snapshot);
        currentResults.push(result);
        options.onSectionProcessed?.(result);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[manager-workflow] section-processor-threw', {
          sectionId: snapshot.sectionId,
          error: errorMessage,
        });
        currentResults.push({
          sectionId: snapshot.sectionId,
          ok: false,
          warnings: [],
          errors: [errorMessage],
        });
      }
    }

    const isFirstIteration = previousResults.length === 0;
    const decision = reconcileState(previousResults, currentResults, {
      iteration: i,
      maxIterations,
    });

    const drifted = decision.driftedSections.length;
    const converged = isFirstIteration
      ? true
      : decision.kind === STATE_RECONCILER_KIND.CONVERGED;

    iterations.push({
      iteration: i,
      results: currentResults,
      converged,
      driftCount: isFirstIteration ? 0 : drifted,
    });

    if (converged) {
      break;
    }

    if (isFirstIteration) {
      previousResults = currentResults;
      continue;
    }

    if (drifted > 0) {
      consecutiveDrifts += 1;
      if (consecutiveDrifts > maxConsecutiveDrifts) {
        console.warn('[manager-workflow] bailing-out', {
          iteration: i,
          consecutiveDrifts,
          maxConsecutiveDrifts,
        });
        break;
      }
    } else {
      consecutiveDrifts = 0;
    }

    previousResults = currentResults;
  }

  return iterations;
}

export function flattenIterationResults(
  iterations: readonly ManagerIterationResult[],
): readonly SectionProcessingResult[] {
  if (iterations.length === 0) {
    return [];
  }
  return iterations[iterations.length - 1]!.results;
}

export function summarizeManagerWorkflow(
  iterations: readonly ManagerIterationResult[],
): {
  totalIterations: number;
  totalDrifts: number;
  converged: boolean;
  okCount: number;
  errorCount: number;
} {
  const totalDrifts = iterations.reduce((sum, it) => sum + it.driftCount, 0);
  const converged = iterations.length > 0 && iterations[iterations.length - 1]!.converged;
  const lastResults = flattenIterationResults(iterations);
  const okCount = lastResults.filter((r) => r.ok).length;
  const errorCount = lastResults.filter((r) => !r.ok).length;

  return {
    totalIterations: iterations.length,
    totalDrifts,
    converged,
    okCount,
    errorCount,
  };
}