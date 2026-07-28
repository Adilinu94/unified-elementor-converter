import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { IssueType, IssueSeverity } from '@elconv/core';
import { diffScreenshots, type DiffResult } from './pixel-diff.js';

export type { IssueType };

export interface Issue {
  type: IssueType;
  severity: IssueSeverity;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  diffPixels: number;
  description: string;
  suggestedFix: string;
}

export interface DetectionOptions {
  originalPath: string;
  clonePath: string;
  diffPath?: string;
  expectedWidth?: number;
  expectedHeight?: number;
  regionMinSize?: number;
  regionThreshold?: number;
}

export interface DetectionResult {
  diff: DiffResult;
  issues: Issue[];
  regionsDetected: number;
  classifiedAt: string;
}

export async function detectIssues(options: DetectionOptions): Promise<DetectionResult> {
  const diff = await diffScreenshots({
    originalPath: options.originalPath,
    clonePath: options.clonePath,
    outputDiffPath: options.diffPath,
    threshold: options.regionThreshold ?? 0.1,
  });

  const issues: Issue[] = [];

  if (diff.width !== options.expectedWidth || diff.height !== options.expectedHeight) {
    if (options.expectedWidth !== undefined && options.expectedHeight !== undefined) {
      issues.push({
        type: 'size-different',
        severity: 'high',
        region: { x: 0, y: 0, width: diff.width, height: diff.height },
        diffPixels: diff.diffPixels,
        description: `Screenshot dimensions ${diff.width}x${diff.height} differ from expected ${options.expectedWidth}x${options.expectedHeight}`,
        suggestedFix: 'Verify viewport settings and ensure clone page renders at the expected size.',
      });
    }
  }

  if (diff.diffPercent === 100) {
    issues.push({
      type: 'blank-region',
      severity: 'high',
      region: { x: 0, y: 0, width: diff.width, height: diff.height },
      diffPixels: diff.diffPixels,
      description: 'Complete visual mismatch (100% diff) — clone may not be deployed or wrong page URL',
      suggestedFix: 'Verify the target URL is reachable, the page is published, and Elementor data is set.',
    });
    return { diff, issues, regionsDetected: 0, classifiedAt: new Date().toISOString() };
  }

  const regions = await detectDiffRegions(options.originalPath, options.clonePath, options.regionMinSize ?? 32);

  for (const region of regions) {
    const issue = classifyRegion(region, diff);
    if (issue) {
      issues.push(issue);
    }
  }

  return {
    diff,
    issues,
    regionsDetected: regions.length,
    classifiedAt: new Date().toISOString(),
  };
}

interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  diffPixels: number;
  avgColorOriginal: [number, number, number];
  avgColorClone: [number, number, number];
  textHeuristic: boolean;
  uniformHeuristic: boolean;
  blankHeuristic: boolean;
  /** True when the original region has real internal variation (texture/photo)
   *  but the clone region is essentially a flat, uniform color — e.g. a
   *  background-image that was approximated with (or silently dropped to)
   *  a solid color. Complements uniformHeuristic, which only measures
   *  cross-image pixel similarity, not intra-image texture. */
  flatColorHeuristic: boolean;
}

async function detectDiffRegions(
  originalPath: string,
  clonePath: string,
  minSize: number,
): Promise<DiffRegion[]> {
  const original = PNG.sync.read(await fs.readFile(originalPath));
  const clone = PNG.sync.read(await fs.readFile(clonePath));

  const width = Math.min(original.width, clone.width);
  const height = Math.min(original.height, clone.height);

  const cellSize = Math.max(minSize, 16);
  const regions: DiffRegion[] = [];

  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      const w = Math.min(cellSize, width - x);
      const h = Math.min(cellSize, height - y);
      const region = computeRegionStats(original, clone, x, y, w, h);
      if (region.diffPixels > (w * h) * 0.3) {
        regions.push(region);
      }
    }
  }

  return mergeAdjacentRegions(regions, width, height);
}

function computeRegionStats(
  original: PNG,
  clone: PNG,
  x: number,
  y: number,
  w: number,
  h: number,
): DiffRegion {
  let diffPixels = 0;
  let rO = 0, gO = 0, bO = 0;
  let rC = 0, gC = 0, bC = 0;
  let pixelCount = 0;
  let textLike = 0;
  let uniformPixels = 0;
  let blankPixels = 0;
  let lumaOSum = 0, lumaOSumSq = 0;
  let lumaCSum = 0, lumaCSumSq = 0;

  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const idx = (row * original.width + col) * 4;
      const r1 = original.data[idx];
      const g1 = original.data[idx + 1];
      const b1 = original.data[idx + 2];
      const r2 = clone.data[idx];
      const g2 = clone.data[idx + 1];
      const b2 = clone.data[idx + 2];
      const dr = Math.abs(r1 - r2);
      const dg = Math.abs(g1 - g2);
      const db = Math.abs(b1 - b2);
      const sum = dr + dg + db;
      if (sum > 30) {
        diffPixels++;
      }
      rO += r1;
      gO += g1;
      bO += b1;
      rC += r2;
      gC += g2;
      bC += b2;
      pixelCount++;

      const luminanceO = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
      const luminanceC = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
      lumaOSum += luminanceO;
      lumaOSumSq += luminanceO * luminanceO;
      lumaCSum += luminanceC;
      lumaCSumSq += luminanceC * luminanceC;

      const lumaDiff = Math.abs(luminanceO - luminanceC);
      if (lumaDiff > 50 && Math.max(dr, dg, db) < 100) {
        textLike++;
      }
      if (dr < 15 && dg < 15 && db < 15) {
        uniformPixels++;
      }
      if (r1 > 245 && g1 > 245 && b1 > 245 && (r2 < 50 || g2 < 50 || b2 < 50)) {
        blankPixels++;
      }
    }
  }

  const meanLumaO = lumaOSum / pixelCount;
  const meanLumaC = lumaCSum / pixelCount;
  const stddevO = Math.sqrt(Math.max(0, lumaOSumSq / pixelCount - meanLumaO * meanLumaO));
  const stddevC = Math.sqrt(Math.max(0, lumaCSumSq / pixelCount - meanLumaC * meanLumaC));

  return {
    x,
    y,
    width: w,
    height: h,
    diffPixels,
    avgColorOriginal: [rO / pixelCount, gO / pixelCount, bO / pixelCount],
    avgColorClone: [rC / pixelCount, gC / pixelCount, bC / pixelCount],
    textHeuristic: textLike / pixelCount > 0.4,
    uniformHeuristic: uniformPixels / pixelCount > 0.6,
    blankHeuristic: blankPixels / pixelCount > 0.5,
    // Original has real texture (photo/gradient/noise) but clone is nearly flat.
    // Thresholds picked so two matching flat regions (e.g. both plain white)
    // never trigger this — it only fires on a clear texture-to-flat drop.
    flatColorHeuristic: stddevO > 20 && stddevC < 8,
  };
}

function mergeAdjacentRegions(regions: DiffRegion[], width: number, height: number): DiffRegion[] {
  if (regions.length === 0) return regions;
  const merged: DiffRegion[] = [regions[0]];
  for (let i = 1; i < regions.length; i++) {
    const last = merged[merged.length - 1];
    const current = regions[i];
    if (current.x === last.x && current.y === last.y + last.height) {
      last.height += current.height;
      last.diffPixels += current.diffPixels;
    } else {
      merged.push(current);
    }
  }
  return merged.filter((r) => r.x < width && r.y < height);
}

function classifyRegion(region: DiffRegion, diff: DiffResult): Issue | null {
  if (region.diffPixels === 0) return null;

  if (region.blankHeuristic) {
    return {
      type: 'image-broken',
      severity: 'high',
      region: { x: region.x, y: region.y, width: region.width, height: region.height },
      diffPixels: region.diffPixels,
      description: `Possible broken image at (${region.x},${region.y}) — clone is blank where original has content`,
      suggestedFix: 'Verify media attachment exists, has correct URL, and image-src.id is set in V3 element settings.',
    };
  }

  if (region.flatColorHeuristic) {
    return {
      type: 'missing-texture',
      severity: 'high',
      region: { x: region.x, y: region.y, width: region.width, height: region.height },
      diffPixels: region.diffPixels,
      description: `Original has textured/photographic content at (${region.x},${region.y}) but clone is a flat, uniform color — a background-image was likely approximated with (or silently dropped to) a solid fill`,
      suggestedFix: 'Check that background_image (not just background_color) is set on the corresponding container/section in the built tree, and that the source URL resolved during extraction.',
    };
  }

  if (region.textHeuristic) {
    return {
      type: 'font-missing',
      severity: 'medium',
      region: { x: region.x, y: region.y, width: region.width, height: region.height },
      diffPixels: region.diffPixels,
      description: `Text rendering differs at (${region.x},${region.y}) — font-family or font-size mismatch likely`,
      suggestedFix: 'Verify font-family is registered in Fonts-Plugin or V3 kit. Check typography_font_family setting.',
    };
  }

  const [rO, gO, bO] = region.avgColorOriginal;
  const [rC, gC, bC] = region.avgColorClone;
  const colorDelta = Math.abs(rO - rC) + Math.abs(gO - gC) + Math.abs(bO - bC);

  if (colorDelta > 60 && region.uniformHeuristic) {
    return {
      type: 'color-mismatch',
      severity: colorDelta > 150 ? 'high' : 'medium',
      region: { x: region.x, y: region.y, width: region.width, height: region.height },
      diffPixels: region.diffPixels,
      description: `Color difference Δ=${colorDelta.toFixed(0)} at (${region.x},${region.y}) — token mapping likely wrong`,
      suggestedFix: 'Check design-token-mapping.json: original color should map to V3 Global Color ID.',
    };
  }

  if (region.width < 80 && region.height < 80) {
    return {
      type: 'size-mismatch',
      severity: 'low',
      region: { x: region.x, y: region.y, width: region.width, height: region.height },
      diffPixels: region.diffPixels,
      description: `Small region diff at (${region.x},${region.y}) — possible icon/glyph rendering issue`,
      suggestedFix: 'Check icon font registration or SVG element fidelity.',
    };
  }

  if (region.height > 200 && region.width > width(diff) * 0.5) {
    return {
      type: 'layout-shift',
      severity: 'medium',
      region: { x: region.x, y: region.y, width: region.width, height: region.height },
      diffPixels: region.diffPixels,
      description: `Wide horizontal diff at y=${region.y} — possible layout/flex-direction issue`,
      suggestedFix: 'Check Elementor section padding/margin and flex_direction settings.',
    };
  }

  return {
    type: 'color-mismatch',
    severity: 'low',
    region: { x: region.x, y: region.y, width: region.width, height: region.height },
    diffPixels: region.diffPixels,
    description: `Generic diff at (${region.x},${region.y}) Δcolor=${colorDelta.toFixed(0)}`,
    suggestedFix: 'Inspect manually; consider more specific region classifier.',
  };
}

function width(diff: DiffResult): number {
  return diff.width;
}

export async function writeIssuesJson(issues: Issue[], outputPath: string): Promise<string> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(issues, null, 2), 'utf-8');
  return outputPath;
}

export function countBySeverity(issues: Issue[]): Record<IssueSeverity, number> {
  return {
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
  };
}

export function countByType(issues: Issue[]): Record<IssueType, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    counts[issue.type] = (counts[issue.type] ?? 0) + 1;
  }
  return counts as Record<IssueType, number>;
}
