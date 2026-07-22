/**
 * Run Archive — Observability + Run-Archive (#10).
 * Stores completed runs with timestamps, results, and metrics for audit trail.
 */

export interface RunRecord {
  id: string;
  sessionId: string;
  target: 'v3' | 'v4';
  sourceType: string;
  sourceRef: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'success' | 'failed' | 'partial';
  phases: PhaseRecord[];
  guardScore?: number;
  qaScore?: number;
  error?: string;
  artifacts: string[];
}

export interface PhaseRecord {
  name: string;
  status: 'done' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface RunArchive {
  version: 1;
  runs: RunRecord[];
}

let runIdCounter = 0;
function nextRunId(): string {
  return `run_${(++runIdCounter).toString(36)}_${Date.now().toString(36)}`;
}

export function resetRunIds(): void {
  runIdCounter = 0;
}

export function createRunArchive(): RunArchive {
  return { version: 1, runs: [] };
}

export function recordRun(archive: RunArchive, record: Omit<RunRecord, 'id'>): RunArchive {
  const run: RunRecord = { id: nextRunId(), ...record };
  return { ...archive, runs: [...archive.runs, run] };
}

export function getRunsByTarget(archive: RunArchive, target: 'v3' | 'v4'): RunRecord[] {
  return archive.runs.filter((r) => r.target === target);
}

export function getRunsByStatus(archive: RunArchive, status: RunRecord['status']): RunRecord[] {
  return archive.runs.filter((r) => r.status === status);
}

export function getLastRun(archive: RunArchive): RunRecord | null {
  return archive.runs.length > 0 ? archive.runs[archive.runs.length - 1] : null;
}

export function getSuccessRate(archive: RunArchive): number {
  if (archive.runs.length === 0) return 0;
  const successes = archive.runs.filter((r) => r.status === 'success').length;
  return Math.round((successes / archive.runs.length) * 100);
}

export function getAverageDuration(archive: RunArchive): number {
  if (archive.runs.length === 0) return 0;
  const total = archive.runs.reduce((sum, r) => sum + r.durationMs, 0);
  return Math.round(total / archive.runs.length);
}

export function getAverageScore(archive: RunArchive): number {
  const scored = archive.runs.filter((r) => r.guardScore !== undefined);
  if (scored.length === 0) return 0;
  const total = scored.reduce((sum, r) => sum + (r.guardScore ?? 0), 0);
  return Math.round(total / scored.length);
}

export function serializeArchive(archive: RunArchive): string {
  return JSON.stringify(archive, null, 2);
}

export function deserializeArchive(json: string): RunArchive | null {
  try {
    const parsed = JSON.parse(json) as RunArchive;
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function pruneArchive(archive: RunArchive, maxRuns: number): RunArchive {
  if (archive.runs.length <= maxRuns) return archive;
  return { ...archive, runs: archive.runs.slice(-maxRuns) };
}
