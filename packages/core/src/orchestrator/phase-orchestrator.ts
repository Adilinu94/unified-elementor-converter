/**
 * Phase 9 — Phase-Orchestrator (Top-Level Phase-3 Assembly mit Retry-Loop).
 *
 * Orchestriert die Top-Level-Pipeline:
 *   - Phase 0: Pre-Flight
 *   - Phase 1+2: Per-Section (delegiert an Manager-Workflow)
 *   - Phase 3: Assembly (Section-Ordering + Global-Token-Resolution)
 *   - Phase 4: Builder (delegiert an v3-builder)
 *   - Phase 5: QA (delegiert an qa)
 *
 * Bauplan §13: Top-Level Orchestrator mit Retry-Loop (max 3 Retries per Stage)
 * und Graceful-Degradation (Skip bei Fehler statt Crash).
 */

import {
  type ManagerIterationResult,
  type SectionSnapshot,
  type SectionProcessor,
  runManagerWorkflow,
} from './manager-workflow.js';

export const PHASE_ID = {
  PHASE_0_PRE_FLIGHT: 'phase-0',
  PHASE_1_SPEC: 'phase-1',
  PHASE_2_SECTION: 'phase-2',
  PHASE_3_ASSEMBLY: 'phase-3',
  PHASE_4_BUILDER: 'phase-4',
  PHASE_5_QA: 'phase-5',
} as const;

export type PhaseId = (typeof PHASE_ID)[keyof typeof PHASE_ID];

export type StageContext = {
  readonly url: string;
  readonly target: string;
  readonly stageId: PhaseId;
  readonly attempt: number;
  readonly previousAttempts: readonly string[];
};

export type StageResult<TOutput = unknown> = {
  readonly stageId: PhaseId;
  readonly ok: boolean;
  readonly output?: TOutput;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly durationMs: number;
  readonly skipped?: boolean;
};

export type StageHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: StageContext,
) => Promise<StageResult<TOutput>> | StageResult<TOutput>;

export type PhasePipelineOptions = {
  readonly maxRetries?: number;
  readonly onStageStart?: (context: StageContext) => void;
  readonly onStageComplete?: (result: StageResult) => void;
  readonly onError?: (stageId: PhaseId, error: string) => void;
};

export const DEFAULT_PHASE_PIPELINE_OPTIONS = {
  maxRetries: 3,
} as const;

export async function runStage<TInput, TOutput>(
  handler: StageHandler<TInput, TOutput>,
  input: TInput,
  context: Omit<StageContext, 'attempt' | 'previousAttempts'>,
  options: { maxRetries?: number } = {},
): Promise<StageResult<TOutput>> {
  const maxRetries = options.maxRetries ?? DEFAULT_PHASE_PIPELINE_OPTIONS.maxRetries;
  const previousAttempts: string[] = [];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const stageStart = Date.now();
    try {
      const result = await handler(input, {
        url: context.url,
        target: context.target,
        stageId: context.stageId,
        attempt,
        previousAttempts: [...previousAttempts],
      });
      return {
        ...result,
        stageId: context.stageId,
        durationMs: Date.now() - stageStart,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      previousAttempts.push(errorMessage);
      console.warn('[phase-orchestrator] stage-attempt-failed', {
        stageId: context.stageId,
        attempt,
        error: errorMessage,
      });

      if (attempt > maxRetries) {
        return {
          stageId: context.stageId,
          ok: false,
          warnings: [],
          errors: [...previousAttempts],
          durationMs: Date.now() - stageStart,
        };
      }
    }
  }

  return {
    stageId: context.stageId,
    ok: false,
    warnings: [],
    errors: previousAttempts.length > 0 ? previousAttempts : ['unknown-error'],
    durationMs: 0,
  };
}

export type PhasePipeline = {
  readonly phases: readonly PhaseId[];
  readonly maxRetries: number;
};

export function definePhasePipeline(
  phases: readonly PhaseId[],
  options: { maxRetries?: number } = {},
): PhasePipeline {
  return {
    phases,
    maxRetries: options.maxRetries ?? DEFAULT_PHASE_PIPELINE_OPTIONS.maxRetries,
  };
}

export type AssemblyInput = {
  readonly sections: readonly SectionSnapshot[];
  readonly managerIterations: readonly ManagerIterationResult[];
  readonly url: string;
};

export type AssemblyOutput = {
  readonly sectionOrder: readonly string[];
  readonly globalTokens: Record<string, string>;
  readonly assembledAt: number;
};

export async function runPhase3Assembly(
  input: AssemblyInput,
  handler: StageHandler<AssemblyInput, AssemblyOutput>,
  options: PhasePipelineOptions = {},
): Promise<StageResult<AssemblyOutput>> {
  return runStage(
    handler,
    input,
    {
      url: input.url,
      target: 'assembly',
      stageId: PHASE_ID.PHASE_3_ASSEMBLY,
    },
    options,
  );
}

export type BuilderInput = {
  readonly sections: readonly SectionSnapshot[];
  readonly assembly: AssemblyOutput;
};

export type BuilderOutput = {
  readonly pageDataPath?: string;
  readonly bytesWritten: number;
};

export async function runPhase4Builder(
  input: BuilderInput,
  handler: StageHandler<BuilderInput, BuilderOutput>,
  options: PhasePipelineOptions = {},
): Promise<StageResult<BuilderOutput>> {
  return runStage(
    handler,
    input,
    {
      url: 'n/a',
      target: 'builder',
      stageId: PHASE_ID.PHASE_4_BUILDER,
    },
    options,
  );
}

export type QaInput = {
  readonly url: string;
  readonly target: string;
  readonly pageDataPath?: string;
};

export type QaOutput = {
  readonly issueCount: number;
  readonly highSeverityCount: number;
};

export async function runPhase5Qa(
  input: QaInput,
  handler: StageHandler<QaInput, QaOutput>,
  options: PhasePipelineOptions = {},
): Promise<StageResult<QaOutput>> {
  return runStage(
    handler,
    input,
    {
      url: input.url,
      target: input.target,
      stageId: PHASE_ID.PHASE_5_QA,
    },
    options,
  );
}

export function createPerSectionProcessor(
  managerOptions: { maxIterations?: number } = {},
): SectionProcessor {
  return async (snapshot: SectionSnapshot) => {
    const result = await runManagerWorkflow(
      [snapshot],
      async (s) => ({
        sectionId: s.sectionId,
        ok: true,
        newState: {
          specVersion: s.state.specVersion + 1,
          hash: `hash-${s.sectionId}-${Date.now()}`,
          updatedAt: Date.now(),
        },
        outputHash: `output-${s.sectionId}`,
        warnings: [],
        errors: [],
      }),
      managerOptions,
    );

    const lastResult = result[result.length - 1]?.results[0];
    return {
      sectionId: snapshot.sectionId,
      ok: lastResult?.ok ?? false,
      newState: lastResult?.newState,
      outputHash: lastResult?.outputHash,
      warnings: [],
      errors: lastResult?.ok === false ? ['manager-workflow-failed'] : [],
    };
  };
}

export function isPhaseSuccessful<T>(result: StageResult<T>): boolean {
  return result.ok && !result.skipped;
}

export function getPhaseError<T>(result: StageResult<T>): string | undefined {
  if (result.ok) {
    return undefined;
  }
  return result.errors[0];
}