import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the Playwright-backed capture to fail so captureAndDiff exercises its
// honest "cannot score" path (returns null) instead of launching a real
// browser inside the test runner. vi.mock is hoisted above the imports below.
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => {
      throw new Error('no browser in test env');
    }),
  },
}));

// Static imports keep the (heavy @elconv/qa) transform in the collect phase
// rather than inside a per-test 5s timeout window.
import { blendVisualScore, runQaPipeline, cmdQa } from '../../../packages/cli/src/cmd-qa.js';

describe('blendVisualScore', () => {
  it('returns 100 when both metrics are a perfect match', () => {
    expect(blendVisualScore(100, 100)).toBe(100);
  });

  it('returns 0 when both metrics are a total mismatch', () => {
    expect(blendVisualScore(0, 0)).toBe(0);
  });

  it('weights SSIM at 0.6 and pixelmatch at 0.4', () => {
    // 0.6*90 (ssim) + 0.4*80 (pixel) = 54 + 32 = 86
    expect(blendVisualScore(80, 90)).toBe(86);
  });

  it('clamps out-of-range inputs into 0..100', () => {
    expect(blendVisualScore(200, 200)).toBe(100);
    expect(blendVisualScore(-50, -50)).toBe(0);
  });
});

describe('runQaPipeline — honest scoring, no fabricated numbers', () => {
  it('does not score when no reference URL is supplied', async () => {
    const report = await runQaPipeline({ url: 'https://example.com', maxIterations: 0 });

    expect(report.viewports).toHaveLength(3);
    expect(report.viewports.every((v) => v.score === null)).toBe(true);
    expect(report.overallScore).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.issues.some((i) => i.description.includes('No --ref-url'))).toBe(true);
    // Healing must not run without a reference to heal toward.
    expect(report.healingApplied).toBe(false);
  });

  it('reports unscored (not a fabricated pass) when capture fails', async () => {
    const report = await runQaPipeline({
      url: 'https://example.com',
      refUrl: 'https://ref.example.com',
      maxIterations: 0,
      outputDir: './qa-output-test',
    });

    // Playwright is mocked to throw → every viewport must be unscored, and the
    // overall run must NOT pass (the old code returned a hardcoded 92/88).
    expect(report.viewports.every((v) => v.score === null)).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.overallScore).toBe(0);
  });
});

describe('cmdQa — CLI entry', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('returns exit code 2 when --url is missing', async () => {
    const code = await cmdQa({});
    expect(code).toBe(2);
  });

  it('returns a failing exit code for a capture-only run (no reference)', async () => {
    const code = await cmdQa({ url: 'https://example.com', 'max-iterations': '0' });
    expect(code).toBe(1);
  });
});
