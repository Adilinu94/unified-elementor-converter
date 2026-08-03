import path from 'node:path';
import { promises as fs } from 'node:fs';
import { PNG } from 'pngjs';
import type { ComprehensiveDiffResult, SectionInfo, ViewportScreenshot } from '@elconv/core';
import { runComprehensiveDiff } from './diff/index.js';
import {
  captureManifest,
  type CaptureManifest,
  type CaptureManifestResult,
  type CaptureOptions,
} from './visual-capture.js';

export interface CanonicalLiveDiffViewport {
  label: 'mobile' | 'tablet' | 'desktop' | 'wide';
  width: number;
  height: number;
}

export interface CanonicalLiveDiffOptions {
  sourceUrl: string;
  targetUrl: string;
  outputDir: string;
  viewports?: CanonicalLiveDiffViewport[];
  fullPage?: boolean;
  timeoutMs?: number;
  sections?: SectionInfo[];
  ignoreRegions?: Parameters<typeof runComprehensiveDiff>[0]['ignoreRegions'];
  generateHeatmap?: boolean;
  capture?: (options: CaptureOptions) => Promise<CaptureManifestResult>;
  diff?: typeof runComprehensiveDiff;
}

export interface CanonicalCapturePair {
  source: CaptureManifest;
  target: CaptureManifest;
}

export type CanonicalLiveDiffStatus = 'scored' | 'not-scored';

export interface CanonicalLiveDiffResult {
  status: CanonicalLiveDiffStatus;
  reason?: string;
  sourceUrl: string;
  targetUrl: string;
  outputDir: string;
  captures: Record<string, CanonicalCapturePair>;
  diff?: ComprehensiveDiffResult;
}

const DEFAULT_VIEWPORTS: CanonicalLiveDiffViewport[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile', width: 390, height: 844 },
];

/**
 * Capture source and target independently at every viewport, then score only
 * when every requested pair passes the capture-integrity contract. This is the
 * canonical path for live comparisons; callers must not substitute raw PNGs.
 */
export async function runCanonicalLiveDiff(options: CanonicalLiveDiffOptions): Promise<CanonicalLiveDiffResult> {
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const capture = options.capture ?? captureManifest;
  const diff = options.diff ?? runComprehensiveDiff;
  const captures: Record<string, CanonicalCapturePair> = {};
  const sourceScreenshots: ViewportScreenshot[] = [];
  const targetScreenshots: ViewportScreenshot[] = [];
  const failures: string[] = [];

  for (const viewport of viewports) {
    const prefix = path.join(options.outputDir, viewport.label);
    const [source, target] = await Promise.all([
      safeCapture(capture, {
        url: options.sourceUrl,
        outputPath: `${prefix}-source.png`,
        viewport: { width: viewport.width, height: viewport.height },
        fullPage: options.fullPage ?? true,
        timeoutMs: options.timeoutMs,
      }),
      safeCapture(capture, {
        url: options.targetUrl,
        outputPath: `${prefix}-target.png`,
        viewport: { width: viewport.width, height: viewport.height },
        fullPage: options.fullPage ?? true,
        timeoutMs: options.timeoutMs,
      }),
    ]);
    captures[viewport.label] = { source: source.manifest, target: target.manifest };

    const [sourceArtifact, targetArtifact] = await Promise.all([
      verifyCaptureArtifact(source.manifest),
      verifyCaptureArtifact(target.manifest),
    ]);
    if (!sourceArtifact.ok) failures.push(`${viewport.label}: source — ${sourceArtifact.reason}`);
    if (!targetArtifact.ok) failures.push(`${viewport.label}: target — ${targetArtifact.reason}`);
    if (sourceArtifact.ok && source.manifest.screenshotPath) sourceScreenshots.push({ viewport: viewport.label, path: source.manifest.screenshotPath });
    if (targetArtifact.ok && target.manifest.screenshotPath) targetScreenshots.push({ viewport: viewport.label, path: target.manifest.screenshotPath });
  }

  if (failures.length > 0 || sourceScreenshots.length !== viewports.length || targetScreenshots.length !== viewports.length) {
    return {
      status: 'not-scored',
      reason: failures.length > 0 ? failures.join('; ') : 'one or more capture pairs were incomplete',
      sourceUrl: options.sourceUrl,
      targetUrl: options.targetUrl,
      outputDir: options.outputDir,
      captures,
    };
  }

  const report = await diff({
    originalScreenshots: sourceScreenshots,
    cloneScreenshots: targetScreenshots,
    sections: options.sections ?? [],
    ignoreRegions: options.ignoreRegions,
    outputDir: options.outputDir,
    generateHeatmap: options.generateHeatmap,
  });
  return {
    status: 'scored',
    sourceUrl: options.sourceUrl,
    targetUrl: options.targetUrl,
    outputDir: options.outputDir,
    captures,
    diff: report,
  };
}

async function safeCapture(
  capture: (options: CaptureOptions) => Promise<CaptureManifestResult>,
  options: CaptureOptions,
): Promise<CaptureManifestResult> {
  try {
    return await capture(options);
  } catch (error) {
    return {
      manifest: {
        url: options.url,
        finalUrl: options.url,
        httpStatus: 0,
        redirectChain: [],
        title: '',
        viewport: {
          width: options.viewport?.width ?? 1440,
          height: options.viewport?.height ?? 900,
          deviceScaleFactor: 1,
        },
        bodyLength: 0,
        scrollHeight: 0,
        contentMarkers: [],
        errorMarkers: [],
        fontsReady: false,
        images: { total: 0, loaded: 0, failed: 0 },
        consoleErrors: [],
        requestFailures: [],
        captureIntegrity: {
          domScrollHeight: 0,
          viewportWidth: options.viewport?.width ?? 1440,
          viewportHeight: options.viewport?.height ?? 900,
          widthMismatch: false,
          captureTimedOut: error instanceof Error && /timeout|timed out/i.test(error.message),
        },
        status: 'capture-error',
        captured: false,
        notScoredReason: error instanceof Error ? error.message.slice(0, 300) : String(error),
      },
    };
  }
}

async function verifyCaptureArtifact(manifest: CaptureManifest): Promise<{ ok: boolean; reason: string }> {
  if (!isScorableCapture(manifest)) return { ok: false, reason: manifest.notScoredReason ?? manifest.status };
  if (!manifest.screenshotPath || !manifest.screenshot || manifest.screenshot.width <= 0 || manifest.screenshot.height <= 0 || manifest.screenshot.bytes <= 0) {
    return { ok: false, reason: 'screenshot metadata is incomplete' };
  }
  try {
    const stat = await fs.stat(manifest.screenshotPath);
    if (!stat.isFile() || stat.size <= 0) return { ok: false, reason: 'screenshot artifact is empty' };
    if (stat.size !== manifest.screenshot.bytes) return { ok: false, reason: 'screenshot bytes do not match manifest' };
    let png: PNG;
    try {
      png = PNG.sync.read(await fs.readFile(manifest.screenshotPath));
    } catch {
      return { ok: false, reason: 'screenshot artifact is not a readable PNG' };
    }
    if (png.width !== manifest.screenshot.width || png.height !== manifest.screenshot.height) {
      return { ok: false, reason: 'screenshot dimensions do not match manifest' };
    }
    if (png.data.length === 0) return { ok: false, reason: 'screenshot PNG has no pixel data' };
    return { ok: true, reason: '' };
  } catch {
    return { ok: false, reason: 'screenshot artifact is missing' };
  }
}

/** Pure structural score gate shared by orchestration and tests. */
export function isScorableCapture(manifest: CaptureManifest): boolean {
  return manifest.status === 'captured'
    && typeof manifest.diagnostics !== 'undefined'
    && manifest.captured
    && manifest.httpStatus >= 200
    && manifest.httpStatus < 400
    && manifest.fontsReady
    && manifest.errorMarkers.length === 0
    && (manifest.scoredImages ?? manifest.images).failed === 0
    && manifest.consoleErrors.length === 0
    && (manifest.blockingConsoleErrors ?? manifest.consoleErrors).length === 0
    && (manifest.blockingRequestFailures ?? manifest.requestFailures).length === 0
    && !manifest.captureIntegrity.captureTimedOut
    && !manifest.captureIntegrity.widthMismatch
    && !manifest.diagnostics?.assetWaitTimedOut
    && !manifest.diagnostics?.scrollCapped
    && (manifest.diagnostics?.pendingImages ?? 0) === 0
    && Math.abs(manifest.captureIntegrity.heightDeltaPx ?? 0) <= 8
    && typeof manifest.screenshotPath === 'string';
}
