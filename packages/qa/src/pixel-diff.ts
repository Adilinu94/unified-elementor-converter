import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { resizeToSameSize } from './diff/dimensions.js';

export interface DiffOptions {
  originalPath: string;
  clonePath: string;
  outputDiffPath?: string;
  threshold?: number;
  includeAntiAliasing?: boolean;
}

export interface DiffResult {
  originalPath: string;
  clonePath: string;
  width: number;
  height: number;
  totalPixels: number;
  diffPixels: number;
  diffPercent: number;
  matchPercent: number;
  diffPath?: string;
  computedAt: string;
}

const DEFAULT_THRESHOLD = 0.1;

export async function diffScreenshots(
  options: DiffOptions,
): Promise<DiffResult> {
  const original = PNG.sync.read(fs.readFileSync(options.originalPath));
  const clone = PNG.sync.read(fs.readFileSync(options.clonePath));

  let img1: PNG = original;
  let img2: PNG = clone;
  if (original.width !== clone.width || original.height !== clone.height) {
    // Bugfix #1 (UMBAUPLAN.md §5): resize instead of reporting a hardcoded
    // 100% mismatch — dimension differences alone don't mean the clone is wrong.
    [img1, img2] = await resizeToSameSize(original, clone);
  }

  const { width, height } = img1;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    img1.data,
    img2.data,
    diff.data,
    width,
    height,
    {
      threshold: options.threshold ?? DEFAULT_THRESHOLD,
      includeAA: options.includeAntiAliasing ?? false,
    },
  );

  if (options.outputDiffPath) {
    fs.mkdirSync(path.dirname(options.outputDiffPath), { recursive: true });
    fs.writeFileSync(options.outputDiffPath, PNG.sync.write(diff));
  }

  const totalPixels = width * height;
  const diffPercent = (diffPixels / totalPixels) * 100;
  return {
    originalPath: options.originalPath,
    clonePath: options.clonePath,
    width,
    height,
    totalPixels,
    diffPixels,
    diffPercent,
    matchPercent: 100 - diffPercent,
    diffPath: options.outputDiffPath,
    computedAt: new Date().toISOString(),
  };
}

export function classifyMatch(percent: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (percent >= 95) return 'excellent';
  if (percent >= 85) return 'good';
  if (percent >= 70) return 'fair';
  return 'poor';
}
