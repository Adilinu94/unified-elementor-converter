/**
 * elconv convert — Extract source → build target tree → validate → output.
 * KRITISCH: Target-Routing mit Anti-Contamination-Check.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, basename } from 'node:path';
import type { SourceSpec, VisualPageIR, WpcodeSnippetSpec } from '@elconv/core';
import { assertNoContamination, runGuards, formatGuardReport, collectSchemaKeys, validateVisualPageIR, type SchemaGateElement } from '@elconv/core';
import { extractFromHtml, extractFromFramerXml, robotsAllowed } from '@elconv/extractors';
import { buildV3Tree, V3_GUARDS, buildV3FromVisualIr, schemaIsUsableForAnimations } from '@elconv/target-v3';
import { buildV4Tree, V4_GUARDS } from '@elconv/target-v4';
import { loadWidgetSchemaFromSnapshot } from '@elconv/mcp';
import { requireFlag, optionalFlag, boolFlag } from './args.js';
import {
  runSchemaGateOffline,
  printSchemaGateOutcome,
  overrideRefusal,
  type SchemaGateOutcome,
} from './schema-gate-cli.js';
import { runPipeline, type PipelineResult } from './analysis/pipeline.js';

export interface ConvertOptions {
  target: 'v3' | 'v4';
  url?: string;
  xml?: string;
  html?: string;
  /** Path to a `VisualPageIR` JSON file — the generic, animation-aware path. */
  ir?: string;
  out?: string;
  report?: string;
  outputDir?: string;
  timeoutMs?: number;
  skipGuards?: boolean;
  skipSchemaGate?: boolean;
  /** Post id used to scope generated WPCode snippets to one page. */
  postId?: number;
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
  /** Schema-gate outcome summary; present whenever validation ran. */
  schemaGate?: {
    ok: boolean;
    skipped?: 'target-v4' | 'no-schema';
    errorCount?: number;
    warningCount?: number;
    source?: 'live' | 'cache' | 'snapshot';
    degraded?: boolean;
    summary: string;
  };
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
  const irPath = optionalFlag(flags, 'ir');
  const out = optionalFlag(flags, 'out');
  const reportPathOverride = optionalFlag(flags, 'report');
  const outputDirOverride = optionalFlag(flags, 'output-dir');
  const timeoutMsValue = optionalFlag(flags, 'timeout-ms');
  const timeoutMs = timeoutMsValue === undefined ? undefined : Number(timeoutMsValue);
  const postIdValue = optionalFlag(flags, 'post-id');
  const skipGuards = boolFlag(flags, 'skip-guards');
  const skipSchemaGate = boolFlag(flags, 'skip-schema-gate');
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    process.stderr.write('Error: --timeout-ms must be a positive number\n');
    return 2;
  }
  let postId: number | undefined;
  if (postIdValue !== undefined) {
    postId = Number(postIdValue);
    if (!Number.isInteger(postId) || postId <= 0) {
      process.stderr.write('Error: --post-id must be a positive integer\n');
      return 2;
    }
  }
  const sourceCount = [url, xml, html, irPath].filter(Boolean).length;

  if (sourceCount === 0) {
    process.stderr.write('Error: one of --url, --xml, --html, or --ir is required\n');
    return 2;
  }
  if (sourceCount > 1) {
    process.stderr.write('Error: --url, --xml, --html, and --ir are mutually exclusive\n');
    return 2;
  }

  // The VisualPageIR path. Separate from the SourceSpec paths because it is the
  // only one that carries animations: `buildV3Tree` has no AnimationIR input at
  // all, so routing an IR through it would silently drop every measured effect.
  if (irPath) {
    if (target !== 'v3') {
      process.stderr.write('Error: --ir currently targets v3 only (V4 uses the atomic emitter)\n');
      return 2;
    }
    return convertVisualIr(irPath, {
      ...(out !== undefined ? { out } : {}),
      ...(postId !== undefined ? { postId } : {}),
      skipGuards,
      skipSchemaGate,
    });
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
      skipSchemaGate,
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

  // Surface extraction warnings instead of proceeding as a silent success.
  // The Framer-on-regex case in particular used to pass guards at 95/100 while
  // fragmenting every heading — see BAUPLAN-v7.0 §3.1.
  for (const warning of spec.warnings) {
    process.stderr.write(`Warning: ${warning}\n`);
  }

  const tree = target === 'v3' ? buildV3Tree(spec) : buildV4Tree(spec);
  const validation = validateTree(tree, target, skipGuards, skipSchemaGate);
  if (!validation.ok) return validation.exitCode;

  return writeTree(tree, target, out);
}

async function convertUrl(
  url: string,
  target: 'v3' | 'v4',
  options: Pick<ConvertOptions, 'out' | 'report' | 'outputDir' | 'timeoutMs' | 'skipGuards' | 'skipSchemaGate'>,
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
  const validation = validateTree(tree, target, options.skipGuards, options.skipSchemaGate);
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
      ...(validation.schemaGate !== undefined ? { schemaGate: validation.schemaGate } : {}),
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
      ...(validation.schemaGate !== undefined ? { schemaGate: validation.schemaGate } : {}),
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
    ...(validation.schemaGate !== undefined ? { schemaGate: validation.schemaGate } : {}),
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

/**
 * Convert a `VisualPageIR` file into a V3 tree plus its residual WPCode snippets.
 *
 * The only `elconv convert` path that produces animations. The legacy
 * `SourceSpec` paths cannot: `SourceSpec` has no animation field, so `--xml` and
 * `--html` deploy a page with every measured effect missing and no warning. This
 * path resolves each effect against the control schema, writes what Elementor can
 * express natively, generates snippets for the rest, and scores parity against
 * both — so an unhandled effect is named rather than lost.
 *
 * Snippets are written next to the tree as `<out>.snippets.json`, not deployed.
 * `elconv deploy` owns the WPCode write; a convert that quietly pushed to a live
 * site would violate the offline contract this command is built on.
 */
function convertVisualIr(
  irPath: string,
  options: { out?: string; postId?: number; skipGuards: boolean; skipSchemaGate: boolean },
): number {
  let ir: VisualPageIR;
  try {
    ir = JSON.parse(readFileSync(resolve(irPath), 'utf8')) as VisualPageIR;
  } catch (err) {
    process.stderr.write(`Could not read IR at ${irPath}: ${(err as Error).message}\n`);
    return 1;
  }

  // Validate BEFORE the schema probe. The probe emits the tree to learn which
  // widget types the IR needs, and `emitVisualIrToV3` throws on an invalid IR —
  // so without this the user would get a stack trace from two layers down
  // instead of a statement about the file they passed.
  const validation = validateVisualPageIR(ir);
  if (!validation.valid) {
    process.stderr.write(
      `${resolve(irPath)} is not a valid VisualPageIR:\n  ${validation.errors.join('\n  ')}\n`,
    );
    return 1;
  }
  for (const warning of validation.warnings) process.stderr.write(`IR warning: ${warning}\n`);

  // The schema decides whether ANY animation setting can be written, so it is
  // resolved before the emit rather than left to a default. Offline by design:
  // the snapshot needs no transport and no credentials.
  const probe = emitProbeTree(ir);
  const schema = loadWidgetSchemaFromSnapshot(collectSchemaKeys(probe));
  const usable = schemaIsUsableForAnimations(schema);
  process.stderr.write(`Animation schema: ${usable.reason}\n`);

  let result: ReturnType<typeof buildV3FromVisualIr>;
  try {
    result = buildV3FromVisualIr(ir, {
      schema,
      ...(options.postId !== undefined ? { pageId: options.postId } : {}),
      ...(options.out !== undefined ? { snippetTitlePrefix: `${basename(options.out, '.json')} Residual` } : {}),
    });
  } catch (err) {
    // A validation failure here is a malformed IR, which is a usage error rather
    // than a build failure — the file the user passed is not a VisualPageIR.
    process.stderr.write(`IR conversion failed: ${(err as Error).message}\n`);
    return 1;
  }

  for (const warning of result.warnings) process.stderr.write(`Warning: ${warning}\n`);
  process.stderr.write(`\n${result.animation.report}\n\n`);

  if (!result.canContinue) {
    process.stderr.write(
      'Blocked: a fidelity decision requires approval before this tree may be deployed.\n',
    );
    return 1;
  }

  if (!options.skipGuards && !result.guards.passed) {
    process.stderr.write(
      `Guard score ${result.guards.score}/100 (threshold: ${result.guards.threshold})\n` +
        `${formatGuardReport(result.guards)}\n`,
    );
    return 1;
  }
  if (!options.skipGuards) {
    process.stderr.write(`Guards passed: ${result.guards.score}/100\n`);
  }

  if (!options.skipSchemaGate) {
    const outcome = runSchemaGateOffline(result.tree, 'v3');
    printSchemaGateOutcome(outcome);
    if (!outcome.ok) {
      process.stderr.write(`${outcome.summary}\n`);
      return 1;
    }
  }

  const treeCode = writeTree(result.tree, 'v3', options.out);
  if (treeCode !== 0) return treeCode;
  writeSnippets(result.snippets, options.out);
  return 0;
}

/**
 * A throwaway emit, purely to learn which schema keys this IR will need.
 *
 * `loadWidgetSchemaFromSnapshot` takes the widget types up front, but the types
 * are only known after emission decides whether a node becomes a `heading` or a
 * `container`. Emitting twice is cheap (pure, no IO) and avoids the alternative:
 * loading the whole snapshot and pretending every widget was requested, which
 * would hide a genuinely missing schema entry.
 */
function emitProbeTree(ir: VisualPageIR): SchemaGateElement[] {
  const probe = buildV3FromVisualIr(ir, {});
  return probe.tree as SchemaGateElement[];
}

/** Write residual snippets beside the tree, or report that there are none. */
function writeSnippets(snippets: readonly WpcodeSnippetSpec[], out?: string): void {
  if (snippets.length === 0) {
    process.stderr.write('Residual snippets: none needed (every effect is native)\n');
    return;
  }
  if (!out) {
    // Without a tree path there is no unambiguous place for a sidecar file, and
    // printing the snippets into the same stream as the tree JSON would corrupt
    // both. Reporting the omission beats writing to a guessed location.
    process.stderr.write(
      `Residual snippets: ${snippets.length} generated but NOT written — pass --out to save them\n`,
    );
    return;
  }
  const path = `${resolve(out).replace(/\.json$/i, '')}.snippets.json`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snippets, null, 2), 'utf8');
  process.stdout.write(
    `✓ ${snippets.length} residual WPCode snippet(s) written to ${path}\n` +
      '  Deploy them with the WPCode port; convert never writes to a live site.\n',
  );
}

function readTargetTree(artifactPath: string, target: 'v3' | 'v4'): unknown[] {  const parsed = JSON.parse(readFileSync(resolve(artifactPath), 'utf8')) as Record<string, unknown>;
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
  skipSchemaGate = false,
): ValidationOutcome {
  try {
    assertNoContamination(tree, target);
  } catch (err) {
    const error = `CONTAMINATION DETECTED: ${(err as Error).message}`;
    process.stderr.write(`${error}\n`);
    return { ok: false, exitCode: 1, error };
  }

  let guardScore: number | undefined;
  if (!skipGuards) {
    const guards = target === 'v3' ? V3_GUARDS : V4_GUARDS;
    const report = runGuards(tree, guards);
    guardScore = report.score;
    if (!report.passed) {
      const error = `Guard score ${report.score}/100 (threshold: ${report.threshold})\n${formatGuardReport(report)}`;
      process.stderr.write(`${error}\n`);
      return { ok: false, exitCode: 1, error, guardScore };
    }
    process.stderr.write(`Guards passed: ${report.score}/100\n`);
  }

  // Schema gate (P2): an unknown control id is a BUILD error, not a deploy
  // rejection. Runs after the guards so a structurally broken tree fails on the
  // cheaper check first.
  //
  // `--skip-schema-gate` has one exception, and it is deliberate: a missing
  // companion on an animation / motion-fx / sticky control is dropped by
  // Elementor with no error at all, so skipping it would hide the only signal
  // there is. The gate therefore always runs; only its VERDICT is skippable.
  const outcome = runSchemaGateOffline(tree, target);
  const refusal = overrideRefusal(outcome);
  if (refusal !== null) {
    printSchemaGateOutcome(outcome);
    process.stderr.write(`Schema gate: ${refusal}\n`);
    if (skipSchemaGate) {
      process.stderr.write('  --skip-schema-gate does not apply to a silent-loss finding.\n');
    }
    return {
      ok: false,
      exitCode: 1,
      error: refusal,
      ...(guardScore !== undefined ? { guardScore } : {}),
      schemaGate: summarizeSchemaGate(outcome),
    };
  }
  if (skipSchemaGate) {
    return { ok: true, ...(guardScore !== undefined ? { guardScore } : {}) };
  }
  printSchemaGateOutcome(outcome);
  const schemaGate = summarizeSchemaGate(outcome);
  if (!outcome.ok) {
    return { ok: false, exitCode: 1, error: outcome.summary, ...(guardScore !== undefined ? { guardScore } : {}), schemaGate };
  }
  return { ok: true, ...(guardScore !== undefined ? { guardScore } : {}), schemaGate };
}

type ValidationOutcome =
  | { ok: true; guardScore?: number; schemaGate?: UrlConversionReport['schemaGate'] }
  | {
      ok: false;
      exitCode: 1;
      error: string;
      guardScore?: number;
      schemaGate?: UrlConversionReport['schemaGate'];
    };

function summarizeSchemaGate(outcome: SchemaGateOutcome): UrlConversionReport['schemaGate'] {
  return {
    ok: outcome.ok,
    ...(outcome.skipped !== undefined ? { skipped: outcome.skipped } : {}),
    ...(outcome.report !== undefined
      ? { errorCount: outcome.report.errorCount, warningCount: outcome.report.warningCount }
      : {}),
    ...(outcome.source !== undefined ? { source: outcome.source } : {}),
    ...(outcome.degraded !== undefined ? { degraded: outcome.degraded } : {}),
    summary: outcome.summary,
  };
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
