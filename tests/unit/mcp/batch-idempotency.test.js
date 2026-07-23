import { describe, it, expect } from 'vitest';
import { BatchScheduler, Idempotency } from '@elconv/mcp';
describe('BatchScheduler', () => {
    it('executes tasks with priority', async () => {
        const scheduler = new BatchScheduler({ concurrency: 2 });
        const order = [];
        await scheduler.scheduleAll([
            {
                fn: async () => {
                    order.push(3);
                    return 3;
                },
                options: { priority: 3 },
            },
            {
                fn: async () => {
                    order.push(1);
                    return 1;
                },
                options: { priority: 1 },
            },
            {
                fn: async () => {
                    order.push(2);
                    return 2;
                },
                options: { priority: 2 },
            },
        ]);
        expect(order[0]).toBe(1);
    });
    it('reports status', () => {
        const scheduler = new BatchScheduler({ name: 'test' });
        expect(scheduler.status.name).toBe('test');
        expect(scheduler.status.queued).toBe(0);
    });
    it('retries failed tasks', async () => {
        const scheduler = new BatchScheduler({ maxRetries: 2, baseDelayMs: 10 });
        let attempts = 0;
        const result = await scheduler.schedule(async () => {
            attempts++;
            if (attempts < 3)
                throw new Error('fail');
            return 'ok';
        });
        expect(result).toBe('ok');
        expect(attempts).toBe(3);
    });
});
describe('Idempotency', () => {
    it('caches identical calls', async () => {
        const idem = new Idempotency();
        let calls = 0;
        const fn = async () => {
            calls++;
            return 'result';
        };
        const r1 = await idem.call(fn, 'test', { a: 1 });
        const r2 = await idem.call(fn, 'test', { a: 1 });
        expect(r1).toBe('result');
        expect(r2).toBe('result');
        expect(calls).toBe(1);
    });
    it('does not cache different params', async () => {
        const idem = new Idempotency();
        let calls = 0;
        const fn = async () => {
            calls++;
            return calls;
        };
        await idem.call(fn, 'test', { a: 1 });
        await idem.call(fn, 'test', { a: 2 });
        expect(calls).toBe(2);
    });
    it('clear resets cache', async () => {
        const idem = new Idempotency();
        await idem.call(async () => 'x', 'm', {});
        expect(idem.size).toBe(1);
        idem.clear();
        expect(idem.size).toBe(0);
    });
});
//# sourceMappingURL=batch-idempotency.test.js.map