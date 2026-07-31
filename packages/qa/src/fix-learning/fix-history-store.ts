/**
 * FixHistoryStore — Phase 114 (BAUPLAN v4.0 V6, Phase 92).
 *
 * Persists every fix attempt to `<projectDir>/.fix-history/attempts.json` and
 * answers two questions the ranker needs: "what did we already try on this exact
 * element?" (findSimilar) and "how well does each strategy do for this issue
 * category overall?" (getEffectiveness).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FixAttempt, FixIssue, StrategyEffectiveness } from './fix-types.js';

export class FixHistoryStore {
  private readonly dbPath: string;
  private attempts: FixAttempt[] = [];

  constructor(projectDir: string) {
    this.dbPath = join(projectDir, '.fix-history', 'attempts.json');
  }

  /** Load persisted attempts; a missing/corrupt store starts empty. */
  async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.dbPath, 'utf-8'));
      this.attempts = Array.isArray(parsed) ? (parsed as FixAttempt[]) : [];
    } catch {
      this.attempts = [];
    }
  }

  /** Append one attempt and flush the whole store to disk. */
  async record(attempt: FixAttempt): Promise<void> {
    this.attempts.push(attempt);
    await mkdir(dirname(this.dbPath), { recursive: true });
    await writeFile(this.dbPath, JSON.stringify(this.attempts, null, 2), 'utf-8');
  }

  /** All recorded attempts, in insertion order. */
  all(): readonly FixAttempt[] {
    return this.attempts;
  }

  /** Past attempts on the same element+category on the same site, newest first. */
  findSimilar(issue: FixIssue, siteUrl: string): FixAttempt[] {
    return this.attempts
      .filter(
        (a) =>
          a.siteUrl === siteUrl &&
          a.issue.category === issue.category &&
          a.issue.element === issue.element,
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /** Aggregated effectiveness per strategy for one issue category. */
  getEffectiveness(issueCategory: string): StrategyEffectiveness[] {
    const grouped = new Map<string, FixAttempt[]>();
    for (const a of this.attempts) {
      if (a.issue.category !== issueCategory) continue;
      grouped.set(a.strategy, [...(grouped.get(a.strategy) ?? []), a]);
    }

    return [...grouped.entries()].map(([strategy, attempts]) => {
      const succeeded = attempts.filter(
        (a) => a.outcome === 'resolved' || a.outcome === 'improved',
      );
      const lastUsed = attempts.reduce(
        (latest, a) => (a.timestamp > latest ? a.timestamp : latest),
        attempts[0]!.timestamp,
      );
      return {
        strategy,
        issueCategory,
        totalAttempts: attempts.length,
        resolvedCount: attempts.filter((a) => a.outcome === 'resolved').length,
        improvedCount: attempts.filter((a) => a.outcome === 'improved').length,
        successRate: succeeded.length / attempts.length,
        avgDurationMs: attempts.reduce((s, a) => s + a.durationMs, 0) / attempts.length,
        lastUsed,
        confidence: Math.min(1, attempts.length / 10),
      };
    });
  }
}
