/**
 * elconv convert — Extract source → build target tree → validate → output.
 * KRITISCH: Target-Routing mit Anti-Contamination-Check.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import type { SourceSpec } from '@elconv/core';
import { assertNoContamination, runGuards, formatGuardReport } from '@elconv/core';
import { extractFromHtml, extractFromFramerXml, robotsAllowed } from '@elconv/extractors';
import { buildV3Tree, V3_GUARDS } from '@elconv/target-v3';
import { buildV4Tree, V4_GUARDS } from '@elconv/target-v4';
import { requireFlag, optionalFlag, boolFlag } from './args.js';
import { runPipeline, type PipelineResult } from './analysis/pipeline.js';

export interface ConvertOptions {
  target: 'v3' | 'v4';
  url?: string;
  xml?: string;
  html?: string;
  out?: string;
  report?: string;
  outputDir?: string;
  timeoutMs?: number;
  skipGuards?: boolean;
}

export interface UrlConversionReport {
  status: 'ok' | 'failed';
  sourceUrl: string;
  target: 'v3' | 'v4';
  outputPath?: string;
  reportPath: string;
  pipelineOutputDir: string;
  pipelineArtifacts: Record<string, string>;
  stages: PipelineResult['stages'];
  treeBytes?: number;
  guardScore?: number;
  error?: string;
}

export interface ConvertDependencies {
  runUrlPipeline?: (url: string, options: {
    url: string;
    outputDir: string;
    dryRun: true;
    skipStages: number[];
    skipRobotsCheck?: boolean;
    timeoutMs?: number;
  }) => Promise<PipelineResult>;
  checkRobots?: (url: string, timeoutMs?: number) => Promise<boolean>;
}

const defaultRunUrlPipeline: NonNullable<ConvertDependencies['runUrlPipeline']> = (url, options) =>
  runPipeline(url, options);

export async function cmdConvert(
  flags: Record<string, string | boolean>,
  dependencies: ConvertDependencies = {},
): Promise<number> {
  const target = requireFlag(flags, 'target') as 'v3' | 'v4';
  if (target !== 'v3' && target !== 'v4') {
    process.stderr.write(`Error: --target must be "v3" or "v4", got "${target}"\n`);
    return 2;
  }

  const url = optionalFlag(flags, 'url');
  const xml = optionalFlag(flags, 'xml');
  const html = optionalFlag(flags, 'html');
  const out = optionalFlag(flags, 'out');
  const reportPathOverride = optionalFlag(flags, 'report');
  const outputDirOverride = optionalFlag(flags, 'output-dir');
  const timeoutMsValue = optionalFlag(flags, 'timeout-ms');
  const timeoutMs = timeoutMsValue === undefined ? undefined : Number(timeoutMsValue);
  const skipGuards = boolFlag(flags, 'skip-guards');
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    process.stderr.write('Error: --timeout-ms must be a positive number\n');
    return 2;
  }
  const sourceCount = [url, xml, html].filter(Boolean).length;

  if (sourceCount === 0) {
    process.stderr.write('Error: one of --url, --xml, or --html is required\n');
    return 2;
  }
  if (sourceCount > 1) {
    process.stderr.write('Error: --url, --xml, and --html are mutually exclusive\n');
    return 2;
  }

  if (url) {
    if (out && reportPathOverride && samePath(out, reportPathOverride)) {
      process.stderr.write('Error: --out and --report must point to different files\n');
      return 2;
    }
    return convertUrl(url, target, {
      out,
      report: reportPathOverride,
      outputDir: outputDirOverride,
      timeoutMs,
      skipGuards,
    }, dependencies);
  }

  // HTML/XML remain the local SourceSpec compatibility path.
  let spec: SourceSpec;
  try {
    if (html) {
      const result = await extractFromHtml(resolve(html));
      spec = result.spec;
    } else {
      const result = await extractFromFramerXml(resolve(xml!));
      spec = result.spec;
    }
  } catch (err) {
    process.stderr.write(`Extraction failed: ${(err as Error).message}\n`);
    return 1;
  }

  const tree = target === 'v3' ? buildV3Tree(spec) : buildV4Tree(spec);
  const validation = validateTree(tree, target, skipGuards);
  if (!validation.ok) return validation.exitCode;

  return writeTree(tree, target, out);
}

async function convertUrl(
  url: string,
  target: 'v3' | 'v4',
  options: Pick<ConvertOptions, 'out' | 'report' | 'outputDir' | 'timeoutMs' | 'skipGuards'>,
  dependencies: ConvertDependencies,
): Promise<number> {
  if (!isHttpUrl(url)) {
    process.stderr.write(`Error: --url must be a valid http(s) URL, got "${url}"\n`);
    return 2;
  }

  const pipelineOutputDir = resolve(
    options.outputDir
      ?? (options.out
        ? `${resolve(options.out)}.pipeline`
        : join('output', `convert-url-${target}-${urlJobId(url)}-${process.pid}-${nextUrlJobSequence()}`)),
  );
  const reportPath = resolve(options.report ?? join(pipelineOutputDir, 'conversion-report.json'));
  mkdirSync(dirname(reportPath), { recursive: true });

  const checkRobots = dependencies.checkRobots ?? checkUrlRobots;
  const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;
  const remainingTimeout = (): number | undefined => deadline === undefined
    ? undefined
    : Math.max(0, deadline - Date.now());
  const ensureTimeRemaining = (phase: string): void => {
    const remaining = remainingTimeout();
    if (remaining !== undefined && remaining <= 0) {
      throw new Error(`URL conversion timed out during ${phase}`);
    }
  };
  const runWithTimeout = async <T>(operation: () => Promise<T>, phase: string): Promise<T> => {
    const remaining = remainingTimeout();
    if (remaining === undefined) return operation();
    if (remaining <= 0) throw new Error(`URL conversion timed out during ${phase}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`URL conversion timed out during ${phase}`)), remaining);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  try {
    const allowed = await runWithTimeout(
      () => checkRobots(url, remainingTimeout()),
      'robots check',
    );
    if (!allowed) throw new Error(`robots.txt disallows crawling ${url}`);
  } catch (err) {
    const error = formatUrlPipelineError(err);
    const report: UrlConversionReport = {
      status: 'failed',
      sourceUrl: url,
      target,
      reportPath,
      pipelineOutputDir,
      pipelineArtifacts: {},
      stages: [],
      error,
    };
    writeFailureReport(reportPath, report);
    process.stderr.write(`URL extraction failed: ${error}\n`);
    process.stderr.write(`Report: ${reportPath}\n`);
    return 1;
  }

  let pipeline: PipelineResult;
  try {
    pipeline = await runWithTimeout(
      () => (dependencies.runUrlPipeline ?? defaultRunUrlPipeline)(url, {
        url,
        outputDir: pipelineOutputDir,
        dryRun: true,
        // The URL adapter performs the robots check above; avoid fetching it a second time inside the legacy pipeline.
        skipRobotsCheck: true,
        ...(remainingTimeout() !== undefined ? { timeoutMs: remainingTimeout() } : {}),
        // The URL convert command produces a tree/report only; deployment and
        // live QA remain separate explicit commands.
        skipStages: [7],
      }),
      'browser pipeline',
    );
  } catch (err) {
    const error = formatUrlPipelineError(err);
    const report: UrlConversionReport = {
      status: 'failed',
      sourceUrl: url,
      target,
      reportPath,
      pipelineOutputDir,
      pipelineArtifacts: {},
      stages: [],
      error,
    };
    writeFailureReport(reportPath, report);
    process.stderr.write(`URL extraction failed: ${error}\n`);
    process.stderr.write(`Report: ${reportPath}\n`);
    return 1;
  }

  const artifactKey = target === 'v3' ? 'v3-build' : 'v4-build';
  const artifactPath = pipeline.artifacts[artifactKey];
  try {
    ensureTimeRemaining('tree read');
  } catch (err) {
    const error = formatUrlPipelineError(err);
    writeFailureReport(reportPath, {
      status: 'failed', sourceUrl: url, target, reportPath, pipelineOutputDir,
      pipelineArtifacts: pipeline.artifacts, stages: pipeline.stages, error,
    });
    process.stderr.write(`${error}\nReport: ${reportPath}\n`);
    return 1;
  }
  const collidingArtifact = Object.values(pipeline.artifacts).find((path) =>
    samePath(reportPath, path) || (options.out !== undefined && samePath(options.out, path)));
  if (collidingArtifact) {
    const error = `--report/--out must not overwrite the pipeline artifact ${collidingArtifact}`;
    process.stderr.write(`Error: ${error}\n`);
    return 2;
  }
  let tree: unknown[];
  try {
    if (!artifactPath) throw new Error(`pipeline did not produce the ${artifactKey} artifact`);
    tree = readTargetTree(artifactPath, target);
    ensureTimeRemaining('tree read');
  } catch (err) {
    const error = `URL conversion produced no usable ${target.toUpperCase()} tree: ${(err as Error).message}`;
    const report: UrlConversionReport = {
      status: 'failed',
      sourceUrl: url,
      target,
      reportPath,
      pipelineOutputDir,
      pipelineArtifacts: pipeline.artifacts,
      stages: pipeline.stages,
      error,
    };
    writeFailureReport(reportPath, report);
    process.stderr.write(`${error}\nReport: ${reportPath}\n`);
    return 1;
  }

  try {
    ensureTimeRemaining('tree validation');
  } catch (err) {
    const error = formatUrlPipelineError(err);
    writeFailureReport(reportPath, {
      status: 'failed', sourceUrl: url, target,
      ...(options.out ? { outputPath: resolve(options.out) } : {}),
      reportPath, pipelineOutputDir, pipelineArtifacts: pipeline.artifacts,
      stages: pipeline.stages, treeBytes: Buffer.byteLength(JSON.stringify(tree), 'utf8'), error,
    });
    process.stderr.write(`${error}\nReport: ${reportPath}\n`);
    return 1;
  }
  const validation = validateTree(tree, target, options.skipGuards);
  try {
    ensureTimeRemaining('tree validation');
  } catch (err) {
    const error = formatUrlPipelineError(err);
    writeFailureReport(reportPath, {
      status: 'failed', sourceUrl: url, target,
      ...(options.out ? { outputPath: resolve(options.out) } : {}),
      reportPath, pipelineOutputDir, pipelineArtifacts: pipeline.artifacts,
      stages: pipeline.stages, treeBytes: Buffer.byteLength(JSON.stringify(tree), 'utf8'), error,
    });
    process.stderr.write(`${error}\nReport: ${reportPath}\n`);
    return 1;
  }
  if (!validation.ok) {
    const report: UrlConversionReport = {
      status: 'failed',
      sourceUrl: url,
      target,
      ...(options.out ? { outputPath: resolve(options.out) } : {}),
      reportPath,
      pipelineOutputDir,
      pipelineArtifacts: pipeline.artifacts,
      stages: pipeline.stages,
      treeBytes: Buffer.byteLength(JSON.stringify(tree), 'utf8'),
      ...(validation.guardScore !== undefined ? { guardScore: validation.guardScore } : {}),
      error: validation.error,
    };
    writeFailureReport(reportPath, report);
    return validation.exitCode;
  }

  let outputCode: number;
  try {
    ensureTimeRemaining('tree write');
    outputCode = writeTree(tree, target, options.out);
    ensureTimeRemaining('report write');
  } catch (err) {
    const rawError = (err as Error).message;
    const error = /timed out/i.test(rawError)
      ? formatUrlPipelineError(err)
      : `could not write ${target.toUpperCase()} tree: ${rawError}`;
    const report: UrlConversionReport = {
      status: 'failed',
      sourceUrl: url,
      target,
      ...(options.out ? { outputPath: resolve(options.out) } : {}),
      reportPath,
      pipelineOutputDir,
      pipelineArtifacts: pipeline.artifacts,
      stages: pipeline.stages,
      treeBytes: Buffer.byteLength(JSON.stringify(tree), 'utf8'),
      ...(validation.guardScore !== undefined ? { guardScore: validation.guardScore } : {}),
      error,
    };
    try {
      writeFailureReport(reportPath, report);
    } catch (reportError) {
      process.stderr.write(`Could not write failure report: ${(reportError as Error).message}\n`);
    }
    process.stderr.write(`${error}\nReport: ${reportPath}\n`);
    return 1;
  }

  const report: UrlConversionReport = {
    status: 'ok',
    sourceUrl: url,
    target,
    ...(options.out ? { outputPath: resolve(options.out) } : {}),
    reportPath,
    pipelineOutputDir,
    pipelineArtifacts: pipeline.artifacts,
    stages: pipeline.stages,
    treeBytes: Buffer.byteLength(JSON.stringify(tree), 'utf8'),
    ...(validation.guardScore !== undefined ? { guardScore: validation.guardScore } : {}),
  };
  try {
    writeReport(reportPath, report);
  } catch (err) {
    process.stderr.write(`Could not write conversion report: ${(err as Error).message}\n`);
    return 1;
  }
  process.stderr.write(`URL conversion report: ${reportPath}\n`);
  return outputCode;
}

function readTargetTree(artifactPath: string, target: 'v3' | 'v4'): unknown[] {
  const parsed = JSON.parse(readFileSync(resolve(artifactPath), 'utf8')) as Record<string, unknown>;
  const tree = target === 'v3' ? parsed.content : parsed.tree;
  if (!Array.isArray(tree) || tree.length === 0) {
    throw new Error(`artifact ${artifactPath} contains no non-empty tree`);
  }
  return tree;
}

function validateTree(
  tree: unknown[],
  target: 'v3' | 'v4',
  skipGuards = false,
): { ok: true; guardScore?: number } | { ok: false; exitCode: 1; error: string; guardScore?: number } {
  try {
    assertNoContamination(tree, target);
  } catch (err) {
    const error = `CONTAMINATION DETECTED: ${(err as Error).message}`;
    process.stderr.write(`${error}\n`);
    return { ok: false, exitCode: 1, error };
  }

  if (skipGuards) return { ok: true };
  const guards = target === 'v3' ? V3_GUARDS : V4_GUARDS;
  const report = runGuards(tree, guards);
  if (!report.passed) {
    const error = `Guard score ${report.score}/100 (threshold: ${report.threshold})\n${formatGuardReport(report)}`;
    process.stderr.write(`${error}\n`);
    return { ok: false, exitCode: 1, error, guardScore: report.score };
  }
  process.stderr.write(`Guards passed: ${report.score}/100\n`);
  return { ok: true, guardScore: report.score };
}

function writeTree(tree: unknown[], target: 'v3' | 'v4', out?: string): number {
  const json = JSON.stringify(tree, null, 2);
  if (out) {
    const outPath = resolve(out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, json, 'utf-8');
    process.stdout.write(`✓ ${target.toUpperCase()} tree written to ${outPath} (${Buffer.byteLength(json)} bytes)\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
  return 0;
}

let urlJobSequence = 0;

function nextUrlJobSequence(): number {
  urlJobSequence += 1;
  return urlJobSequence;
}

async function checkUrlRobots(url: string, timeoutMs = 5_000): Promise<boolean> {
  return robotsAllowed(url, null, {
    timeoutMs,
    fetcher: async (robotsUrl) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(robotsUrl, { signal: controller.signal });
        return response.ok ? await response.text() : null;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

function urlJobId(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 12);
}

function writeReport(reportPath: string, report: UrlConversionReport): void {
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

function writeFailureReport(reportPath: string, report: UrlConversionReport): void {
  try {
    writeReport(reportPath, report);
  } catch (reportError) {
    process.stderr.write(`Could not write failure report: ${(reportError as Error).message}\n`);
  }
}

function samePath(first: string, second: string): boolean {
  const normalize = (value: string): string => {
    const resolved = resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(first) === normalize(second);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatUrlPipelineError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out during robots check/i.test(message)) return `robots check timed out: ${message}`;
  if (/robots\.txt|disallows crawling/i.test(message)) return `robots check failed: ${message}`;
  if (/timed out during browser pipeline|browser extraction/i.test(message)) return `browser extraction timed out: ${message}`;
  if (/timeout|timed out/i.test(message)) return `URL conversion timed out: ${message}`;
  if (/rate.?limit|too many requests|429/i.test(message)) return `source rate limit reached: ${message}`;
  return message;
}
