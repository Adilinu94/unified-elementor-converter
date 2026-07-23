/**
 * Phase-Pipeline — Orchestrates stages with retry and graceful degradation.
 */
import type { PhaseId, StageContext, StageResult, StageHandler, PipelineOptions } from './types.js';

const DEFAULT_MAX_RETRIES = 3;

export async function runStage<TInput, TOutput>(
  handler: StageHandler<TInput, TOutput>,
  input: TInput,
  context: Omit<StageContext, 'attempt' | 'previousAttempts'>,
  options: { maxRetries?: number } = {},
): Promise<StageResult<TOutput>> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const previousAttempts: string[] = [];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const stageStart = Date.now();
    try {
      const result = await handler(input, {
        ...context,
        attempt,
        previousAttempts: [...previousAttempts],
      });
      return { ...result, durationMs: Date.now() - stageStart };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      previousAttempts.push(errorMsg);
      if (attempt > maxRetries) {
        return {
          stageId: context.stageId,
          ok: false,
          warnings: [],
          errors: previousAttempts,
          durationMs: Date.now() - stageStart,
        };
      }
    }
  }

  return { stageId: context.stageId, ok: false, warnings: [], errors: ['unexpected'], durationMs: 0 };
}

export interface PipelineStage<TInput = unknown, TOutput = unknown> {
  id: PhaseId;
  handler: StageHandler<TInput, TOutput>;
  optional?: boolean;
}

export async function runPipeline<TInput>(
  stages: PipelineStage[],
  input: TInput,
  url: string,
  target: 'v3' | 'v4',
  options: PipelineOptions = {},
): Promise<{ results: StageResult[]; passed: boolean }> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const results: StageResult[] = [];
  let currentInput: unknown = input;

  for (const stage of stages) {
    const context = { url, target, stageId: stage.id };
    options.onStageStart?.({ ...context, attempt: 1, previousAttempts: [] });

    const result = await runStage(stage.handler, currentInput, context, { maxRetries });

    options.onStageComplete?.(result);

    if (!result.ok) {
      if (stage.optional) {
        results.push({ ...result, skipped: true });
        continue;
      }
      options.onError?.(stage.id, result.errors[0] ?? 'Stage failed');
      results.push(result);
      return { results, passed: false };
    }

    results.push(result);
    if (result.output !== undefined) currentInput = result.output;
  }

  return { results, passed: true };
}
