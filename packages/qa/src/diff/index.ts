/**
 * index.ts — Modul V1.8 (UMBAUPLAN.md §6): barrel + `runComprehensiveDiff()`.
 *
 * Single public entrypoint tying the other 7 sub-modules together:
 * resize-to-match → optional ignore-region masking → per-section block
 * diff (+hotspots) → SSIM → optional multi-viewport aggregation ->
 * optional heatmap → JSON report on disk.
 */

export * from './dimensions.js';
export * from './ignore-regions.js';
export * from './block-diff.js';
export * from './multi-viewport.js';
export * from './animated-disable.js';
export * from './heatmap.js';
export * from './color-distance.js';

import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { SectionInfo } from '@elconv/extractors';
import type { BBox } from '@elconv/core';
import type { BlockDiffResult, ComprehensiveDiffResult, RunComprehensiveDiffFn } from '@elconv/core';
import { resizeToSameSize } from './dimensions.js';
import { applyIgnoreMask } from './ignore-regions.js';
import { diffByBlocks } from './block-diff.js';
import { diffMultiViewport } from './multi-viewport.js';
import { generateHeatmap } from './heatmap.js';
import { computeSsim } from '../ssim.js';

export const DEFAULT_THRESHOLD = 0.15;
export const DEFAULT_AA_TOLERANCE = false;
export const DEFAULT_SNAP_DISTANCE = 0.1;

function fullPageSection(height: number): SectionInfo {
  return { section_id: 'full-page', selector: 'body', y_range: [0, height], layout: 'unknown', child_count: 0 };
}

export const runComprehensiveDiff: RunComprehensiveDiffFn = async (options) => {
  const {
    originalScreenshots,
    cloneScreenshots,
    sections,
    ignoreRegions = [],
    enableVision = false,
    scoreWithVision,
    outputDir,
    generateHeatmap: shouldGenerateHeatmap = false,
  } = options;

  await fs.mkdir(outputDir, { recursive: true });

  const primary = originalScreenshots.find((s) => s.viewport === 'desktop') ?? originalScreenshots[0];
  const primaryClone = primary
    ? (cloneScreenshots.find((s) => s.viewport === primary.viewport) ?? cloneScreenshots[0])
    : undefined;

  let pixelmatchScore = 0;
  let ssimScore = 0;
  let perSection: BlockDiffResult[] = [];
  let diffHeatmapPath: string | undefined;
  let topHotspots: BBox[] = [];

  if (primary && primaryClone) {
    let origPng: PNG = PNG.sync.read(await fs.readFile(primary.path));
    let clonePng: PNG = PNG.sync.read(await fs.readFile(primaryClone.path));
    [origPng, clonePng] = await resizeToSameSize(origPng, clonePng);

    if (ignoreRegions.length > 0) {
      origPng = applyIgnoreMask(origPng, ignoreRegions);
      clonePng = applyIgnoreMask(clonePng, ignoreRegions);
    }

    const effectiveSections = sections.length > 0 ? sections : [fullPageSection(origPng.height)];
    perSection = await diffByBlocks(origPng, clonePng, effectiveSections, { threshold: DEFAULT_THRESHOLD });
    pixelmatchScore = perSection.reduce((sum, r) => sum + r.score, 0) / perSection.length;
    topHotspots = perSection.flatMap((r) => r.hotspots).slice(0, 3);

    const ssimResult = await computeSsim({ originalPath: primary.path, clonePath: primaryClone.path });
    ssimScore = ssimResult.matchPercent;

    if (shouldGenerateHeatmap) {
      const diff = new PNG({ width: origPng.width, height: origPng.height });
      pixelmatch(origPng.data, clonePng.data, diff.data, origPng.width, origPng.height, {
        threshold: DEFAULT_THRESHOLD,
        includeAA: DEFAULT_AA_TOLERANCE,
        diffMask: true,
      });
      diffHeatmapPath = path.join(outputDir, 'diff-heatmap.png');
      await generateHeatmap(primary.path, diff, diffHeatmapPath);
    }
  }

  let visionScore: number | undefined;
  if (enableVision && scoreWithVision && primary && primaryClone) {
    visionScore = await scoreWithVision({ originalPath: primary.path, clonePath: primaryClone.path });
  }

  const multiViewport =
    originalScreenshots.length > 1 ? await diffMultiViewport(originalScreenshots, cloneScreenshots, sections) : undefined;

  const perViewport: Record<string, number> = {};
  if (multiViewport) {
    for (const [viewport, result] of Object.entries(multiViewport.perViewport)) {
      perViewport[viewport] = result.score;
    }
  } else if (primary) {
    perViewport[primary.viewport] = pixelmatchScore;
  }

  const result: ComprehensiveDiffResult = {
    overall: {
      pixelmatch: pixelmatchScore,
      ssim: ssimScore,
      ...(visionScore !== undefined ? { vision: visionScore } : {}),
    },
    perSection,
    perViewport,
    ignoreRegionsApplied: ignoreRegions.length,
    ...(diffHeatmapPath ? { diffHeatmapPath } : {}),
    topHotspots,
    computedAt: new Date().toISOString(),
  };

  await fs.writeFile(path.join(outputDir, 'diff-report.json'), JSON.stringify(result, null, 2), 'utf-8');

  return result;
};
