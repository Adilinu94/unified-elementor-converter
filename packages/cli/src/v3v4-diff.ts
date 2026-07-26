import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

import { captureScreenshot } from '../qa/visual-capture.js';
import { diffScreenshots } from '../qa/visual-diff.js';
import { computeSsim } from '../qa/ssim.js';
import { detectIssues } from '../qa/issue-detector.js';
import { generateV3V4HtmlReport, type V3V4Report, type ViewportReport } from '../qa/v3v4-report.js';

export interface V3V4DiffOptions {
  v3Url: string;
  v4Url: string;
  v3Label?: string;
  v4Label?: string;
  outputDir: string;
  viewports?: { label: string; width: number; height: number }[];
  autoOpen?: boolean;
}

const DEFAULT_VIEWPORTS = [
  { label: 'Desktop 1440', width: 1440, height: 900 },
  { label: 'Tablet 768', width: 768, height: 1024 },
  { label: 'Mobile 390', width: 390, height: 844 },
];

export async function runV3V4Diff(options: V3V4DiffOptions): Promise<string> {
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  fs.mkdirSync(options.outputDir, { recursive: true });

  console.log(chalk.cyan(`\n[V3V4-Diff] Comparing:`));
  console.log(chalk.gray(`  V3: ${options.v3Url}`));
  console.log(chalk.gray(`  V4: ${options.v4Url}`));
  console.log(chalk.gray(`  Output: ${options.outputDir}`));
  console.log(chalk.gray(`  Viewports: ${viewports.map(v => `${v.label} (${v.width}px)`).join(', ')}`));

  const viewportReports: ViewportReport[] = [];

  for (const vp of viewports) {
    console.log(chalk.yellow(`\n[${vp.label}] Capturing screenshots...`));

    const v3File = path.join(options.outputDir, `${vp.label.replace(/\s/g, '-').toLowerCase()}-v3.png`);
    const v4File = path.join(options.outputDir, `${vp.label.replace(/\s/g, '-').toLowerCase()}-v4.png`);
    const diffFile = path.join(options.outputDir, `${vp.label.replace(/\s/g, '-').toLowerCase()}-diff.png`);

    console.log(chalk.gray(`  V3 capture...`));
    const vpHeight = vp.height;
    await captureScreenshot({
      url: options.v3Url,
      outputPath: v3File,
      viewport: { width: vp.width, height: vpHeight },
      fullPage: false,
      waitMs: 3000,
    });

    console.log(chalk.gray(`  V4 capture...`));
    await captureScreenshot({
      url: options.v4Url,
      outputPath: v4File,
      viewport: { width: vp.width, height: vpHeight },
      fullPage: false,
      waitMs: 3000,
    });

    console.log(chalk.gray(`  Computing pixel diff...`));
    const diff = await diffScreenshots({
      originalPath: v3File,
      clonePath: v4File,
      outputDiffPath: diffFile,
    });

    console.log(chalk.gray(`  Computing SSIM...`));
    const ssim = await computeSsim({
      originalPath: v3File,
      clonePath: v4File,
    });

    console.log(chalk.gray(`  Detecting issues...`));
    const detection = await detectIssues({
      originalPath: v3File,
      clonePath: v4File,
      diffPath: diffFile,
    });

    const matchColor = diff.matchPercent >= 95 ? chalk.green : diff.matchPercent >= 85 ? chalk.yellow : chalk.red;
    console.log(chalk.white(`  [${vp.label}] ${matchColor(`${diff.matchPercent.toFixed(2)}% pixelmatch`)} · ${ssim.matchPercent.toFixed(2)}% SSIM · ${detection.issues.length} issues`));

    viewportReports.push({
      viewport: vp.label,
      width: vp.width,
      matchPercent: diff.matchPercent,
      ssimPercent: ssim.matchPercent,
      diffPixels: diff.diffPixels,
      totalPixels: diff.totalPixels,
      issues: detection.issues,
      originalImg: v3File,
      cloneImg: v4File,
      diffImg: diffFile,
    });
  }

  const overallMatch = viewportReports.reduce((sum, v) => sum + v.matchPercent, 0) / viewportReports.length;
  const overallSsim = viewportReports.reduce((sum, v) => sum + v.ssimPercent, 0) / viewportReports.length;

  const report: V3V4Report = {
    v3Url: options.v3Url,
    v4Url: options.v4Url,
    v3Label: options.v3Label ?? 'V3 (Original)',
    v4Label: options.v4Label ?? 'V4 (Converted)',
    generatedAt: new Date().toISOString(),
    viewports: viewportReports,
    overallMatch,
    overallSsim,
    outputDir: options.outputDir,
  };

  console.log(chalk.cyan(`\n[V3V4-Diff] Generating HTML report...`));
  const htmlPath = await generateV3V4HtmlReport(report);

  console.log(chalk.green(`\n✓ V3 vs V4 diff complete`));
  console.log(chalk.gray(`  Overall match: ${overallMatch.toFixed(2)}% pixelmatch · ${overallSsim.toFixed(2)}% SSIM`));
  console.log(chalk.gray(`  Report: file://${htmlPath.replace(/\\/g, '/')}`));

  return htmlPath;
}
