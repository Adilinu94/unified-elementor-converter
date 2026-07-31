/**
 * Streaming progress + ETA tracking (Phase 111, BAUPLAN v4.0 item V8).
 *
 * A small, dependency-free tracker for multi-step operations (wizard phases,
 * batch pages, deploy chunks). It streams a one-line status after each step
 * and estimates remaining time from the average step duration so far.
 *
 * The clock is injectable (`now`) so ETA math is deterministically testable
 * without real timers.
 */

export interface ProgressSnapshot {
  completed: number;
  total: number;
  /** Integer 0–100. */
  percent: number;
  elapsedMs: number;
  /** Estimated remaining time; null before the first step, 0 once complete. */
  etaMs: number | null;
  label?: string;
}

export interface ProgressTrackerOptions {
  total: number;
  /** Injectable clock (defaults to Date.now) for deterministic tests. */
  now?: () => number;
  /** Where render lines go on advance(); omit for a silent tracker. */
  sink?: (line: string) => void;
}

/** Human-friendly duration: 850ms, 42s, 3m07s. */
export function formatDuration(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  if (clamped < 1000) return `${clamped}ms`;
  const totalSeconds = Math.round(clamped / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

/** Render a snapshot as a single status line. */
export function renderProgress(snap: ProgressSnapshot): string {
  const eta = snap.etaMs === null ? '—' : `~${formatDuration(snap.etaMs)}`;
  const tail = snap.label ? ` • ${snap.label}` : '';
  return `[${snap.completed}/${snap.total}] ${snap.percent}% • elapsed ${formatDuration(snap.elapsedMs)} • ETA ${eta}${tail}`;
}

export class ProgressTracker {
  private readonly total: number;
  private readonly now: () => number;
  private readonly sink?: (line: string) => void;
  private startMs = 0;
  private completed = 0;
  private started = false;

  constructor(opts: ProgressTrackerOptions) {
    this.total = Math.max(0, Math.floor(opts.total));
    this.now = opts.now ?? Date.now;
    this.sink = opts.sink;
  }

  /** Record the start time. Called implicitly by the first advance(). */
  start(): void {
    this.startMs = this.now();
    this.started = true;
  }

  /**
   * Mark one step complete and return the resulting snapshot. Emits a render
   * line to the sink (if any). Never advances past `total`.
   */
  advance(label?: string): ProgressSnapshot {
    if (!this.started) this.start();
    this.completed = Math.min(this.completed + 1, this.total);
    const snap = this.snapshot(label);
    this.sink?.(renderProgress(snap));
    return snap;
  }

  /** Current progress without advancing. */
  snapshot(label?: string): ProgressSnapshot {
    const elapsedMs = this.started ? Math.max(0, this.now() - this.startMs) : 0;
    const percent = this.total > 0 ? Math.round((this.completed / this.total) * 100) : 100;
    let etaMs: number | null;
    if (this.completed === 0) {
      etaMs = null;
    } else if (this.completed >= this.total) {
      etaMs = 0;
    } else {
      etaMs = Math.round((elapsedMs / this.completed) * (this.total - this.completed));
    }
    return { completed: this.completed, total: this.total, percent, elapsedMs, etaMs, label };
  }

  get isDone(): boolean {
    return this.completed >= this.total;
  }
}
