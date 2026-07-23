import { describe, it, expect } from 'vitest';
import { runStage, runPipeline } from '@elconv/core';
describe('runStage', () => {
    it('returns ok result on success', async () => {
        const handler = async (input) => ({
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
        const handler = async () => {
            calls++;
            if (calls < 3)
                throw new Error(`fail ${calls}`);
            return { stageId: 'build', ok: true, warnings: [], errors: [], durationMs: 0 };
        };
        const result = await runStage(handler, null, { url: 'http://x', target: 'v3', stageId: 'build' }, { maxRetries: 3 });
        expect(result.ok).toBe(true);
        expect(calls).toBe(3);
    });
    it('fails after max retries', async () => {
        const handler = async () => {
            throw new Error('always fails');
        };
        const result = await runStage(handler, null, { url: 'http://x', target: 'v3', stageId: 'qa' }, { maxRetries: 1 });
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBe(2);
    });
});
describe('runPipeline', () => {
    it('runs stages sequentially', async () => {
        const order = [];
        const stages = [
            {
                id: 'preflight',
                handler: async () => {
                    order.push('a');
                    return {
                        stageId: 'preflight',
                        ok: true,
                        warnings: [],
                        errors: [],
                        durationMs: 0,
                    };
                },
            },
            {
                id: 'build',
                handler: async () => {
                    order.push('b');
                    return { stageId: 'build', ok: true, warnings: [], errors: [], durationMs: 0 };
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
                id: 'qa',
                handler: async () => {
                    throw new Error('qa fail');
                },
                optional: true,
            },
            {
                id: 'build',
                handler: async () => ({
                    stageId: 'build',
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
                id: 'extraction',
                handler: async () => {
                    throw new Error('fatal');
                },
            },
            {
                id: 'build',
                handler: async () => ({
                    stageId: 'build',
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
//# sourceMappingURL=orchestrator.test.js.map