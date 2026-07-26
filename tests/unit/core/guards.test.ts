import { describe, it, expect } from 'vitest';
import {
  runGuards,
  formatGuardReport,
  type Guard,
} from '../../../packages/core/src/guards.ts';

const alwaysPass: Guard<unknown[]> = {
  name: 'always-pass',
  severity: 'critical',
  check: () => ({ passed: true, message: 'ok' }),
};

const alwaysFail: Guard<unknown[]> = {
  name: 'always-fail',
  severity: 'critical',
  check: () => ({ passed: false, message: 'broken' }),
};

const warnFail: Guard<unknown[]> = {
  name: 'warn-fail',
  severity: 'warning',
  check: () => ({ passed: false, message: 'minor issue' }),
};

const infoFail: Guard<unknown[]> = {
  name: 'info-fail',
  severity: 'info',
  check: () => ({ passed: false, message: 'fyi' }),
};

describe('runGuards', () => {
  it('all pass → score 100, passed true', () => {
    const report = runGuards([], [alwaysPass]);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
  });

  it('critical fail → score 80, passed false', () => {
    const report = runGuards([], [alwaysFail]);
    expect(report.score).toBe(80);
    expect(report.passed).toBe(false);
  });

  it('warning fail → score 95, passed true (above 85)', () => {
    const report = runGuards([], [warnFail]);
    expect(report.score).toBe(95);
    expect(report.passed).toBe(true);
  });

  it('info fail → score 100, no penalty', () => {
    const report = runGuards([], [infoFail]);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
  });

  it('multiple warnings can drop below threshold', () => {
    const guards = [warnFail, warnFail, warnFail, warnFail];
    const report = runGuards([], guards);
    expect(report.score).toBe(80);
    expect(report.passed).toBe(false);
  });

  it('critical fail blocks even with high score', () => {
    // 1 critical fail = 80 score, below 85 threshold
    const report = runGuards([], [alwaysFail], 75);
    expect(report.score).toBe(80);
    // Score above threshold but critical failure → still fails
    expect(report.passed).toBe(false);
  });

  it('custom threshold works', () => {
    const report = runGuards([], [warnFail, warnFail], 95);
    expect(report.score).toBe(90);
    expect(report.passed).toBe(false); // 90 < 95
  });

  it('score never goes below 0', () => {
    const manyCritical = Array.from({ length: 10 }, () => alwaysFail);
    const report = runGuards([], manyCritical);
    expect(report.score).toBe(0);
  });

  it('formatGuardReport contains score and status', () => {
    const report = runGuards([], [alwaysFail]);
    const text = formatGuardReport(report);
    expect(text).toContain('80/100');
    expect(text).toContain('FAILED');
  });

  it('formatGuardReport shows PASSED for clean run', () => {
    const report = runGuards([], [alwaysPass]);
    const text = formatGuardReport(report);
    expect(text).toContain('100/100');
    expect(text).toContain('PASSED');
  });
});
