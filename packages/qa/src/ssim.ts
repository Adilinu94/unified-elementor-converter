import fs from 'node:fs';
import { PNG } from 'pngjs';
import { ssim } from 'ssim.js';
import { resizeToSameSize } from './diff/dimensions.js';

export interface SsimOptions {
  originalPath: string;
  clonePath: string;
}

export interface SsimResult {
  originalPath: string;
  clonePath: string;
  width: number;
  height: number;
  mssim: number;
  matchPercent: number;
  computedAt: string;
}

export async function computeSsim(options: SsimOptions): Promise<SsimResult> {
  const original = PNG.sync.read(await fs.promises.readFile(options.originalPath));
  const clone = PNG.sync.read(await fs.promises.readFile(options.clonePath));

  if (original.width === 0 || original.height === 0 || clone.width === 0 || clone.height === 0) {
    return {
      originalPath: options.originalPath,
      clonePath: options.clonePath,
      width: Math.min(original.width, clone.width),
      height: Math.min(original.height, clone.height),
      mssim: 0,
      matchPercent: 0,
      computedAt: new Date().toISOString(),
    };
  }

  if (original.width !== clone.width || original.height !== clone.height) {
    // Bugfix #1 (UMBAUPLAN.md §5): resize instead of cropping to the
    // shared minimum size — cropping discards real content and can make a
    // correct clone look wrong just because it was captured at a
    // different size.
    const [resizedOriginal, resizedClone] = await resizeToSameSize(original, clone);
    return runSsim(resizedOriginal, resizedClone, options, resizedOriginal.width, resizedOriginal.height);
  }

  return runSsim(original, clone, options, original.width, original.height);
}

function runSsim(
  original: PNG,
  clone: PNG,
  options: SsimOptions,
  width: number,
  height: number,
): SsimResult {
  const a = toImageData(original);
  const b = toImageData(clone);
  const result = ssim(a, b);
  const matchPercent = Math.max(0, Math.min(100, result.mssim * 100));
  return {
    originalPath: options.originalPath,
    clonePath: options.clonePath,
    width,
    height,
    mssim: result.mssim,
    matchPercent,
    computedAt: new Date().toISOString(),
  };
}

function toImageData(png: PNG): { data: Uint8ClampedArray; width: number; height: number } {
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    width: png.width,
    height: png.height,
  };
}

export function classifySsim(percent: number): 'near-identical' | 'similar' | 'different' | 'mismatch' {
  if (percent >= 95) return 'near-identical';
  if (percent >= 85) return 'similar';
  if (percent >= 70) return 'different';
  return 'mismatch';
}
