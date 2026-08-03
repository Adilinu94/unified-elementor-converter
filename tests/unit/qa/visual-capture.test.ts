import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureManifest, captureScreenshot } from '@elconv/qa';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/below-fold-image' || request.url === '/visible-broken') {
      response.writeHead(404, { 'content-type': 'image/gif' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end((globalThis as { __captureHtml?: string }).__captureHtml ?? '<!doctype html><html><body><main>fixture</main></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start capture fixture server');
  baseUrl = `http://127.0.0.1:${address.port}/fixture`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function setFixtureHtml(html: string): void {
  (globalThis as { __captureHtml?: string }).__captureHtml = html;
}

describe('visual capture diagnostics', () => {
  it('records a scroll safety cap instead of waiting indefinitely', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-capture-scroll-'));
    const outputPath = path.join(outputDir, 'desktop.png');
    setFixtureHtml('<!doctype html><html><head><title>Long page</title><style>body{margin:0}main{height:5000px;background:#123;color:#fff}</style></head><body><main>content</main></body></html>');

    try {
      const result = await captureManifest({
        url: baseUrl,
        outputPath,
        viewport: { width: 390, height: 844 },
        fullPage: true,
        timeoutMs: 15_000,
        maxScrollSteps: 1,
        assetTimeoutMs: 500,
      });

      expect(result.manifest.diagnostics?.scrollCapped).toBe(true);
      expect(result.manifest.diagnostics?.scrollIterations).toBe(1);
      expect(result.manifest.diagnostics?.currentPhase).toBeUndefined();
      expect(result.manifest.diagnostics?.phaseDurationsMs.scroll).toBeDefined();
      expect(result.manifest.screenshotPath).toBe(outputPath);
      expect(result.manifest.screenshot?.width).toBe(390);
      expect((await fs.stat(outputPath)).size).toBeGreaterThan(0);
      expect(result.manifest.notScoredReason).toContain('scroll safety cap');
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps the legacy screenshot API strict when the scroll safety cap is reached', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-capture-legacy-'));
    const outputPath = path.join(outputDir, 'legacy.png');
    setFixtureHtml('<!doctype html><html><body><main style="height:5000px">legacy</main></body></html>');

    try {
      await expect(captureScreenshot({
        url: baseUrl,
        outputPath,
        viewport: { width: 390, height: 844 },
        fullPage: true,
        timeoutMs: 15_000,
        maxScrollSteps: 1,
        assetTimeoutMs: 500,
      })).rejects.toThrow('scroll safety cap');
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('captures a stable viewport without requiring full-page scrolling', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-capture-viewport-'));
    const outputPath = path.join(outputDir, 'viewport.png');
    setFixtureHtml(`<!doctype html><html><head><title>Viewport</title></head><body><main><h1>Stable capture</h1><p>${'stable '.repeat(600)}</p></main></body></html>`);

    try {
      const result = await captureManifest({
        url: baseUrl,
        outputPath,
        viewport: { width: 390, height: 844 },
        fullPage: false,
        timeoutMs: 15_000,
        assetTimeoutMs: 500,
      });

      expect(result.manifest.status).toBe('captured');
      expect(result.manifest.captured).toBe(true);
      expect(result.manifest.diagnostics?.phaseDurationsMs.screenshot).toBeDefined();
      expect(result.manifest.screenshot).toMatchObject({ width: 390, height: 844 });
      expect((await fs.stat(outputPath)).size).toBeGreaterThan(0);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('does not asset-timeout a fold capture on an unresolved image below the viewport', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-capture-fold-assets-'));
    const outputPath = path.join(outputDir, 'fold.png');
    setFixtureHtml('<!doctype html><html><head><title>Fold assets</title></head><body><main><img alt="visible" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" /><div style="height:1200px"></div><img alt="below-fold" src="/below-fold-image" /></main></body></html>');

    try {
      const result = await captureManifest({
        url: baseUrl,
        outputPath,
        viewport: { width: 390, height: 844 },
        fullPage: false,
        timeoutMs: 15_000,
        assetTimeoutMs: 250,
      });

      expect(result.manifest.status).toBe('not-scored');
      expect(result.manifest.captured).toBe(false);
      expect(result.manifest.notScoredReason).toContain('blocking console error');
      expect(result.manifest.diagnostics?.assetWaitTimedOut).toBe(false);
      expect(result.manifest.diagnostics?.pendingImages).toBe(0);
      expect(result.manifest.images.failed).toBe(1);
      expect(result.manifest.scoredImages).toEqual({ total: 1, loaded: 1, failed: 0 });
      expect(result.manifest.nonBlockingConsoleErrors).toHaveLength(0);
      expect(result.manifest.blockingConsoleErrors).toHaveLength(1);
      expect(result.manifest.screenshot).toMatchObject({ width: 390, height: 844 });
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps a visible broken image blocking a fold capture', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-capture-visible-failure-'));
    const outputPath = path.join(outputDir, 'fold.png');
    setFixtureHtml('<!doctype html><html><head><title>Visible failure</title></head><body><main><img alt="visible-broken" src="/visible-broken" /></main></body></html>');

    try {
      const result = await captureManifest({
        url: baseUrl,
        outputPath,
        viewport: { width: 390, height: 844 },
        fullPage: false,
        timeoutMs: 15_000,
        assetTimeoutMs: 250,
      });

      expect(result.manifest.status).toBe('not-scored');
      expect(result.manifest.scoredImages?.failed).toBe(1);
      expect(result.manifest.blockingConsoleErrors?.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps full-page capture strict for a broken image below the fold', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-capture-full-assets-'));
    const outputPath = path.join(outputDir, 'full.png');
    setFixtureHtml('<!doctype html><html><head><title>Full assets</title></head><body><main><div style="height:1200px"></div><img alt="below-fold-broken" src="/below-fold-image" /></main></body></html>');

    try {
      const result = await captureManifest({
        url: baseUrl,
        outputPath,
        viewport: { width: 390, height: 844 },
        fullPage: true,
        timeoutMs: 15_000,
        assetTimeoutMs: 250,
      });

      expect(result.manifest.status).toBe('not-scored');
      expect(result.manifest.images.failed).toBe(1);
      expect(result.manifest.scoredImages?.failed).toBe(1);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 30_000);
});
