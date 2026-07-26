import { promises as fs } from 'node:fs';
import path from 'node:path';
import { diffScreenshots, type DiffResult } from './visual-diff.js';
import { captureScreenshot, type CaptureResult } from './visual-capture.js';

export interface AcceptanceOptions {
  originalUrl: string;
  cloneUrl: string;
  outputDir: string;
  minAcceptableScore?: number;
  captureBoth?: boolean;
}

export interface AcceptanceReport {
  verdict: 'pass' | 'fail' | 'warning';
  score: number;
  matchPercent: number;
  originalCapture: CaptureResult;
  cloneCapture: CaptureResult;
  diffResult: DiffResult;
  recommendations: string[];
  generatedAt: string;
}

const DEFAULT_MIN_SCORE = 0.85;

export function generateRecommendations(
  diff: DiffResult,
  minScore: number,
): string[] {
  const recs: string[] = [];
  if (diff.diffPercent > (1 - minScore) * 100) {
    recs.push(`Visual match ${diff.matchPercent.toFixed(2)}% is below threshold ${(minScore * 100).toFixed(0)}% — review missing assets or layout differences.`);
  }
  if (diff.width === 0 || diff.height === 0) {
    recs.push('One of the screenshots has zero dimensions — check viewport configuration.');
  }
  if (diff.diffPercent === 100) {
    recs.push('Complete visual mismatch — clone may not be deployed yet, or wrong page URL.');
  }
  if (diff.diffPercent < 5) {
    recs.push('Excellent visual match. Consider promoting to production.');
  } else if (recs.length === 0) {
    recs.push(`Acceptable match (${diff.matchPercent.toFixed(2)}%). Fine-tune specific elements if needed.`);
  }
  return recs;
}

export async function runAcceptance(
  options: AcceptanceOptions,
): Promise<AcceptanceReport> {
  const min = options.minAcceptableScore ?? DEFAULT_MIN_SCORE;
  await fs.mkdir(options.outputDir, { recursive: true });

  const originalCapture = await captureScreenshot({
    url: options.originalUrl,
    outputPath: path.join(options.outputDir, 'original.png'),
    fullPage: true,
  });

  const cloneCapture = await captureScreenshot({
    url: options.cloneUrl,
    outputPath: path.join(options.outputDir, 'clone.png'),
    fullPage: true,
  });

  const diff = await diffScreenshots({
    originalPath: originalCapture.outputPath,
    clonePath: cloneCapture.outputPath,
    outputDiffPath: path.join(options.outputDir, 'diff.png'),
  });

  const score = 1 - diff.diffPercent / 100;
  const verdict: 'pass' | 'fail' | 'warning' =
    score >= min ? 'pass' : score >= min - 0.1 ? 'warning' : 'fail';

  const report: AcceptanceReport = {
    verdict,
    score,
    matchPercent: diff.matchPercent,
    originalCapture,
    cloneCapture,
    diffResult: diff,
    recommendations: generateRecommendations(diff, min),
    generatedAt: new Date().toISOString(),
  };

  const reportPath = path.join(options.outputDir, 'acceptance-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

export async function summarizeBatch(
  reports: AcceptanceReport[],
): Promise<{
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  averageScore: number;
}> {
  const total = reports.length;
  const passed = reports.filter((r) => r.verdict === 'pass').length;
  const failed = reports.filter((r) => r.verdict === 'fail').length;
  const warnings = reports.filter((r) => r.verdict === 'warning').length;
  const averageScore = total > 0
    ? reports.reduce((sum, r) => sum + r.score, 0) / total
    : 0;
  return { total, passed, failed, warnings, averageScore };
}
