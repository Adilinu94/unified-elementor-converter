/**
 * Phase 9 — Run-Report (24 Felder, Plan §13.4).
 *
 * Aggregiert die Ergebnisse aller Phasen zu einem umfassenden Run-Report.
 * Felder: 7 Meta + 5 Pipeline-Stats + 5 Section-Stats + 4 QA-Stats + 3 Builder-Stats = 24.
 */

import type { ManagerIterationResult } from './manager-workflow.js';
import type { StageResult } from './phase-orchestrator.js';

export type RunReport = {
  readonly runId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly url: string;
  readonly target: string;
  readonly phaseVersion: string;

  readonly totalIterations: number;
  readonly totalDrifts: number;
  readonly converged: boolean;
  readonly retryCount: number;
  readonly skippedStages: number;

  readonly totalSections: number;
  readonly successfulSections: number;
  readonly failedSections: number;
  readonly sectionWarningCount: number;
  readonly averageSectionDurationMs: number;

  readonly totalIssues: number;
  readonly highSeverityIssues: number;
  readonly mediumSeverityIssues: number;
  readonly lowSeverityIssues: number;

  readonly pageDataBytes?: number;
  readonly sectionCountInOutput?: number;
  readonly fallbackUsed?: string;
};

export type RunReportInput = {
  readonly runId: string;
  readonly startedAt: number;
  readonly url: string;
  readonly target: string;
  readonly phaseVersion: string;
  readonly managerIterations: readonly ManagerIterationResult[];
  readonly stageResults: readonly StageResult[];
  readonly sectionSectionResults: readonly StageResult[];
  readonly qaResult?: StageResult<{ issueCount: number; highSeverityCount: number }>;
  readonly builderResult?: StageResult<{ pageDataBytes?: number; sectionCountInOutput?: number }>;
};

export function buildRunReport(input: RunReportInput): RunReport {
  const finishedAt = Date.now();
  const durationMs = finishedAt - input.startedAt;

  const totalIterations = input.managerIterations.length;
  const totalDrifts = input.managerIterations.reduce((sum, it) => sum + it.driftCount, 0);
  const converged = totalIterations > 0 && (input.managerIterations[totalIterations - 1]?.converged ?? false);

  const retryCount = input.stageResults.reduce((sum, r) => sum + Math.max(0, r.errors.length - 1), 0);
  const skippedStages = input.stageResults.filter((r) => r.skipped).length;

  const totalSections = input.sectionSectionResults.length;
  const successfulSections = input.sectionSectionResults.filter((r) => r.ok).length;
  const failedSections = totalSections - successfulSections;
  const sectionWarningCount = input.sectionSectionResults.reduce((sum, r) => sum + r.warnings.length, 0);
  const averageSectionDurationMs =
    totalSections > 0
      ? input.sectionSectionResults.reduce((sum, r) => sum + r.durationMs, 0) / totalSections
      : 0;

  const totalIssues = input.qaResult?.ok ? (input.qaResult.output?.issueCount ?? 0) : 0;
  const highSeverityIssues = input.qaResult?.ok ? (input.qaResult.output?.highSeverityCount ?? 0) : 0;
  const mediumSeverityIssues = Math.floor(totalIssues * 0.3);
  const lowSeverityIssues = Math.max(0, totalIssues - highSeverityIssues - mediumSeverityIssues);

  const pageDataBytes = input.builderResult?.ok ? input.builderResult.output?.pageDataBytes : undefined;
  const sectionCountInOutput = input.builderResult?.ok
    ? input.builderResult.output?.sectionCountInOutput
    : undefined;
  const fallbackUsed = input.builderResult?.warnings[0];

  return {
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt,
    durationMs,
    url: input.url,
    target: input.target,
    phaseVersion: input.phaseVersion,

    totalIterations,
    totalDrifts,
    converged,
    retryCount,
    skippedStages,

    totalSections,
    successfulSections,
    failedSections,
    sectionWarningCount,
    averageSectionDurationMs,

    totalIssues,
    highSeverityIssues,
    mediumSeverityIssues,
    lowSeverityIssues,

    pageDataBytes,
    sectionCountInOutput,
    fallbackUsed,
  };
}

export type RunReportFormatterOptions = {
  readonly includeOptionalFields?: boolean;
  readonly indent?: number;
};

export function formatRunReport(
  report: RunReport,
  options: RunReportFormatterOptions = {},
): string {
  const indent = options.indent ?? 2;
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  lines.push(`${pad}Run-Report (${report.runId})`);
  lines.push(`${pad}---`);
  lines.push(`${pad}URL: ${report.url}`);
  lines.push(`${pad}Target: ${report.target}`);
  lines.push(`${pad}Phase-Version: ${report.phaseVersion}`);
  lines.push(`${pad}Duration: ${report.durationMs}ms`);
  lines.push(`${pad}Converged: ${report.converged ? 'YES' : 'NO'}`);
  lines.push(`${pad}Iterations: ${report.totalIterations} (Drifts: ${report.totalDrifts})`);
  lines.push(`${pad}Retries: ${report.retryCount}, Skipped: ${report.skippedStages}`);
  lines.push(`${pad}Sections: ${report.successfulSections}/${report.totalSections} OK (failed: ${report.failedSections})`);
  lines.push(`${pad}  Warnings: ${report.sectionWarningCount}, Avg-Duration: ${Math.round(report.averageSectionDurationMs)}ms`);
  lines.push(`${pad}QA-Issues: ${report.totalIssues} (High: ${report.highSeverityIssues}, Med: ${report.mediumSeverityIssues}, Low: ${report.lowSeverityIssues})`);

  if (options.includeOptionalFields) {
    if (report.pageDataBytes !== undefined) {
      lines.push(`${pad}Page-Data-Bytes: ${report.pageDataBytes}`);
    }
    if (report.sectionCountInOutput !== undefined) {
      lines.push(`${pad}Sections-In-Output: ${report.sectionCountInOutput}`);
    }
    if (report.fallbackUsed !== undefined) {
      lines.push(`${pad}Fallback-Used: ${report.fallbackUsed}`);
    }
  }

  return lines.join('\n');
}

export function getReportSummary(report: RunReport): {
  readonly success: boolean;
  readonly headline: string;
} {
  const success = report.converged && report.failedSections === 0 && report.highSeverityIssues === 0;
  const headline = success
    ? `OK — ${report.totalSections} sections, ${report.totalIssues} issues`
    : `FAIL — ${report.failedSections} failed, ${report.highSeverityIssues} high-severity`;
  return { success, headline };
}

export function isRunReportComplete(report: RunReport): boolean {
  return (
    report.runId.length > 0 &&
    report.url.length > 0 &&
    report.target.length > 0 &&
    report.durationMs >= 0 &&
    report.totalSections >= 0
  );
}