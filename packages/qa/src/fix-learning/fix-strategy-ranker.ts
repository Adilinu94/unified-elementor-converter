/**
 * FixStrategyRanker — Phase 114 (BAUPLAN v4.0 V6, Phase 93).
 *
 * Ranks fix strategies for a given issue by historical success. The score
 * combines the strategy's overall success rate (weighted by confidence) with
 * per-element evidence: a strong bonus if the strategy already resolved this
 * exact element, a strong penalty if it already failed here.
 */

import type { FixHistoryStore } from './fix-history-store.js';
import type {
  FixIssue,
  RankedStrategy,
  StrategyEffectiveness,
  StrategyVerdict,
} from './fix-types.js';

const RECOMMENDATION: Record<StrategyVerdict, string> = {
  proven: 'BEWÄHRT — bereits erfolgreich für dieses Element',
  skip: 'ÜBERSPRINGEN — bereits fehlgeschlagen',
  unknown: 'UNBEKANNT — wenige Daten',
  recommended: 'EMPFOHLEN — hohe Erfolgsrate',
  neutral: 'NEUTRAL',
};

export class FixStrategyRanker {
  constructor(private readonly store: FixHistoryStore) {}

  /** Rank strategies for an issue, best first. */
  rank(issue: FixIssue, siteUrl: string): RankedStrategy[] {
    const effectiveness = this.store.getEffectiveness(issue.category);
    const similar = this.store.findSimilar(issue, siteUrl);

    const failed = new Set(
      similar
        .filter((f) => f.outcome === 'no-change' || f.outcome === 'regressed')
        .map((f) => f.strategy),
    );
    const succeeded = new Set(
      similar.filter((f) => f.outcome === 'resolved').map((f) => f.strategy),
    );

    return effectiveness
      .map((e) => {
        const verdict = this.verdictFor(e, succeeded, failed);
        return {
          strategy: e.strategy,
          score: this.computeScore(e, succeeded, failed),
          effectiveness: e,
          verdict,
          recommendation: RECOMMENDATION[verdict],
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private computeScore(
    e: StrategyEffectiveness,
    successes: Set<string>,
    failures: Set<string>,
  ): number {
    let score = e.successRate * e.confidence;
    if (successes.has(e.strategy)) score += 0.3; // proven on this element
    if (failures.has(e.strategy)) score -= 0.5; // known failure on this element
    return Math.max(0, Math.min(1, score));
  }

  private verdictFor(
    e: StrategyEffectiveness,
    successes: Set<string>,
    failures: Set<string>,
  ): StrategyVerdict {
    if (successes.has(e.strategy)) return 'proven';
    if (failures.has(e.strategy)) return 'skip';
    if (e.confidence < 0.3) return 'unknown';
    if (e.successRate > 0.7) return 'recommended';
    return 'neutral';
  }
}

/**
 * Strategy selection for the enhanced auto-fix loop: drop known failures, keep
 * the top `limit` (default 3). This is the pure, testable essence of the loop —
 * the live loop calls `ranker.rank()`, then `selectStrategies()`, applies each
 * candidate, classifies the result with `determineOutcome`, and records it via
 * `store.record()`, stopping early once an issue is 'resolved'.
 */
export function selectStrategies(ranked: RankedStrategy[], limit = 3): RankedStrategy[] {
  return ranked.filter((r) => r.verdict !== 'skip').slice(0, Math.max(0, limit));
}
