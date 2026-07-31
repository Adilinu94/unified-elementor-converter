import { describe, it, expect } from 'vitest';
import { ProgressTracker, formatDuration, renderProgress } from '@elconv/core';

describe('formatDuration', () => {
  it('formats sub-second, seconds and minutes', () => {
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(187_000)).toBe('3m07s');
  });

  it('clamps negatives to 0ms', () => {
    expect(formatDuration(-5)).toBe('0ms');
  });
});

describe('renderProgress', () => {
  it('shows an em-dash ETA before the first step', () => {
    const line = renderProgress({ completed: 0, total: 4, percent: 0, elapsedMs: 0, etaMs: null });
    expect(line).toContain('[0/4]');
    expect(line).toContain('ETA —');
  });

  it('shows an approximate ETA and label when present', () => {
    const line = renderProgress({ completed: 1, total: 4, percent: 25, elapsedMs: 100, etaMs: 300, label: 'build' });
    expect(line).toContain('~300ms');
    expect(line).toContain('• build');
  });
});

describe('ProgressTracker', () => {
  it('reports null ETA and 0% before any step', () => {
    const t = new ProgressTracker({ total: 4, now: () => 0 });
    const s = t.snapshot();
    expect(s.completed).toBe(0);
    expect(s.percent).toBe(0);
    expect(s.etaMs).toBeNull();
  });

  it('estimates ETA from the average step duration', () => {
    let clock = 0;
    const t = new ProgressTracker({ total: 4, now: () => clock });
    t.start(); // t=0
    clock = 100; // first step took 100ms
    const s = t.advance('step1');
    expect(s.completed).toBe(1);
    expect(s.percent).toBe(25);
    expect(s.elapsedMs).toBe(100);
    expect(s.etaMs).toBe(300); // (100/1) * (4-1)
  });

  it('reports 100% and 0 ETA once complete and never advances past total', () => {
    let clock = 0;
    const t = new ProgressTracker({ total: 2, now: () => clock });
    t.start();
    clock = 50;
    t.advance();
    clock = 100;
    const s = t.advance();
    expect(s.completed).toBe(2);
    expect(s.percent).toBe(100);
    expect(s.etaMs).toBe(0);

    const beyond = t.advance();
    expect(beyond.completed).toBe(2);
    expect(t.isDone).toBe(true);
  });

  it('emits a rendered line to the sink on each advance', () => {
    const lines: string[] = [];
    let clock = 0;
    const t = new ProgressTracker({ total: 2, now: () => clock, sink: (l) => lines.push(l) });
    t.start();
    clock = 10;
    t.advance('extract');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[1/2]');
    expect(lines[0]).toContain('extract');
  });

  it('starts implicitly on the first advance (elapsed measured from that moment)', () => {
    let clock = 25;
    const t = new ProgressTracker({ total: 2, now: () => clock });
    // No explicit start(): the first advance() anchors the start time at 25.
    t.advance();
    clock = 65; // 40ms later
    const s = t.advance();
    expect(s.completed).toBe(2);
    expect(s.elapsedMs).toBe(40);
    expect(s.etaMs).toBe(0);
  });
});
