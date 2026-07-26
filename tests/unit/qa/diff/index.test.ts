import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { runComprehensiveDiff } from '@elconv/qa';
import type { ViewportScreenshot } from '@elconv/core';
import type { SectionInfo } from '@elconv/extractors';

let tmpDir: string;
let outputDir: string;

function solidPng(width: number, height: number, r: number, g: number, b: number): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return png;
}

async function writeShot(name: string, png: PNG): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, PNG.sync.write(png));
  return filePath;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comprehensive-diff-'));
  outputDir = path.join(tmpDir, 'out');
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const SECTIONS: SectionInfo[] = [
  { section_id: 'hero', selector: '#hero', y_range: [0, 20], layout: 'block', child_count: 1 },
  { section_id: 'footer', selector: '#footer', y_range: [20, 40], layout: 'block', child_count: 1 },
];

describe('runComprehensiveDiff', () => {
  it('produces a full report with per-section and per-viewport scores, and writes diff-report.json', async () => {
    const desktopOrig = await writeShot('desktop-orig.png', solidPng(40, 40, 10, 20, 30));
    const desktopClone = await writeShot('desktop-clone.png', solidPng(40, 40, 10, 20, 30));
    const mobileOrig = await writeShot('mobile-orig.png', solidPng(20, 20, 10, 20, 30));
    const mobileClone = await writeShot('mobile-clone.png', solidPng(20, 20, 250, 250, 250));

    const originalScreenshots: ViewportScreenshot[] = [
      { viewport: 'desktop', path: desktopOrig },
      { viewport: 'mobile', path: mobileOrig },
    ];
    const cloneScreenshots: ViewportScreenshot[] = [
      { viewport: 'desktop', path: desktopClone },
      { viewport: 'mobile', path: mobileClone },
    ];

    const result = await runComprehensiveDiff({
      originalScreenshots,
      cloneScreenshots,
      sections: SECTIONS,
      outputDir,
    });

    expect(result.overall.pixelmatch).toBeGreaterThan(90);
    expect(result.overall.ssim).toBeGreaterThan(90);
    expect(result.perSection).toHaveLength(2);
    expect(Object.keys(result.perViewport).sort()).toEqual(['desktop', 'mobile']);
    expect(result.perViewport.mobile).toBeLessThan(result.perViewport.desktop);
    expect(result.ignoreRegionsApplied).toBe(0);
    expect(result.diffHeatmapPath).toBeUndefined();
    expect(new Date(result.computedAt).toString()).not.toBe('Invalid Date');

    const reportRaw = await fs.readFile(path.join(outputDir, 'diff-report.json'), 'utf-8');
    expect(JSON.parse(reportRaw).overall.pixelmatch).toBeCloseTo(result.overall.pixelmatch, 5);
  });

  it('generates a heatmap file when generateHeatmap is true', async () => {
    const origPath = await writeShot('heat-orig.png', solidPng(30, 30, 5, 5, 5));
    const clonePath = await writeShot('heat-clone.png', solidPng(30, 30, 5, 5, 5));

    const result = await runComprehensiveDiff({
      originalScreenshots: [{ viewport: 'desktop', path: origPath }],
      cloneScreenshots: [{ viewport: 'desktop', path: clonePath }],
      sections: [],
      outputDir: path.join(tmpDir, 'heat-out'),
      generateHeatmap: true,
    });

    expect(result.diffHeatmapPath).toBeDefined();
    const stat = await fs.stat(result.diffHeatmapPath!);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('applies ignore regions before diffing and reports how many were used', async () => {
    const origPath = await writeShot('ignore-orig.png', solidPng(20, 20, 0, 0, 0));
    const clonePng = solidPng(20, 20, 0, 0, 0);
    // Punch a difference only inside the region we'll ignore.
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const idx = (20 * y + x) << 2;
        clonePng.data[idx] = 255;
        clonePng.data[idx + 1] = 255;
        clonePng.data[idx + 2] = 255;
      }
    }
    const clonePath = await writeShot('ignore-clone.png', clonePng);

    const result = await runComprehensiveDiff({
      originalScreenshots: [{ viewport: 'desktop', path: origPath }],
      cloneScreenshots: [{ viewport: 'desktop', path: clonePath }],
      sections: [],
      ignoreRegions: [{ x: 0, y: 0, width: 5, height: 5, reason: 'test' }],
      outputDir: path.join(tmpDir, 'ignore-out'),
    });

    expect(result.ignoreRegionsApplied).toBe(1);
    expect(result.overall.pixelmatch).toBeGreaterThan(99);
  });

  it('calls scoreWithVision and includes overall.vision when enableVision is true', async () => {
    const origPath = await writeShot('vision-orig.png', solidPng(10, 10, 1, 1, 1));
    const clonePath = await writeShot('vision-clone.png', solidPng(10, 10, 1, 1, 1));

    const result = await runComprehensiveDiff({
      originalScreenshots: [{ viewport: 'desktop', path: origPath }],
      cloneScreenshots: [{ viewport: 'desktop', path: clonePath }],
      sections: [],
      outputDir: path.join(tmpDir, 'vision-out'),
      enableVision: true,
      scoreWithVision: async () => 87,
    });

    expect(result.overall.vision).toBe(87);
  });
});
