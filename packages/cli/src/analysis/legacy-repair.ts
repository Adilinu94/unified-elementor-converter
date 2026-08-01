/**
 * Legacy repair paths used by the retained clone-v3 pipeline.
 *
 * These paths are deliberately port-based: browser capture, WordPress writes,
 * and AI calls are explicit dependencies. A requested path without its
 * prerequisites is reported as unavailable, never as a successful repair.
 */
import type { AIRouter, RepairBlockInput, RepairResult } from '@elconv/core';
import { repairBlockViaAI } from '@elconv/core';
import {
  captureScreenshot,
  detectIssues,
  createPlaywrightProbeRunner,
  createPlaywrightRepairContextProvider,
  type AcceptanceReport,
  type CaptureResult,
  type Issue,
  type VisualDiffResult,
} from '@elconv/qa';
import {
  runAutoFixLoop,
  type AutoFixResult,
  type ProbeCheck,
  type ProbeRunner,
  type WpcodeUpdatePort,
} from '@elconv/target-v3';
import {
  buildPixelElementResolver,
  createRealFixers,
  type FixAction,
  type HealingLoopReport,
} from '@elconv/qa';
import { McpAdapter } from '@elconv/mcp';
import { buildSafePayload, cssSnippet, type IssueSeverity, type IssueType } from '@elconv/core';

export type LegacyRepairStatus = 'ok' | 'unavailable' | 'failed';

export interface LegacyRepairReportBase {
  status: LegacyRepairStatus;
  error?: string;
  artifactPath: string;
}

export interface AutoFixPathReport extends AutoFixResult, LegacyRepairReportBase {}
export interface HealingPathReport extends HealingLoopReport, LegacyRepairReportBase {}

export interface HealingFixPort {
  apply(fixes: FixAction[]): Promise<{
    applied: number;
    succeeded: number;
    succeededIds?: string[];
  }>;
}

export type HealingCaptureFn = (url: string, outputPath: string) => Promise<string>;
export type HealingDiffFn = (referencePath: string, clonePath: string) => Promise<VisualDiffResult>;

export type RepairContextProvider = (
  issue: Issue,
  screenshots: { originalPath: string; clonePath: string },
) => Promise<RepairBlockInput>;

export interface FullContextRepairReport extends LegacyRepairReportBase {
  artifactPath: string;
  issuesDetected: number;
  repairsProposed: number;
  successfulRepairs: number;
  results: Array<{
    issue: Issue;
    repair: RepairResult;
  }>;
}

export interface LegacyRepairOptions {
  outputDir: string;
  cloneUrl?: string;
  postId?: number;
  qaReport: AcceptanceReport;
  qaAutoFix?: boolean;
  heal?: boolean;
  fullContextRepair?: boolean;
  probeChecks?: ProbeCheck[];
  probeRunner?: ProbeRunner;
  wpcodePort?: WpcodeUpdatePort;
  healingFixPort?: HealingFixPort;
  healingCaptureFn?: HealingCaptureFn;
  healingDiffFn?: HealingDiffFn;
  healingTargetScore?: number;
  healingMaxIterations?: number;
  repairRouter?: AIRouter;
  repairContextProvider?: RepairContextProvider;
}

export interface LegacyRepairResults {
  autoFix?: AutoFixPathReport;
  healing?: HealingPathReport;
  fullContextRepair?: FullContextRepairReport;
}

function autoFixDefaults(): AutoFixResult {
  return {
    rounds: [],
    finalPassPct: 0,
    reachedThreshold: false,
    totalFixesApplied: 0,
    finalCss: '',
    finalReports: [],
    skipped: true,
    skipReason: 'Auto-Fix was not executed.',
  };
}

function healingDefaults(): HealingLoopReport {
  return {
    totalIterations: 0,
    initialScore: 0,
    finalScore: 0,
    targetScore: 0,
    targetReached: false,
    iterations: [],
    generatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
}

async function writeRepairArtifact(filePath: string, report: unknown): Promise<void> {
  await writeJsonArtifact(filePath, report);
}

/** Run all requested repair paths after the acceptance screenshots exist. */
export async function runLegacyRepairPaths(options: LegacyRepairOptions): Promise<LegacyRepairResults> {
  const results: LegacyRepairResults = {};

  if (options.qaAutoFix) {
    results.autoFix = await runAutoFix(options);
  }
  if (options.heal) {
    results.healing = await runHealing(options);
  }
  if (options.fullContextRepair) {
    results.fullContextRepair = await runFullContextRepair(options);
  }

  return results;
}

async function runAutoFix(options: LegacyRepairOptions): Promise<AutoFixPathReport> {
  const artifactPath = `${options.outputDir}/qa/auto-fix-report.json`;
  const unavailable = async (error: string): Promise<AutoFixPathReport> => {
    const report: AutoFixPathReport = { ...autoFixDefaults(), status: 'unavailable', error, artifactPath };
    await writeRepairArtifact(artifactPath, report);
    return report;
  };
  if (!options.cloneUrl) return unavailable('Auto-Fix requires cloneUrl.');
  if (options.postId === undefined) return unavailable('Auto-Fix requires postId.');
  if (!options.probeChecks?.length) return unavailable('Auto-Fix requires at least one geometry probe check.');
  if (!options.wpcodePort) return unavailable('Auto-Fix requires an injected WPCode update port.');

  try {
    const result = await runAutoFixLoop({
      probe: { url: options.cloneUrl, checks: options.probeChecks },
      wpcode: options.wpcodePort,
      cssSnippetTitle: `elconv ${options.postId} auto-fix CSS`,
      pageId: options.postId,
      probeRunner: options.probeRunner ?? createPlaywrightProbeRunner(),
    });
    const report: AutoFixPathReport = {
      ...result,
      status: result.skipped ? 'unavailable' : result.reachedThreshold ? 'ok' : 'failed',
      ...(result.skipReason
        ? { error: result.skipReason }
        : !result.reachedThreshold
          ? { error: `Auto-Fix completed without reaching its threshold (${result.finalPassPct}%).` }
          : {}),
      artifactPath,
    };
    await writeRepairArtifact(artifactPath, report);
    return report;
  } catch (error) {
    const report: AutoFixPathReport = {
      ...autoFixDefaults(),
      status: 'failed',
      error: `Auto-Fix failed: ${toMessage(error)}`,
      artifactPath,
    };
    await writeRepairArtifact(artifactPath, report);
    return report;
  }
}

async function runHealing(options: LegacyRepairOptions): Promise<HealingPathReport> {
  const artifactPath = `${options.outputDir}/qa/healing-report.json`;
  const unavailable = async (error: string): Promise<HealingPathReport> => {
    const report: HealingPathReport = { ...healingDefaults(), status: 'unavailable', error, artifactPath };
    await writeRepairArtifact(artifactPath, report);
    return report;
  };
  if (!options.cloneUrl) return unavailable('Healing requires cloneUrl.');
  if (!options.healingFixPort) return unavailable('Healing requires an injected capture/diff fix port.');

  const originalPath = options.qaReport.originalCapture.outputPath;
  const clonePath = options.qaReport.cloneCapture.outputPath;
  const captureFn = options.healingCaptureFn ?? defaultHealingCapture;
  const diffFn = options.healingDiffFn ?? defaultHealingDiff;

  try {
    const report = await import('@elconv/qa').then(({ runHealingLoop }) => runHealingLoop({
      referencePath: originalPath,
      clonePath,
      cloneUrl: options.cloneUrl,
      outputDir: options.outputDir,
      targetScore: options.healingTargetScore,
      maxIterations: options.healingMaxIterations,
      captureFn,
      diffFn,
      fixFn: (fixes) => options.healingFixPort!.apply(fixes),
    }));
    const result: HealingPathReport = {
      ...report,
      status: report.targetReached ? 'ok' : 'failed',
      ...(report.targetReached
        ? {}
        : { error: `Healing completed without reaching its target score (${report.finalScore}%).` }),
      artifactPath,
    };
    await writeRepairArtifact(artifactPath, result);
    return result;
  } catch (error) {
    const report: HealingPathReport = {
      ...healingDefaults(),
      status: 'failed',
      error: `Healing failed: ${toMessage(error)}`,
      artifactPath,
    };
    await writeRepairArtifact(artifactPath, report);
    return report;
  }
}

async function runFullContextRepair(options: LegacyRepairOptions): Promise<FullContextRepairReport> {
  const artifactPath = `${options.outputDir}/full-context-repair/repair-report.json`;
  const base = {
    artifactPath,
    issuesDetected: 0,
    repairsProposed: 0,
    successfulRepairs: 0,
    results: [] as Array<{ issue: Issue; repair: RepairResult }>,
  };

  if (!options.repairRouter) {
    const report: FullContextRepairReport = { ...base, status: 'unavailable', error: 'Full-context repair requires an injected AIRouter.' };
    await writeRepairArtifact(artifactPath, report);
    return report;
  }
  if (!options.repairContextProvider) {
    const report: FullContextRepairReport = { ...base, status: 'unavailable', error: 'Full-context repair requires an injected repair-context provider.' };
    await writeRepairArtifact(artifactPath, report);
    return report;
  }

  try {
    const detection = await detectIssues({
      originalPath: options.qaReport.originalCapture.outputPath,
      clonePath: options.qaReport.cloneCapture.outputPath,
      diffPath: options.qaReport.diffResult.diffPath,
    });
    const results: Array<{ issue: Issue; repair: RepairResult }> = [];
    for (const issue of detection.issues) {
      const input = await options.repairContextProvider(issue, {
        originalPath: options.qaReport.originalCapture.outputPath,
        clonePath: options.qaReport.cloneCapture.outputPath,
      });
      const repair = await repairBlockViaAI(options.repairRouter, input);
      results.push({ issue, repair });
    }

    const report: FullContextRepairReport = {
      ...base,
      status: 'ok',
      issuesDetected: detection.issues.length,
      repairsProposed: results.filter((entry) => entry.repair.success).length,
      // Full-context repair is diagnostic-only: proposals are not applied to WP.
      successfulRepairs: 0,
      results,
    };
    await writeJsonArtifact(artifactPath, report);
    return report;
  } catch (error) {
    const report: FullContextRepairReport = { ...base, status: 'failed', error: `Full-context repair failed: ${toMessage(error)}` };
    await writeJsonArtifact(artifactPath, report);
    return report;
  }
}

/** Local Playwright probe runner for the retained CLI path. */
export const createLocalProbeRunner = createPlaywrightProbeRunner;

async function defaultHealingCapture(url: string, outputPath: string): Promise<string> {
  const result: CaptureResult = await captureScreenshot({ url, outputPath, fullPage: true });
  return result.outputPath;
}

async function defaultHealingDiff(referencePath: string, clonePath: string): Promise<VisualDiffResult> {
  const detection = await detectIssues({ originalPath: referencePath, clonePath });
  const diff = detection.diff;
  const regions = detection.issues.map((issue, index) => {
    const fixType = issueTypeToFixType(issue.type);
    return {
      id: `healing-region-${index + 1}`,
      semanticRole: issue.type,
      x: issue.region.x,
      y: issue.region.y,
      width: issue.region.width,
      height: issue.region.height,
      diffPixels: issue.diffPixels,
      diffPercent: diff.diffPercent,
      severity: issueSeverityToRegionSeverity(issue.severity),
      ...(fixType ? { fixType } : {
        unfixable: true,
        unfixableReason: `No safe fixer is registered for ${issue.type}. ${issue.suggestedFix}`,
      }),
      description: issue.description,
      suggestedFix: issue.suggestedFix,
    };
  });
  return {
    viewport: { width: diff.width, height: diff.height, label: 'desktop' },
    totalPixels: diff.totalPixels,
    diffPixels: diff.diffPixels,
    diffPercent: diff.diffPercent,
    score: Math.round(diff.matchPercent),
    regions,
  };
}

function issueSeverityToRegionSeverity(severity: IssueSeverity): 'critical' | 'warning' | 'info' {
  if (severity === 'high') return 'critical';
  if (severity === 'medium') return 'warning';
  return 'info';
}

function issueTypeToFixType(type: IssueType): FixAction['type'] | undefined {
  switch (type) {
    case 'color-mismatch':
      return 'color-mismatch';
    case 'font-missing':
      return 'font-mismatch';
    case 'size-mismatch':
    case 'size-different':
      return 'size-mismatch';
    case 'image-broken':
    case 'missing-texture':
      return undefined;
    case 'layout-shift':
      return 'layout-shift';
    case 'blank-region':
    case 'animation-inactive':
      return undefined;
    default:
      return undefined;
  }
}

/** Build a browser-backed context provider for full-context repair. */
export const createLocalRepairContextProvider = createPlaywrightRepairContextProvider;

/** Build the verified WPCode update port used by --qa-auto-fix. */
/**
 * Build a Healing fix port from the verified real Elementor fixers.
 * The resolver is loaded lazily because page-v3.json is produced earlier in
 * the same pipeline run.
 */
export function createMcpHealingFixPort(
  adapter: McpAdapter,
  postId: number,
  pageDataPath: string,
): HealingFixPort {
  return {
    async apply(fixes) {
      const resolver = await buildPixelElementResolver({ pageDataPath });
      const fixers = createRealFixers({
        mcp: (ability, parameters) => adapter.executeAbility(ability, parameters),
        postId,
        resolver,
      });
      let applied = 0;
      let succeeded = 0;
      const succeededIds: string[] = [];
      for (const fix of fixes) {
        if (!fix.region) continue;
        const severity: IssueSeverity = fix.priority >= 10 ? 'high' : fix.priority >= 5 ? 'medium' : 'low';
        const issue = {
          type: healingFixType(fix.type),
          severity,
          region: fix.region,
          diffPixels: fix.region.diffPixels,
          description: fix.description,
          suggestedFix: fix.region.suggestedFix ?? fix.description,
        };
        const fixer = fixers.find((candidate) => candidate.type === issue.type);
        if (!fixer) continue;
        applied += 1;
        const result = await fixer.apply({ issue, round: 1, attempt: 1, previousAttempts: 0 });
        if (result.ok) {
          succeeded += 1;
          succeededIds.push(fix.id);
        }
      }
      return { applied, succeeded, succeededIds };
    },
  };
}

function healingFixType(type: FixAction['type']): IssueType {
  switch (type) {
    case 'color-mismatch':
      return 'color-mismatch';
    case 'size-mismatch':
      return 'size-mismatch';
    case 'font-mismatch':
      return 'font-missing';
    case 'missing-element':
      return 'layout-shift';
    case 'spacing-mismatch':
      return 'layout-shift';
    case 'layout-shift':
      return 'layout-shift';
  }
}

export function createMcpWpcodePort(adapter: McpAdapter): WpcodeUpdatePort {
  let snippetId: number | undefined;
  return {
    async update(title, code, pageId) {
      const payload = buildSafePayload(cssSnippet(title, code, pageId));
      if (snippetId === undefined) {
        const created = await adapter.executeAbility<{ data?: { id?: number }; id?: number }>(
          'novamira-adrianv2/create-wpcode-snippet',
          payload as unknown as Record<string, unknown>,
        );
        snippetId = created.data?.id ?? created.id;
        if (typeof snippetId !== 'number') throw new Error('WPCode create returned no snippet id');
        return;
      }
      await adapter.executeAbility('novamira-adrianv2/update-wpcode-snippet', {
        snippet_id: snippetId,
        ...payload,
      });
    },
  };
}

async function writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
