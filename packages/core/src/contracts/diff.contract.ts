/**
 * diff.contract.ts — Public contract for the Visual Diff Engine (Modul V1).
 *
 * Portiert aus site-clone-to-v3/src/contracts/diff.contract.ts.
 * Monorepo-Anpassung: `SectionInfo` wird aus ./shared.contract.js importiert
 * (dort kanonisch definiert), statt aus dem Extractor — @elconv/core darf nicht
 * aus @elconv/extractors importieren. Andere Module MÜSSEN diese Typen von hier
 * importieren, nie aus konkreten Implementierungen unter @elconv/qa/diff/*.
 *
 * DI-Naht für die AI-Engine (Modul AI1): runComprehensiveDiff() akzeptiert
 * einen optionalen `scoreWithVision`-Callback (siehe VisionScoreFn) statt einer
 * harten Abhängigkeit auf ai.contract.ts's AIRouter.
 */

import type { BBox, ViewportScreenshot, SectionInfo } from './shared.contract.js';

/** A region to exclude from diffing (dynamic content: carousels, timestamps, ads). */
export interface IgnoreRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
}

/** Per-section diff result (Modul V1.3 — block-level diff). */
export interface BlockDiffResult {
  sectionId: string;
  sectionSelector: string;
  /** 0-100 match score for this section. */
  score: number;
  diffPixels: number;
  /** Top-N bounding boxes (in this block's own cropped coordinate space) with the most diff pixels. */
  hotspots: BBox[];
}

/** Aggregated result across all matched viewports (Modul V1.4). */
export interface MultiViewportReport {
  perViewport: Record<string, { score: number; blockResults: BlockDiffResult[] }>;
  aggregatedScore: number;
  worstViewport: string | undefined;
  bestViewport: string | undefined;
}

/** Full report produced by runComprehensiveDiff() (Modul V1.8). */
export interface ComprehensiveDiffResult {
  overall: {
    pixelmatch: number; // 0-100
    ssim: number; // 0-100
    vision?: number; // 0-100, only present if scoreWithVision was supplied and enableVision was true
  };
  perSection: BlockDiffResult[];
  perViewport: Record<string, number>;
  ignoreRegionsApplied: number;
  diffHeatmapPath?: string;
  topHotspots: BBox[];
  computedAt: string;
}

/** Optional vision-based scoring hook — see module docstring for why this
 *  exists instead of an AIRouter import. */
export type VisionScoreFn = (params: {
  originalPath: string;
  clonePath: string;
}) => Promise<number>;

/** Signature for the single public diff entrypoint (Modul V1.8). */
export type RunComprehensiveDiffFn = (options: {
  originalScreenshots: ViewportScreenshot[];
  cloneScreenshots: ViewportScreenshot[];
  sections: SectionInfo[];
  ignoreRegions?: IgnoreRegion[];
  enableVision?: boolean;
  scoreWithVision?: VisionScoreFn;
  outputDir: string;
  generateHeatmap?: boolean;
}) => Promise<ComprehensiveDiffResult>;

/**
 * Signature for cropping a single section out of a full-page screenshot,
 * returning the path to the cropped file (not a Buffer) — the real
 * consumer, healing-loop.ts's `gatherRepairContext()`, feeds this
 * path straight into `RepairBlockInput.originalScreenshotPath` /
 * `.cloneScreenshotPath` for the vision API to read from disk.
 */
export type CropSectionScreenshotFn = (
  screenshotPath: string,
  section: SectionInfo,
) => Promise<string>;
