/**
 * dimensions.ts — Bugfix #1 (UMBAUPLAN.md §5) + Modul V1.1.
 *
 * Original bug: src/qa/visual-diff.ts and src/qa/ssim.ts short-circuited
 * on any dimension mismatch by either reporting a hardcoded 100% diff, or
 * cropping both images down to their shared minimum size. Both approaches
 * corrupt the score whenever screenshots differ in size for legitimate
 * reasons (browser zoom, responsive capture, DPR differences).
 *
 * Fix: resize the smaller image up to match the larger one (via sharp,
 * fit: 'fill') so pixelmatch/ssim always compare same-size buffers.
 */

import { PNG } from 'pngjs';
import sharp from 'sharp';

/**
 * Resizes both PNGs to the larger width/height found across the pair
 * (per axis), so pixelmatch/ssim can compare them 1:1. Returns the
 * inputs unchanged (same references) if they already match.
 */
export async function resizeToSameSize(pngA: PNG, pngB: PNG): Promise<[PNG, PNG]> {
  const targetW = Math.max(pngA.width, pngB.width);
  const targetH = Math.max(pngA.height, pngB.height);

  if (
    pngA.width === targetW &&
    pngA.height === targetH &&
    pngB.width === targetW &&
    pngB.height === targetH
  ) {
    return [pngA, pngB];
  }

  const [bufA, bufB] = await Promise.all([
    sharp(PNG.sync.write(pngA)).resize(targetW, targetH, { fit: 'fill' }).png().toBuffer(),
    sharp(PNG.sync.write(pngB)).resize(targetW, targetH, { fit: 'fill' }).png().toBuffer(),
  ]);

  return [PNG.sync.read(bufA), PNG.sync.read(bufB)];
}

/**
 * Crops a sub-region out of a PNG, clamping the requested rectangle to the
 * image bounds instead of throwing (used by block-diff.ts to slice out
 * sections by y_range, which may run slightly past the captured screenshot
 * on short pages).
 */
export function cropPngSafe(png: PNG, x: number, y: number, w: number, h: number): PNG {
  const clampedX = Math.max(0, Math.min(x, png.width));
  const clampedY = Math.max(0, Math.min(y, png.height));
  const clampedW = Math.max(1, Math.min(w, png.width - clampedX));
  const clampedH = Math.max(1, Math.min(h, png.height - clampedY));

  const out = new PNG({ width: clampedW, height: clampedH });
  for (let row = 0; row < clampedH; row++) {
    for (let col = 0; col < clampedW; col++) {
      const srcIdx = ((clampedY + row) * png.width + (clampedX + col)) * 4;
      const dstIdx = (row * clampedW + col) * 4;
      out.data[dstIdx] = png.data[srcIdx];
      out.data[dstIdx + 1] = png.data[srcIdx + 1];
      out.data[dstIdx + 2] = png.data[srcIdx + 2];
      out.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return out;
}
