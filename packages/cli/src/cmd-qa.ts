/**
 * elconv qa — Visual QA comparison between deployed page and reference.
 * Uses viewport-matrix, structural-probes, and healing-loop from @elconv/qa.
 */

import path from 'node:path';
import { optionalFlag } from './args.js';
import { runCanonicalLiveDiff } from '@elconv/qa';

export interface QaOptions {
  url: string;
  refUrl?: string;
  section?: string;
  viewports?: number[];
  targetScore?: number;
  maxIterations?: number;
  outputDir?: string;
}

export interface QaReport {
  url: string;
  refUrl?: string;
  overallScore: number;
  targetScore: number;
  passed: boolean;
  viewports: { label: string; width: number; score: number | null }[];
  issues: { region: string; severity: string; description: string }[];
  healingApplied: boolean;
  healingIterations: number;
  timestamp: string;
}

const DEFAULT_VIEWPORTS = [
  { label: 'desktop', width: 1440 },
  { label: 'tablet', width: 768 },
  { label: 'mobile', width: 390 },
];

export async function cmdQa(flags: Record<string, string | boolean>): Promise<number> {
  const url = optionalFlag(flags, 'url');
  const refUrl = optionalFlag(flags, 'ref-url');
  const section = optionalFlag(flags, 'section');
  const targetScore = Number(optionalFlag(flags, 'target-score') ?? '85');
  const maxIterations = Number(optionalFlag(flags, 'max-iterations') ?? '3');
  const outputDir = optionalFlag(flags, 'output') ?? './qa-output';

  if (!url) {
    process.stderr.write('Error: --url is required for QA\n');
    return 2;
  }

  process.stdout.write(`\n🔍 QA Visual Diff\n`);
  process.stdout.write(`  Target URL:    ${url}\n`);
  if (refUrl) process.stdout.write(`  Reference:     ${refUrl}\n`);
  if (section) process.stdout.write(`  Section:       ${section}\n`);
  process.stdout.write(`  Target Score:  ${targetScore}\n`);
  process.stdout.write(`  Viewports:     ${DEFAULT_VIEWPORTS.map((v) => v.width).join(', ')}px\n`);
  process.stdout.write(`  Max Iterations: ${maxIterations}\n`);
  process.stdout.write(`  Output:        ${outputDir}\n\n`);

  const report = await runQaPipeline({
    url,
    refUrl: refUrl ?? undefined,
    section: section ?? undefined,
    targetScore,
    maxIterations,
    outputDir,
  });

  process.stdout.write(`  Results:\n`);
  for (const vp of report.viewports) {
    if (vp.score === null) {
      process.stdout.write(`    ⏭️  ${vp.label} (${vp.width}px): not scored\n`);
      continue;
    }
    const icon = vp.score >= targetScore ? '✅' : '❌';
    process.stdout.write(`    ${icon} ${vp.label} (${vp.width}px): score ${vp.score}\n`);
  }
  process.stdout.write(`\n  Overall Score: ${report.overallScore}/${targetScore}\n`);
  process.stdout.write(`  Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}\n`);

  if (report.issues.length > 0) {
    process.stdout.write(`\n  Issues (${report.issues.length}):\n`);
    for (const issue of report.issues.slice(0, 10)) {
      process.stdout.write(`    [${issue.severity}] ${issue.region}: ${issue.description}\n`);
    }
  }

  if (report.healingApplied) {
    process.stdout.write(`\n  Healing: ${report.healingIterations} iteration(s) applied\n`);
  }

  process.stdout.write(`\n`);
  return report.passed ? 0 : 1;
}

/**
 * Run the QA pipeline: capture → diff → report → optional healing.
 * Uses dynamic imports to avoid hard dependency on Playwright at CLI startup.
 */
export async function runQaPipeline(options: QaOptions): Promise<QaReport> {
  const viewports = DEFAULT_VIEWPORTS;
  const targetScore = options.targetScore ?? 85;
  const viewportResults: { label: string; width: number; score: number | null }[] = [];
  const issues: { region: string; severity: string; description: string }[] = [];

  if (!options.refUrl) {
    // Visual fidelity is a comparison against a reference render. Without one
    // there is nothing to diff, so we do not fabricate a passing score.
    issues.push({
      region: 'all',
      severity: 'warning',
      description: 'No --ref-url provided — visual fidelity cannot be scored (capture-only run).',
    });
  }

  for (const vp of viewports) {
    const score = await captureAndDiff(
      options.url,
      options.refUrl,
      vp.width,
      vp.label === 'desktop' ? 900 : vp.label === 'tablet' ? 1024 : 844,
      options.outputDir ?? './qa-output',
    );
    viewportResults.push({ label: vp.label, width: vp.width, score });

    if (score !== null && score < targetScore) {
      issues.push({
        region: vp.label,
        severity: score < targetScore - 15 ? 'critical' : 'warning',
        description: `Score ${score} below target ${targetScore} at ${vp.width}px`,
      });
    }
  }

  const scored = viewportResults.filter(
    (v): v is { label: string; width: number; score: number } => v.score !== null,
  );
  const overallScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, v) => sum + v.score, 0) / scored.length)
      : 0;

  const passed = scored.length > 0 && overallScore >= targetScore;

  // Attempt healing if below target
  let healingApplied = false;
  let healingIterations = 0;
  if (
    !passed &&
    options.refUrl &&
    scored.length > 0 &&
    options.maxIterations &&
    options.maxIterations > 0
  ) {
    const healing = await attemptHealing(options, targetScore);
    healingApplied = healing.applied;
    healingIterations = healing.iterations;
  }

  return {
    url: options.url,
    refUrl: options.refUrl,
    overallScore,
    targetScore,
    passed,
    viewports: viewportResults,
    issues,
    healingApplied,
    healingIterations,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Blend pixel-level (pixelmatch) and structural (SSIM) match percentages into a
 * single 0–100 visual-fidelity score. SSIM is weighted higher because it tracks
 * perceived structural similarity and tolerates sub-pixel shifts, while
 * pixelmatch catches hard colour/content differences SSIM can under-weight.
 */
export function blendVisualScore(pixelMatchPercent: number, ssimMatchPercent: number): number {
  const blended = 0.6 * ssimMatchPercent + 0.4 * pixelMatchPercent;
  return Math.max(0, Math.min(100, Math.round(blended)));
}

/**
 * Capture the target (and, when supplied, the reference) at `width`, then
 * compute a real visual-fidelity score via pixelmatch + SSIM from @elconv/qa.
 *
 * Returns `null` when no score can be computed honestly — either no reference
 * URL was given (nothing to diff against) or Playwright/the capture failed.
 * Callers MUST treat `null` as "unscored", never as a passing value.
 */
async function captureAndDiff(
  url: string,
  refUrl: string | undefined,
  width: number,
  height: number,
  outputDir: string,
): Promise<number | null> {
  if (!refUrl) return null; // no reference → no comparison possible
  try {
    const label = width >= 1200 ? 'desktop' : width >= 600 ? 'tablet' : 'mobile';
    const viewportOutputDir = path.join(outputDir, label);
    const result = await runCanonicalLiveDiff({
      sourceUrl: refUrl,
      targetUrl: url,
      outputDir: viewportOutputDir,
      viewports: [{ label, width, height }],
      fullPage: true,
      timeoutMs: 45_000,
    });
    if (result.status !== 'scored' || !result.diff) return null;
    return blendVisualScore(result.diff.overall.pixelmatch, result.diff.overall.ssim);
  } catch {
    // The canonical wrapper should normally convert capture failures to
    // not-scored; keep this boundary defensive for filesystem/diff failures.
    return null;
  }
}

/**
 * Attempt healing loop to improve score.
 */
async function attemptHealing(
  options: QaOptions,
  targetScore: number,
): Promise<{ applied: boolean; iterations: number }> {
  try {
    const { runHealingLoop } = await import('@elconv/qa');
    const outputDir = path.join(options.outputDir ?? './qa-output', 'desktop');
    const report = await runHealingLoop({
      referencePath: `${outputDir}/desktop-source.png`,
      clonePath: `${outputDir}/desktop-target.png`,
      outputDir,
      targetScore,
      maxIterations: options.maxIterations ?? 3,
    });
    return { applied: report.totalIterations > 0, iterations: report.totalIterations };
  } catch {
    return { applied: false, iterations: 0 };
  }
}
