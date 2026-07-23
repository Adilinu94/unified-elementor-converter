import { describe, it, expect } from 'vitest';
import { runStage, runPipeline, type StageHandler } from '@elconv/core';

describe('runStage', () => {
  it('returns ok result on success', async () => {
    const handler: StageHandler<string, number> = async (input) => ({
      stageId: 'extraction',
      ok: true,
      output: input.length,
      warnings: [],
      errors: [],
      durationMs: 0,
    });
    const result = await runStage(handler, 'hello', {
      url: 'http://x',
      target: 'v3',
      stageId: 'extraction',
    });
    expect(result.ok).toBe(true);
    expect(result.output).toBe(5);
  });

  it('retries on failure', async () => {
    let calls = 0;
    const handler: StageHandler = async () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return { stageId: 'build', ok: true, warnings: [], errors: [], durationMs: 0 };
    };
    const result = await runStage(
      handler,
      null,
      { url: 'http://x', target: 'v3', stageId: 'build' },
      { maxRetries: 3 },
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('fails after max retries', async () => {
    const handler: StageHandler = async () => {
      throw new Error('always fails');
    };
    const result = await runStage(
      handler,
      null,
      { url: 'http://x', target: 'v3', stageId: 'qa' },
      { maxRetries: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(2);
  });
});

describe('runPipeline', () => {
  it('runs stages sequentially', async () => {
    const order: string[] = [];
    const stages = [
      {
        id: 'preflight' as const,
        handler: async () => {
          order.push('a');
          return {
            stageId: 'preflight' as const,
            ok: true,
            warnings: [],
            errors: [],
            durationMs: 0,
          };
        },
      },
      {
        id: 'build' as const,
        handler: async () => {
          order.push('b');
          return { stageId: 'build' as const, ok: true, warnings: [], errors: [], durationMs: 0 };
        },
      },
    ];
    const { passed } = await runPipeline(stages, null, 'http://x', 'v3');
    expect(passed).toBe(true);
    expect(order).toEqual(['a', 'b']);
  });

  it('skips optional stages on failure', async () => {
    const stages = [
      {
        id: 'qa' as const,
        handler: async () => {
          throw new Error('qa fail');
        },
        optional: true,
      },
      {
        id: 'build' as const,
        handler: async () => ({
          stageId: 'build' as const,
          ok: true,
          warnings: [],
          errors: [],
          durationMs: 0,
        }),
      },
    ];
    const { results, passed } = await runPipeline(stages, null, 'http://x', 'v3');
    expect(passed).toBe(true);
    expect(results[0].skipped).toBe(true);
  });

  it('stops on required stage failure', async () => {
    const stages = [
      {
        id: 'extraction' as const,
        handler: async () => {
          throw new Error('fatal');
        },
      },
      {
        id: 'build' as const,
        handler: async () => ({
          stageId: 'build' as const,
          ok: true,
          warnings: [],
          errors: [],
          durationMs: 0,
        }),
      },
    ];
    const { passed } = await runPipeline(stages, null, 'http://x', 'v3', { maxRetries: 0 });
    expect(passed).toBe(false);
  });
});
