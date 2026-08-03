import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  isScorableCapture,
  runCanonicalLiveDiff,
  type CaptureManifest,
  type CaptureManifestResult,
} from '@elconv/qa';

let artifactDir: string;

beforeAll(async () => {
  artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canonical-live-diff-'));
});

afterAll(async () => {
  await fs.rm(artifactDir, { recursive: true, force: true });
});

function manifest(overrides: Partial<CaptureManifest> = {}): CaptureManifest {
  return {
    url: 'https://example.test',
    finalUrl: 'https://example.test/',
    httpStatus: 200,
    redirectChain: [],
    title: 'Example',
    viewport: { width: 2, height: 2, deviceScaleFactor: 1 },
    bodyLength: 5000,
    scrollHeight: 2,
    contentMarkers: ['main'],
    errorMarkers: [],
    fontsReady: true,
    images: { total: 1, loaded: 1, failed: 0 },
    consoleErrors: [],
    requestFailures: [],
    screenshotPath: undefined,
    screenshot: { width: 2, height: 2, bytes: 1000 },
    diagnostics: {
      phaseDurationsMs: {},
      elapsedMs: 1,
      scrollIterations: 0,
      scrollHeightBefore: 2,
      scrollHeightAfter: 2,
      scrollCapped: false,
      assetWaitTimedOut: false,
      fontsWaitTimedOut: false,
      pendingImages: 0,
      lazyImagesPromoted: 0,
    },
    captureIntegrity: {
      domScrollHeight: 2,
      screenshotWidth: 2,
      screenshotHeight: 2,
      viewportWidth: 2,
      viewportHeight: 2,
      heightDeltaPx: 0,
      widthMismatch: false,
      captureTimedOut: false,
    },
    status: 'captured',
    captured: true,
    ...overrides,
  };
}

async function captureResult(m: CaptureManifest): Promise<CaptureManifestResult> {
  if (!m.screenshotPath) return { manifest: m };
  const png = new PNG({ width: m.screenshot?.width ?? 2, height: m.screenshot?.height ?? 2 });
  png.data.fill(255);
  const bytes = PNG.sync.write(png);
  await fs.writeFile(m.screenshotPath, bytes);
  return {
    manifest: { ...m, screenshot: { ...m.screenshot!, bytes: bytes.length } },
    result: { url: m.url, outputPath: m.screenshotPath, width: png.width, height: png.height, bytes: bytes.length, capturedAt: new Date(0).toISOString() },
  };
}

describe('canonical live diff', () => {
  it('scores only when every requested source/target capture passes integrity gates', async () => {
    const calls: string[] = [];
    const result = await runCanonicalLiveDiff({
      sourceUrl: 'https://source.test',
      targetUrl: 'https://target.test',
      outputDir: path.join(artifactDir, 'run'),
      viewports: [{ label: 'desktop', width: 2, height: 2 }],
      capture: async (options) => {
        calls.push(options.url);
        return captureResult(manifest({ url: options.url, screenshotPath: path.join(artifactDir, `${calls.length}.png`) }));
      },
      diff: async (options) => {
        expect(options.originalScreenshots).toHaveLength(1);
        expect(options.cloneScreenshots).toHaveLength(1);
        return {
          overall: { pixelmatch: 99, ssim: 98 },
          perSection: [],
          perViewport: { desktop: 99 },
          ignoreRegionsApplied: 0,
          topHotspots: [],
          computedAt: new Date(0).toISOString(),
        };
      },
    });

    expect(result.status).toBe('scored');
    expect(result.diff?.overall.pixelmatch).toBe(99);
    expect(calls).toEqual(['https://source.test', 'https://target.test']);
  });

  it('returns not-scored and never invokes diff when one capture is invalid', async () => {
    let diffCalled = false;
    const result = await runCanonicalLiveDiff({
      sourceUrl: 'https://source.test',
      targetUrl: 'https://target.test',
      outputDir: path.join(artifactDir, 'invalid'),
      viewports: [{ label: 'desktop', width: 2, height: 2 }],
      capture: async (options) => captureResult(manifest({
        url: options.url,
        status: options.url.includes('target') ? 'capture-error' : 'captured',
        captured: !options.url.includes('target'),
        screenshotPath: options.url.includes('target') ? undefined : path.join(artifactDir, 'source.png'),
        notScoredReason: 'target unavailable',
      })),
      diff: async () => {
        diffCalled = true;
        throw new Error('must not diff invalid captures');
      },
    });

    expect(result.status).toBe('not-scored');
    expect(result.reason).toContain('target unavailable');
    expect(diffCalled).toBe(false);
  });

  it('rejects request failures, missing artifacts, and diagnostic safety caps before scoring', () => {
    expect(isScorableCapture(manifest({ requestFailures: ['style.css: failed'] }))).toBe(false);
    expect(isScorableCapture(manifest({
      screenshotPath: 'fixture.png',
      requestFailures: ['/elementor-pro/assets/css/widget-nav-menu.min.css: failed'],
      blockingRequestFailures: [],
      nonBlockingRequestFailures: ['/elementor-pro/assets/css/widget-nav-menu.min.css: failed'],
      consoleErrors: ['Failed to load resource: the server responded with a status of 404 (Not Found)'],
      blockingConsoleErrors: [],
      nonBlockingConsoleErrors: ['Failed to load resource: the server responded with a status of 404 (Not Found)'],
    }))).toBe(false);
    expect(isScorableCapture(manifest({
      screenshotPath: 'overflow.png',
      captureIntegrity: {
        domScrollHeight: 2,
        screenshotWidth: 1694,
        screenshotHeight: 2,
        rawScreenshotWidth: 1694,
        horizontalOverflowPx: 250,
        screenshotCropped: false,
        viewportWidth: 1440,
        viewportHeight: 900,
        heightDeltaPx: 0,
        widthMismatch: true,
        captureTimedOut: false,
      },
    }))).toBe(false);
    expect(isScorableCapture(manifest())).toBe(false);
    expect(isScorableCapture(manifest({
      screenshotPath: 'fold.png',
      images: { total: 2, loaded: 1, failed: 1 },
      scoredImages: { total: 1, loaded: 1, failed: 0 },
    }))).toBe(true);
    expect(isScorableCapture(manifest({ diagnostics: {
      phaseDurationsMs: {},
      elapsedMs: 10,
      scrollIterations: 1,
      scrollHeightBefore: 100,
      scrollHeightAfter: 200,
      scrollCapped: true,
      assetWaitTimedOut: false,
      fontsWaitTimedOut: false,
      pendingImages: 0,
      lazyImagesPromoted: 0,
    } }))).toBe(false);
    expect(isScorableCapture(manifest({ diagnostics: {
      phaseDurationsMs: {},
      elapsedMs: 10,
      scrollIterations: 0,
      scrollHeightBefore: 100,
      scrollHeightAfter: 100,
      scrollCapped: false,
      assetWaitTimedOut: false,
      fontsWaitTimedOut: false,
      pendingImages: 1,
      lazyImagesPromoted: 0,
    } }))).toBe(false);
    expect(isScorableCapture(manifest({ diagnostics: {
      phaseDurationsMs: {},
      elapsedMs: 10,
      scrollIterations: 0,
      scrollHeightBefore: 100,
      scrollHeightAfter: 100,
      scrollCapped: false,
      assetWaitTimedOut: true,
      fontsWaitTimedOut: false,
      pendingImages: 1,
      lazyImagesPromoted: 0,
    } }))).toBe(false);
  });

  it('converts a corrupt PNG artifact into not-scored instead of throwing', async () => {
    const corruptPath = path.join(artifactDir, 'corrupt.png');
    await fs.writeFile(corruptPath, Buffer.from('not-a-png'));
    let diffCalled = false;
    const result = await runCanonicalLiveDiff({
      sourceUrl: 'https://source.test',
      targetUrl: 'https://target.test',
      outputDir: path.join(artifactDir, 'corrupt'),
      viewports: [{ label: 'desktop', width: 2, height: 2 }],
      capture: async (options) => ({
        manifest: manifest({
          url: options.url,
          screenshotPath: corruptPath,
          screenshot: { width: 2, height: 2, bytes: Buffer.byteLength('not-a-png') },
        }),
      }),
      diff: async () => {
        diffCalled = true;
        throw new Error('must not diff corrupt artifacts');
      },
    });

    expect(result.status).toBe('not-scored');
    expect(result.reason).toContain('not a readable PNG');
    expect(diffCalled).toBe(false);
  });
});
