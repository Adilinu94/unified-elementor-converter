/**
 * multi-viewport.ts — Modul V1.4 (UMBAUPLAN.md §6).
 *
 * Aggregates a block-diff run across all captured viewports, so a clone
 * that looks fine on desktop but breaks on mobile doesn't get a passing
 * overall score.
 */

import fs from 'node:fs';
import { PNG } from 'pngjs';
import type { SectionInfo } from '@elconv/extractors';
import type { ViewportScreenshot } from '@elconv/core';
import type { BlockDiffResult, MultiViewportReport } from '@elconv/core';
import { resizeToSameSize } from './dimensions.js';
import { diffByBlocks } from './block-diff.js';

export type { MultiViewportReport };

export const VIEWPORT_PRESETS: Record<'mobile' | 'tablet' | 'desktop' | 'wide', { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
  wide: { width: 1920, height: 1080 },
};

const VIEWPORT_ORDER = ['mobile', 'tablet', 'desktop', 'wide'] as const;

function fullPageSection(png: PNG): SectionInfo {
  return { section_id: 'full-page', selector: 'body', y_range: [0, png.height], layout: 'unknown', child_count: 0 };
}

/**
 * Runs diffByBlocks() once per matched viewport (original+clone screenshot
 * pair present for that viewport name), then aggregates into one report.
 */
export async function diffMultiViewport(
  originalShots: ViewportScreenshot[],
  cloneShots: ViewportScreenshot[],
  sections: SectionInfo[],
): Promise<MultiViewportReport> {
  const perViewport: MultiViewportReport['perViewport'] = {};

  for (const viewport of VIEWPORT_ORDER) {
    const orig = originalShots.find((s) => s.viewport === viewport);
    const clone = cloneShots.find((s) => s.viewport === viewport);
    if (!orig || !clone) continue;

    const origPng = PNG.sync.read(fs.readFileSync(orig.path));
    const clonePng = PNG.sync.read(fs.readFileSync(clone.path));
    const [a, b] = await resizeToSameSize(origPng, clonePng);

    const effectiveSections = sections.length > 0 ? sections : [fullPageSection(a)];
    const blockResults: BlockDiffResult[] = await diffByBlocks(a, b, effectiveSections);
    const score = blockResults.reduce((sum, r) => sum + r.score, 0) / blockResults.length;

    perViewport[viewport] = { score, blockResults };
  }

  const entries = Object.entries(perViewport);
  const scores = entries.map(([, v]) => v.score);
  const sortedByScore = [...entries].sort((x, y) => x[1].score - y[1].score);

  return {
    perViewport,
    aggregatedScore: scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0,
    worstViewport: sortedByScore[0]?.[0],
    bestViewport: sortedByScore[sortedByScore.length - 1]?.[0],
  };
}
