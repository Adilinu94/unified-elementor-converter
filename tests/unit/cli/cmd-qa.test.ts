import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the Playwright-backed capture to fail so captureAndDiff exercises its
// honest "cannot score" path (returns null) instead of launching a real
// browser inside the test runner. vi.mock is hoisted above the imports below.
//
// All three engines must be stubbed, not just chromium: cmd-qa now resolves its
// viewports through @elconv/extractors, whose barrel loads
// playwright-extractor.ts, and that module destructures
// `{ chromium, firefox, webkit }` at import time. A mock missing an export
// fails the whole suite at collection with "No 'firefox' export is defined".
//
// The failing launch is built INSIDE the factory: vi.mock is hoisted above every
// import, so a top-level const would be read before initialisation.
vi.mock('playwright', () => {
  const launch = vi.fn(async () => {
    throw new Error('no browser in test env');
  });
  return {
    chromium: { launch },
    firefox: { launch },
    webkit: { launch },
  };
});

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

describe('runQaPipeline — viewports come from the reference, not a repo default', () => {
  /** The verbatim payload from the live reference; band boundary is 810px. */
  const REAL_PAYLOAD =
    '[{"hash":"72rtr7","mediaQuery":"(min-width: 1200px)"},'
    + '{"hash":"5umvoy","mediaQuery":"(min-width: 810px) and (max-width: 1199.98px)"},'
    + '{"hash":"5a698","mediaQuery":"(max-width: 809.98px)"}]';
  const framerHtml =
    `<html><head><script id="__framer__breakpoints">${REAL_PAYLOAD}</script></head><body></body></html>`;

  it('captures at the reference\'s own widths instead of 1440/768/390', async () => {
    const report = await runQaPipeline({
      url: 'https://target.example',
      refUrl: 'https://loud-alternative-352151.framer.app/',
      maxIterations: 0,
      fetchHtml: async () => framerHtml,
    });

    expect(report.viewportSource).toBe('source-breakpoints');
    expect(report.viewports.map((v) => v.width)).toEqual([1200, 810, 390]);
    // 768px sits on the phone side of this source's 810px boundary — scoring
    // there compared the reference's phone variant to a desktop layout.
    expect(report.viewports.map((v) => v.width)).not.toContain(768);
  });

  it('surfaces the viewport-resolution warnings as report issues', async () => {
    const report = await runQaPipeline({
      url: 'https://target.example',
      refUrl: 'https://not-framer.example',
      maxIterations: 0,
      fetchHtml: async () => '<html><body>plain</body></html>',
    });

    expect(report.viewportSource).toBe('fallback');
    // A fallback that looked like a measurement is the failure mode here.
    expect(report.issues.some((i) => i.region === 'viewports')).toBe(true);
  });

  it('honours explicit widths over the reference', async () => {
    const report = await runQaPipeline({
      url: 'https://target.example',
      refUrl: 'https://loud-alternative-352151.framer.app/',
      viewports: [1600, 900],
      maxIterations: 0,
      fetchHtml: async () => framerHtml,
    });

    expect(report.viewportSource).toBe('caller');
    expect(report.viewports.map((v) => v.width)).toEqual([1600, 900]);
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

  it('rejects a malformed --viewports with a usage exit code, not a silent skip', async () => {
    const code = await cmdQa({
      url: 'https://example.com',
      viewports: '1200,81O',
      'max-iterations': '0',
    });
    expect(code).toBe(2);
  });
});
