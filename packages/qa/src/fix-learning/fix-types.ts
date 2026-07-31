/**
 * Fix-Learning types — Phase 114 (BAUPLAN v4.0 "Verbesserung 6", Phase 92).
 *
 * A persistent record of every auto-fix attempt and its outcome, plus the
 * aggregated per-strategy effectiveness derived from it. The auto-fix loop uses
 * this to rank fix strategies by historical success instead of trying a fixed
 * order every time.
 *
 * NOTE: the BAUPLAN sketch called the issue descriptor `IssueType`, but the qa
 * barrel already re-exports a string-union `IssueType` from @elconv/core. To
 * avoid an ambiguous re-export we name the fix-learning descriptor `FixIssue`.
 */

export type FixOutcome = 'resolved' | 'improved' | 'no-change' | 'regressed' | 'error';

/** The concrete UI issue a fix attempt targets. */
export interface FixIssue {
  category: 'spacing' | 'overflow' | 'font' | 'layout' | 'color' | 'animation';
  severity: 'critical' | 'major' | 'minor';
  /** Stable element identifier (e.g. a CSS selector or a semantic label). */
  element: string;
  description: string;
}

/**
 * Minimal quality signal captured before/after a fix. Structurally compatible
 * with @elconv/qa's `GeometryProbeReport` (which carries `score` 0-100 and
 * `failCount`), so a full probe report can be passed directly.
 */
export interface ProbeSnapshot {
  /** 0-100, higher is better. */
  score: number;
  /** Number of failing probes, lower is better. */
  failCount: number;
  [key: string]: unknown;
}

/** One recorded fix attempt. */
export interface FixAttempt {
  id: string;
  timestamp: string;
  siteUrl: string;
  pageId: number;
  issue: FixIssue;
  issueSelector: string;
  /** e.g. 'css-override' | 'setting-change' | 'structure-fix'. */
  strategy: string;
  fixPayload: Record<string, unknown>;
  outcome: FixOutcome;
  probeBefore: ProbeSnapshot;
  probeAfter: ProbeSnapshot | null;
  durationMs: number;
}

/** Aggregated effectiveness of one strategy for one issue category. */
export interface StrategyEffectiveness {
  strategy: string;
  issueCategory: string;
  totalAttempts: number;
  resolvedCount: number;
  improvedCount: number;
  /** (resolved + improved) / total, 0-1. */
  successRate: number;
  avgDurationMs: number;
  lastUsed: string;
  /** 0-1, grows with sample size (full confidence at 10 attempts). */
  confidence: number;
}

export type StrategyVerdict = 'proven' | 'skip' | 'unknown' | 'recommended' | 'neutral';

/** A strategy scored + annotated for a specific issue. */
export interface RankedStrategy {
  strategy: string;
  /** 0-1 composite score used for ordering (best first). */
  score: number;
  effectiveness: StrategyEffectiveness;
  verdict: StrategyVerdict;
  /** Human-readable recommendation (German, per BAUPLAN). */
  recommendation: string;
}
