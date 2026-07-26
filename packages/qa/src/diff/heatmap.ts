/**
 * heatmap.ts — Modul V1.6 (UMBAUPLAN.md §6).
 *
 * Overlays a pixelmatch diff image on top of the original screenshot,
 * producing a single PNG that visually highlights where the clone differs.
 *
 * Note: UMBAUPLAN.md's example passed `opacity` into sharp's
 * `composite()` options — that option doesn't exist in sharp's API
 * (checked node_modules/sharp/lib/index.d.ts's OverlayOptions). Instead,
 * we scale the diff image's own alpha channel before compositing, which
 * achieves the same "translucent overlay" effect sharp actually supports.
 */

import sharp from 'sharp';
import { PNG } from 'pngjs';

const DEFAULT_OVERLAY_ALPHA = 160; // 0-255

/**
 * Composites `diffPng` (ideally produced with pixelmatch's `diffMask: true`,
 * so only differing pixels are opaque) over the original screenshot at
 * `overlayAlpha` opacity, and writes the result to `outputPath`.
 */
export async function generateHeatmap(
  originalPath: string,
  diffPng: PNG,
  outputPath: string,
  overlayAlpha: number = DEFAULT_OVERLAY_ALPHA,
): Promise<void> {
  const translucent = new PNG({ width: diffPng.width, height: diffPng.height });
  for (let i = 0; i < diffPng.data.length; i += 4) {
    translucent.data[i] = diffPng.data[i];
    translucent.data[i + 1] = diffPng.data[i + 1];
    translucent.data[i + 2] = diffPng.data[i + 2];
    translucent.data[i + 3] = Math.round((diffPng.data[i + 3] / 255) * overlayAlpha);
  }

  const overlayBuffer = PNG.sync.write(translucent);
  await sharp(originalPath)
    .composite([{ input: overlayBuffer, blend: 'over' }])
    .png()
    .toFile(outputPath);
}
