export type PhaseId = 'preflight' | 'extraction' | 'classification' | 'build' | 'deploy' | 'qa';

export interface StageContext {
  readonly url: string;
  readonly target: 'v3' | 'v4';
  readonly stageId: PhaseId;
  readonly attempt: number;
  readonly previousAttempts: readonly string[];
}

export interface StageResult<TOutput = unknown> {
  readonly stageId: PhaseId;
  readonly ok: boolean;
  readonly output?: TOutput;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly durationMs: number;
  readonly skipped?: boolean;
}

export type StageHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: StageContext,
) => Promise<StageResult<TOutput>> | StageResult<TOutput>;

export interface PipelineOptions {
  maxRetries?: number;
  onStageStart?: (context: StageContext) => void;
  onStageComplete?: (result: StageResult) => void;
  onError?: (stageId: PhaseId, error: string) => void;
}
