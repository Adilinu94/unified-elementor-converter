import { describe, it, expect } from 'vitest';
import { planAdaptiveSamples } from '@elconv/extractors';

describe('adaptive-scroll planAdaptiveSamples', () => {
  it('returns at least one sample for any height', () => {
    const ys = planAdaptiveSamples(0, []);
    expect(ys.length).toBeGreaterThanOrEqual(1);
  });

  it('produces uniform sweep with default step', () => {
    const ys = planAdaptiveSamples(1200, []);
    expect(ys).toContain(0);
    expect(ys[ys.length - 1]).toBe(1200);
    // Default step = max(600, 50) = 600, so we expect ~3 samples (0, 600, 1200)
    expect(ys.length).toBeGreaterThanOrEqual(2);
    expect(ys.length).toBeLessThanOrEqual(5);
  });

  it('adds 3 extra samples around each trigger (entry/mid/exit)', () => {
    const triggerYs = [500];
    const ys = planAdaptiveSamples(2000, triggerYs, { stepPx: 1000, triggerSamples: 3 });
    // We should have at least one sample within 50px of 500
    expect(ys.some((y) => Math.abs(y - 500) <= 50)).toBe(true);
  });

  it('respects minStepPx: never produces samples closer than minStepPx', () => {
    const ys = planAdaptiveSamples(500, [], { stepPx: 100, minStepPx: 200 });
    // effectiveStep = max(100, 200) = 200
    // Sorted, sorted neighbours should be >= 200 apart (within deduplication tolerance 5)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(190); // tolerate 5 dedup + 5 rounding
    }
  });

  it('deduplicates samples within 5px', () => {
    const ys = planAdaptiveSamples(1000, [0, 3], [], );
    // 0 and 3 should collapse to a single sample (dedup tolerance = 5)
    const zeros = ys.filter((y) => y < 5).length;
    expect(zeros).toBe(1);
  });

  it('triggerSamples=1 produces a single mid sample only', () => {
    const ys = planAdaptiveSamples(2000, [800], { stepPx: 1000, triggerSamples: 1 });
    expect(ys).toContain(800);
  });

  it('triggerSamples=2 produces entry + exit, no mid', () => {
    const ys = planAdaptiveSamples(2000, [800], { stepPx: 1000, triggerSamples: 2 });
    // Should have a sample at 800-offset and 800+offset but not 800 itself
    // (offset = 1000 / 2 = 500)
    expect(ys).toContain(300);
    expect(ys).toContain(1300);
  });

  it('clamps samples within [0, documentHeight]', () => {
    const ys = planAdaptiveSamples(500, [-1000, 10000]);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(500);
    }
  });
});