/**
 * block-diff.ts — Modul V1.3 (UMBAUPLAN.md §6).
 *
 * Runs pixelmatch per-section instead of on the whole page, using each
 * SectionInfo's y_range to slice both screenshots, so a single badly-off
 * section doesn't get diluted into an acceptable-looking page-wide score.
 */

import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { SectionInfo } from '@elconv/extractors';
import type { BlockDiffResult } from '@elconv/core';
import type { BBox } from '@elconv/core';
import { resizeToSameSize, cropPngSafe } from './dimensions.js';

export type { BlockDiffResult };

const DEFAULT_BLOCK_THRESHOLD = 0.15;
const MAX_HOTSPOTS = 3;
const HOTSPOT_GRID = 8; // splits each block into an 8x8 grid to bucket diff pixels

export interface DiffByBlocksOptions {
  threshold?: number;
}

/** Runs a pixelmatch diff per-section, slicing both screenshots by each SectionInfo's y_range. */
export async function diffByBlocks(
  original: PNG,
  clone: PNG,
  sections: SectionInfo[],
  options?: DiffByBlocksOptions,
): Promise<BlockDiffResult[]> {
  const results: BlockDiffResult[] = [];

  for (const section of sections) {
    const [yTop, yBottom] = section.y_range;
    const blockHeight = Math.max(1, yBottom - yTop);
    const blockOriginal = cropPngSafe(original, 0, yTop, original.width, blockHeight);
    const blockClone = cropPngSafe(clone, 0, yTop, clone.width, blockHeight);
    const [a, b] = await resizeToSameSize(blockOriginal, blockClone);

    // diffMask: true → only actually-different pixels are drawn (opaque);
    // everything else stays fully transparent. That makes the diff image
    // usable both for hotspot bucketing (alpha>0 = diff pixel) and for a
    // clean heatmap overlay (see heatmap.ts) without a second pixelmatch pass.
    const diff = new PNG({ width: a.width, height: a.height });
    const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
      threshold: options?.threshold ?? DEFAULT_BLOCK_THRESHOLD,
      diffMask: true,
    });

    const totalPixels = a.width * a.height;
    results.push({
      sectionId: section.section_id,
      sectionSelector: section.selector,
      score: totalPixels === 0 ? 100 : Math.max(0, 100 - (diffPixels / totalPixels) * 100),
      diffPixels,
      hotspots: extractHotspots(diff),
    });
  }

  return results;
}

/**
 * Buckets a diffMask:true pixelmatch output into a coarse grid and returns
 * the top-N cells with the most diff pixels, as BBoxes in the block's own
 * (cropped) coordinate space.
 */
function extractHotspots(diff: PNG): BBox[] {
  const cellW = Math.max(1, Math.ceil(diff.width / HOTSPOT_GRID));
  const cellH = Math.max(1, Math.ceil(diff.height / HOTSPOT_GRID));
  const counts = new Map<string, number>();

  for (let y = 0; y < diff.height; y++) {
    for (let x = 0; x < diff.width; x++) {
      const idx = (diff.width * y + x) << 2;
      if (diff.data[idx + 3] === 0) continue; // transparent = not a diff pixel
      const cellX = Math.floor(x / cellW);
      const cellY = Math.floor(y / cellH);
      const key = `${cellX},${cellY}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_HOTSPOTS)
    .map(([key]) => {
      const [cellX, cellY] = key.split(',').map(Number);
      return {
        x: cellX * cellW,
        y: cellY * cellH,
        width: Math.min(cellW, diff.width - cellX * cellW),
        height: Math.min(cellH, diff.height - cellY * cellH),
      };
    });
}
