import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { AIRouter, type AIResponse, type AITask, type VisionProvider } from '@elconv/core';
import { detectIssues, type AcceptanceReport } from '@elconv/qa';
import {
  runLegacyRepairPaths,
  type HealingFixPort,
} from '../../../packages/cli/src/analysis/legacy-repair.js';

function makeQaReport(originalPath: string, clonePath: string): AcceptanceReport {
  return {
    verdict: 'fail',
    score: 0.5,
    matchPercent: 50,
    originalCapture: {
      url: 'https://original.example',
      outputPath: originalPath,
      width: 2,
      height: 2,
      bytes: 0,
      capturedAt: new Date().toISOString(),
    },
    cloneCapture: {
      url: 'https://clone.example',
      outputPath: clonePath,
      width: 2,
      height: 2,
      bytes: 0,
      capturedAt: new Date().toISOString(),
    },
    diffResult: {
      originalPath,
      clonePath,
      width: 2,
      height: 2,
      totalPixels: 4,
      diffPixels: 2,
      diffPercent: 50,
      matchPercent: 50,
      computedAt: new Date().toISOString(),
    },
    recommendations: [],
    generatedAt: new Date().toISOString(),
  };
}

function makeRouter(responseText: string): AIRouter {
  const provider: VisionProvider = {
    name: 'test-provider',
    costPerImage: 0,
    available: async () => true,
    execute: async (_task: AITask): Promise<AIResponse> => ({
      text: responseText,
      cost: 0,
      provider: 'test-provider',
      durationMs: 0,
    }),
  };
  return new AIRouter([provider]);
}

async function writePng(filePath: string, color: [number, number, number]): Promise<void> {
  await writePngPattern(filePath, 2, 2, () => color);
}

async function writePngPattern(
  filePath: string,
  width: number,
  height: number,
  colorAt: (x: number, y: number) => [number, number, number],
): Promise<void> {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colorAt(x, y);
      const index = (y * width + x) * 4;
      png.data[index] = r;
      png.data[index + 1] = g;
      png.data[index + 2] = b;
      png.data[index + 3] = 255;
    }
  }
  await fs.writeFile(filePath, PNG.sync.write(png));
}

describe('legacy repair paths', () => {
  it('reports every requested path as unavailable when its ports are missing', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'elconv-legacy-unavailable-'));
    const qaReport = makeQaReport(join(outputDir, 'original.png'), join(outputDir, 'clone.png'));

    const result = await runLegacyRepairPaths({
      outputDir,
      cloneUrl: 'https://clone.example',
      postId: 42,
      qaReport,
      qaAutoFix: true,
      heal: true,
      fullContextRepair: true,
    });

    expect(result.autoFix?.status).toBe('unavailable');
    expect(result.healing?.status).toBe('unavailable');
    expect(result.fullContextRepair?.status).toBe('unavailable');
    expect(result.autoFix?.error).toContain('probe check');
    expect(result.healing?.error).toContain('fix port');
    expect(result.fullContextRepair?.error).toContain('AIRouter');
    expect(result.autoFix?.reachedThreshold).toBe(false);
    expect(result.healing?.targetReached).toBe(false);
  });

  it('executes Auto-Fix through the injected probe and WPCode ports', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'elconv-legacy-autofix-'));
    const updates: string[] = [];
    let probeCalls = 0;
    const result = await runLegacyRepairPaths({
      outputDir,
      cloneUrl: 'https://clone.example',
      postId: 42,
      qaReport: makeQaReport('original.png', 'clone.png'),
      qaAutoFix: true,
      probeChecks: [{ selector: '.hero', expectedStyles: { color: '#fff' } }],
      probeRunner: async (url, checks) => {
        probeCalls += 1;
        const passing = probeCalls > 1;
        return [{
          url,
          timestamp: new Date().toISOString(),
          totalProbes: checks.length,
          passCount: passing ? 1 : 0,
          failCount: passing ? 0 : 1,
          score: passing ? 100 : 0,
          results: [{
            selector: '.hero',
            label: 'hero',
            expected: { color: '#fff' },
            actual: { color: passing ? '#fff' : '#000' },
            match: passing,
            diffs: passing ? [] : [{ property: 'color', expected: '#fff', actual: '#000', withinTolerance: false }],
            suggestedCSSFix: null,
          }],
        }];
      },
      wpcodePort: {
        update: async (_title, code) => updates.push(code),
      },
    });

    expect(result.autoFix?.status).toBe('ok');
    expect(result.autoFix?.reachedThreshold).toBe(true);
    expect(result.autoFix?.totalFixesApplied).toBe(1);
    expect(probeCalls).toBe(2);
    expect(updates[0]).toContain('body.page-id-42 .hero');
    expect(result.autoFix?.artifactPath).toMatch(/auto-fix-report\.json$/);
  });

  it('executes Healing through injected capture, diff, and fix ports', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'elconv-legacy-healing-'));
    const applied: number[] = [];
    let diffCalls = 0;
    const fixPort: HealingFixPort = {
      apply: async (fixes) => {
        applied.push(fixes.length);
        return { applied: fixes.length, succeeded: fixes.length };
      },
    };
    const result = await runLegacyRepairPaths({
      outputDir,
      cloneUrl: 'https://clone.example',
      qaReport: makeQaReport('original.png', 'clone.png'),
      heal: true,
      healingFixPort: fixPort,
      healingMaxIterations: 2,
      healingTargetScore: 85,
      healingDiffFn: async () => {
        diffCalls += 1;
        const score = diffCalls === 1 ? 80 : 90;
        return {
        viewport: { width: 2, height: 2, label: 'desktop' },
        totalPixels: 4,
        diffPixels: score === 90 ? 0 : 1,
        diffPercent: score === 90 ? 0 : 25,
        score,
        regions: score === 90 ? [] : [{
          id: 'hero',
          semanticRole: 'hero',
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          diffPixels: 1,
          diffPercent: 25,
          severity: 'critical',
        }],
        };
      },
      healingCaptureFn: async (_url, path) => path,
    });

    expect(result.healing?.status).toBe('ok');
    expect(result.healing?.targetReached).toBe(true);
    expect(result.healing?.totalIterations).toBe(1);
    expect(diffCalls).toBe(2);
    expect(applied).toEqual([1]);
    expect(result.healing?.artifactPath).toMatch(/healing-report\.json$/);
  });

  it('reports unsupported default-diff issues without sending them to a fixer', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'elconv-legacy-unfixable-'));
    const originalPath = join(outputDir, 'original.png');
    const clonePath = join(outputDir, 'clone.png');
    await writePng(originalPath, [255, 255, 255]);
    await writePng(clonePath, [0, 0, 0]);
    const applied: number[] = [];

    const result = await runLegacyRepairPaths({
      outputDir,
      cloneUrl: 'https://clone.example',
      qaReport: makeQaReport(originalPath, clonePath),
      heal: true,
      healingFixPort: {
        apply: async (fixes) => {
          applied.push(fixes.length);
          return { applied: fixes.length, succeeded: fixes.length };
        },
      },
      healingMaxIterations: 1,
      healingTargetScore: 90,
      healingCaptureFn: async (_url, outputPath) => {
        await fs.copyFile(clonePath, outputPath);
        return outputPath;
      },
    });

    expect(result.healing?.status).toBe('failed');
    expect(applied).toEqual([]);
    expect(result.healing?.iterations[0]?.issuesFound).toBe(1);
    expect(result.healing?.iterations[0]?.unfixableIssues?.[0]).toMatchObject({
      semanticRole: 'blank-region',
    });
    expect(result.healing?.iterations[0]?.unfixableIssues?.[0]?.reason).toContain(
      'No safe fixer is registered for blank-region',
    );
  });

  it('keeps image-broken and missing-texture findings diagnostic in the default healing diff', async () => {
    const cases = [
      {
        name: 'image-broken',
        original: (x: number, y: number) => [255, 255, 255] as [number, number, number],
        clone: (x: number, y: number) => (x < 32 && y < 32 ? [0, 0, 0] : [255, 255, 255]) as [number, number, number],
      },
      {
        name: 'missing-texture',
        original: (x: number, y: number) => [x * 8, y * 8, (x + y) * 4] as [number, number, number],
        clone: () => [120, 120, 120] as [number, number, number],
      },
    ] as const;

    for (const testCase of cases) {
      const outputDir = await mkdtemp(join(tmpdir(), `elconv-legacy-${testCase.name}-`));
      const originalPath = join(outputDir, 'original.png');
      const clonePath = join(outputDir, 'clone.png');
      await writePngPattern(originalPath, 64, 64, testCase.original);
      await writePngPattern(clonePath, 64, 64, testCase.clone);
      const applied: number[] = [];

      const result = await runLegacyRepairPaths({
        outputDir,
        cloneUrl: 'https://clone.example',
        qaReport: makeQaReport(originalPath, clonePath),
        heal: true,
        healingFixPort: {
          apply: async (fixes) => {
            applied.push(fixes.length);
            return { applied: fixes.length, succeeded: fixes.length };
          },
        },
        healingMaxIterations: 1,
        healingTargetScore: 100,
        healingCaptureFn: async (_url, outputPath) => {
          await fs.copyFile(clonePath, outputPath);
          return outputPath;
        },
      });

      expect(result.healing?.iterations[0]?.unfixableIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ semanticRole: testCase.name }),
        ]),
      );
      expect(applied).toEqual([]);
    }
  });

  it('writes a Full-Context Repair report from detected issues and AI proposals', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'elconv-legacy-repair-'));
    const originalPath = join(outputDir, 'original.png');
    const clonePath = join(outputDir, 'clone.png');
    await writePng(originalPath, [255, 255, 255]);
    await writePng(clonePath, [0, 0, 0]);

    const result = await runLegacyRepairPaths({
      outputDir,
      cloneUrl: 'https://clone.example',
      qaReport: makeQaReport(originalPath, clonePath),
      fullContextRepair: true,
      repairRouter: makeRouter(JSON.stringify({
        settings: { color: '#fff' },
        styles: {},
        classes: ['repair-proposed'],
        explanation: 'Match the source color.',
      })),
      repairContextProvider: async (_issue, screenshots) => ({
        originalScreenshotPath: screenshots.originalPath,
        cloneScreenshotPath: screenshots.clonePath,
        html: '<div class="hero">Hero</div>',
        computedCss: { color: '#000' },
        elementType: 'div',
      }),
    });

    expect(result.fullContextRepair?.status).toBe('ok');
    expect(result.fullContextRepair?.issuesDetected).toBeGreaterThan(0);
    expect(result.fullContextRepair?.repairsProposed).toBe(result.fullContextRepair?.issuesDetected);
    expect(result.fullContextRepair?.results[0]?.repair.success).toBe(true);
    const artifact = await fs.readFile(result.fullContextRepair!.artifactPath, 'utf8');
    expect(JSON.parse(artifact).status).toBe('ok');
  });

  it('skips low-severity issues when proposing full-context AI repairs', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'elconv-legacy-repair-lowsev-'));
    const originalPath = join(outputDir, 'original.png');
    const clonePath = join(outputDir, 'clone.png');
    // Whole image identical except one small, subtle-color patch (32x32).
    // Per-pixel channel delta must exceed the diff-pixel threshold (sum>30
    // in issue-detector.ts computeRegionStats) to register at all, but stay
    // under classifyRegion's colorDelta>60 branch — 45 satisfies both.
    // classifies as a 'low'-severity size-mismatch, not 'high'/'medium'.
    // Verified directly via detectIssues() below before relying on it.
    const inPatch = (x: number, y: number) => x < 32 && y < 32;
    await writePngPattern(originalPath, 64, 64, (x, y) => (inPatch(x, y) ? [100, 100, 100] : [255, 255, 255]));
    await writePngPattern(clonePath, 64, 64, (x, y) => (inPatch(x, y) ? [145, 100, 100] : [255, 255, 255]));

    const detection = await detectIssues({ originalPath, clonePath });
    expect(detection.issues.length).toBeGreaterThan(0);
    expect(detection.issues.every((issue) => issue.severity === 'low')).toBe(true);

    let repairCalls = 0;
    const result = await runLegacyRepairPaths({
      outputDir,
      cloneUrl: 'https://clone.example',
      qaReport: makeQaReport(originalPath, clonePath),
      fullContextRepair: true,
      repairRouter: makeRouter(JSON.stringify({ settings: {}, styles: {}, classes: [], explanation: 'n/a' })),
      repairContextProvider: async (_issue, screenshots) => {
        repairCalls += 1;
        return {
          originalScreenshotPath: screenshots.originalPath,
          cloneScreenshotPath: screenshots.clonePath,
          html: '<div></div>',
          computedCss: {},
          elementType: 'div',
        };
      },
    });

    expect(result.fullContextRepair?.issuesDetected).toBeGreaterThan(0);
    expect(repairCalls).toBe(0);
    expect(result.fullContextRepair?.results).toEqual([]);
  });
});
