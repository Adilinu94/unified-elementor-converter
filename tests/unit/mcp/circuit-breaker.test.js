import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError, } from '../../../packages/mcp/src/circuit-breaker.ts';
describe('CircuitBreaker', () => {
    it('starts in CLOSED state', () => {
        const cb = new CircuitBreaker();
        expect(cb.getState()).toBe('CLOSED');
    });
    it('stays CLOSED on success', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 3 });
        const result = await cb.exec(async () => 'ok');
        expect(result).toBe('ok');
        expect(cb.getState()).toBe('CLOSED');
    });
    it('opens after failureThreshold consecutive failures', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 });
        const fail = async () => { throw new Error('fail'); };
        for (let i = 0; i < 3; i++) {
            await expect(cb.exec(fail)).rejects.toThrow('fail');
        }
        expect(cb.getState()).toBe('OPEN');
    });
    it('throws CircuitOpenError when OPEN', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        expect(cb.getState()).toBe('OPEN');
        await expect(cb.exec(async () => 'ok')).rejects.toThrow(CircuitOpenError);
    });
    it('transitions to HALF_OPEN after resetTimeout', async () => {
        vi.useFakeTimers();
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        expect(cb.getState()).toBe('OPEN');
        vi.advanceTimersByTime(5001);
        expect(cb.getState()).toBe('HALF_OPEN');
        vi.useRealTimers();
    });
    it('closes on success in HALF_OPEN', async () => {
        vi.useFakeTimers();
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        vi.advanceTimersByTime(1001);
        const result = await cb.exec(async () => 'recovered');
        expect(result).toBe('recovered');
        expect(cb.getState()).toBe('CLOSED');
        vi.useRealTimers();
    });
    it('re-opens on failure in HALF_OPEN', async () => {
        vi.useFakeTimers();
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        vi.advanceTimersByTime(1001);
        expect(cb.getState()).toBe('HALF_OPEN');
        await expect(cb.exec(async () => { throw new Error('still broken'); })).rejects.toThrow();
        expect(cb.getState()).toBe('OPEN');
        vi.useRealTimers();
    });
    it('resets failure count on success', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 3 });
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        expect(cb.getFailureCount()).toBe(2);
        await cb.exec(async () => 'ok');
        expect(cb.getFailureCount()).toBe(0);
        expect(cb.getState()).toBe('CLOSED');
    });
    it('manual reset works', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 999_999 });
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        expect(cb.getState()).toBe('OPEN');
        cb.reset();
        expect(cb.getState()).toBe('CLOSED');
        expect(cb.getFailureCount()).toBe(0);
    });
    it('onStateChange callback fires', async () => {
        const transitions = [];
        const cb = new CircuitBreaker({
            failureThreshold: 1,
            resetTimeoutMs: 60_000,
            onStateChange: (from, to) => transitions.push(`${from}->${to}`),
        });
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        expect(transitions).toContain('CLOSED->OPEN');
    });
    it('canExecute reflects state', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
        expect(cb.canExecute()).toBe(true);
        await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow();
        expect(cb.canExecute()).toBe(false);
    });
});
//# sourceMappingURL=circuit-breaker.test.js.map