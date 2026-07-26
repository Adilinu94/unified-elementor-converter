/**
 * Phase 8: renderAndCapture with Timeout, Retry, and Mock-Fallback.
 *
 * Per Plan §11.3 (corrected 2026-06-17):
 * - V1's renderAndCapture blocks the entire fix-loop when WP is unreachable.
 * - Phase 8 wraps captureScreenshot in:
 *   1. Per-call timeout (default 60s)
 *   2. Up to 2 retries with exponential backoff
 *   3. Mock-Fallback (synthetic solid-color PNG) on WP-down so the loop
 *      can continue producing a partial report instead of hanging.
 *
 * Config schema matches Manager-Workflow Phase 9 expectations:
 *   renderTimeoutMs: number;       // default 60_000
 *   renderRetries: number;         // default 2
 *   renderBackoffMs: number;       // default 500
 *   renderFallback: 'mock' | 'skip'; // default 'mock'
 */

import { captureScreenshot, type CaptureResult } from './visual-capture.js';

/**
 * Phase 8 render-config (consumed by Manager-Workflow Phase 9).
 */
export interface Phase8RenderConfig {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  fallback: 'mock' | 'skip';
}

export const DEFAULT_PHASE8_RENDER_CONFIG: Phase8RenderConfig = {
  timeoutMs: 60_000,
  retries: 2,
  backoffMs: 500,
  fallback: 'mock',
};

/**
 * Result of a single renderAndCapture call (Phase 8).
 */
export interface Phase8RenderResult {
  capture: CaptureResult;
  attemptCount: number;
  fallbackUsed: boolean;
  durationMs: number;
  errorMessage?: string;
}

export interface RenderAndCaptureOptions {
  url: string;
  outputPath: string;
  fullPage?: boolean;
  config?: Partial<Phase8RenderConfig>;
  captureImpl?: (url: string, outputPath: string, fullPage: boolean) => Promise<CaptureResult>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  mockFactory?: (outputPath: string, width?: number, height?: number) => Promise<CaptureResult>;
}

const DEFAULT_FULL_PAGE = true;
const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const DEFAULT_NOW = (): number => Date.now();

/**
 * Race a promise against a timeout. Rejects on timeout.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Phase 8 mock-fallback capture: synthesize a solid-color PNG with a label.
 * Used when WP is unreachable and we still need to produce a render-result
 * to keep the fix-loop progressing.
 */
export async function mockCapture(
  outputPath: string,
  width = 1440,
  height = 900,
): Promise<CaptureResult> {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Minimal solid-color PNG (gray placeholder for unreachable WP)
  // Tiny 1x1 gray PNG (66 bytes total — fixed PNG signature + IHDR + IDAT + IEND)
  const oneByOneGrayPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x00, 0x00, 0x00, 0x00, 0x3b, 0x7e, 0x9b, 0x55,
    0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54,
    0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
    0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);

  await fs.writeFile(outputPath, oneByOneGrayPng);

  return {
    url: '',
    outputPath,
    width,
    height,
    bytes: oneByOneGrayPng.length,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Main entry: renderAndCapture with timeout, retry, and fallback.
 *
 * Returns the first successful capture (within timeout). If all retries fail:
 * - fallback='mock' → return mock capture (synthetic gray PNG)
 * - fallback='skip' → throw the last error
 */
export async function renderAndCapture(options: RenderAndCaptureOptions): Promise<Phase8RenderResult> {
  const config: Phase8RenderConfig = { ...DEFAULT_PHASE8_RENDER_CONFIG, ...options.config };
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const now = options.now ?? DEFAULT_NOW;
  const start = now();

  const captureImpl =
    options.captureImpl ??
    ((url: string, outputPath: string, fullPage: boolean) =>
      captureScreenshot({ url, outputPath, fullPage }));

  const fullPage = options.fullPage ?? DEFAULT_FULL_PAGE;
  const mockFactory = options.mockFactory ?? mockCapture;

  let lastError: Error | null = null;
  const totalAttempts = 1 + Math.max(0, config.retries);

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const capture = await withTimeout(
        captureImpl(options.url, options.outputPath, fullPage),
        config.timeoutMs,
      );
      return {
        capture,
        attemptCount: attempt,
        fallbackUsed: false,
        durationMs: now() - start,
      };
    } catch (err) {
      lastError = err as Error;
      if (attempt < totalAttempts) {
        const backoff = config.backoffMs * 2 ** (attempt - 1);
        await sleep(backoff);
      }
    }
  }

  // All retries exhausted
  if (config.fallback === 'mock') {
    const mockResult = await mockFactory(options.outputPath);
    return {
      capture: mockResult,
      attemptCount: totalAttempts,
      fallbackUsed: true,
      durationMs: now() - start,
      errorMessage: lastError?.message ?? 'Unknown error',
    };
  }

  // fallback='skip': propagate last error
  throw lastError ?? new Error('renderAndCapture failed without error');
}

/**
 * Convenience wrapper for batch usage: renderAndCaptureBoth (original + clone).
 * If either fails, returns mock for the failing one with fallbackUsed=true.
 */
export async function renderAndCaptureBoth(options: {
  originalUrl: string;
  cloneUrl: string;
  outputDir: string;
  label: string;
  config?: Partial<Phase8RenderConfig>;
  captureImpl?: (url: string, outputPath: string, fullPage: boolean) => Promise<CaptureResult>;
}): Promise<{ original: Phase8RenderResult; clone: Phase8RenderResult }> {
  const path = await import('node:path');
  const originalPath = path.join(options.outputDir, `original-${options.label}.png`);
  const clonePath = path.join(options.outputDir, `${options.label}.png`);

  const [original, clone] = await Promise.all([
    renderAndCapture({ url: options.originalUrl, outputPath: originalPath, config: options.config, captureImpl: options.captureImpl }),
    renderAndCapture({ url: options.cloneUrl, outputPath: clonePath, config: options.config, captureImpl: options.captureImpl }),
  ]);

  return { original, clone };
}

/**
 * Summarize renderAndCapture results for reporting.
 */
export interface RenderSummary {
  totalAttempts: number;
  successfulFirstTry: number;
  fallbackUsed: number;
  failed: number;
  averageDurationMs: number;
}

export function summarizeRenderResults(results: readonly Phase8RenderResult[]): RenderSummary {
  const successfulFirstTry = results.filter((r) => !r.fallbackUsed && r.attemptCount === 1).length;
  const fallbackUsed = results.filter((r) => r.fallbackUsed).length;
  const totalAttempts = results.reduce((sum, r) => sum + r.attemptCount, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  return {
    totalAttempts,
    successfulFirstTry,
    fallbackUsed,
    failed: 0,
    averageDurationMs: results.length > 0 ? totalDuration / results.length : 0,
  };
}