import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FixHistoryStore,
  FixStrategyRanker,
  selectStrategies,
  determineOutcome,
} from '@elconv/qa';
import type { FixAttempt, FixIssue, FixOutcome, ProbeSnapshot } from '@elconv/qa';

const SITE = 'https://x.test';

function probe(score: number, failCount: number): ProbeSnapshot {
  return { score, failCount };
}

let seq = 0;
function mkAttempt(over: Partial<FixAttempt> & { strategy: string; outcome: FixOutcome }): FixAttempt {
  seq += 1;
  const issue: FixIssue = over.issue ?? {
    category: 'spacing',
    severity: 'major',
    element: '.hero',
    description: 'gap too small',
  };
  return {
    id: `a${seq}`,
    timestamp: over.timestamp ?? `2026-07-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    siteUrl: over.siteUrl ?? SITE,
    pageId: over.pageId ?? 12,
    issue,
    issueSelector: over.issueSelector ?? issue.element,
    strategy: over.strategy,
    fixPayload: over.fixPayload ?? {},
    outcome: over.outcome,
    probeBefore: over.probeBefore ?? probe(60, 4),
    probeAfter: over.probeAfter ?? probe(80, 2),
    durationMs: over.durationMs ?? 100,
  };
}

describe('determineOutcome', () => {
  it('returns "error" when the after-probe is null (fix threw)', () => {
    expect(determineOutcome(probe(60, 4), null)).toBe('error');
  });
  it('returns "resolved" when the page is clean afterwards', () => {
    expect(determineOutcome(probe(60, 4), probe(100, 0))).toBe('resolved');
    expect(determineOutcome(probe(60, 4), probe(95, 0))).toBe('resolved');
  });
  it('returns "improved" when the score rises but issues remain', () => {
    expect(determineOutcome(probe(60, 4), probe(75, 2))).toBe('improved');
  });
  it('returns "regressed" when the score drops', () => {
    expect(determineOutcome(probe(60, 4), probe(40, 6))).toBe('regressed');
  });
  it('breaks a score tie on failCount', () => {
    expect(determineOutcome(probe(60, 4), probe(60, 3))).toBe('improved');
    expect(determineOutcome(probe(60, 4), probe(60, 5))).toBe('regressed');
  });
  it('returns "no-change" when score and failCount are identical', () => {
    expect(determineOutcome(probe(60, 4), probe(60, 4))).toBe('no-change');
  });
});

describe('FixHistoryStore', () => {
  const dir = join(tmpdir(), `elconv-fixlearn-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    seq = 0;
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('persists attempts to disk and reloads them in a fresh store', async () => {
    const store = new FixHistoryStore(dir);
    await store.load();
    expect(store.all()).toHaveLength(0);

    await store.record(mkAttempt({ strategy: 'css-override', outcome: 'resolved' }));
    await store.record(mkAttempt({ strategy: 'setting-change', outcome: 'improved' }));
    expect(existsSync(join(dir, '.fix-history', 'attempts.json'))).toBe(true);

    const reloaded = new FixHistoryStore(dir);
    await reloaded.load();
    expect(reloaded.all()).toHaveLength(2);
    expect(reloaded.all()[0]!.strategy).toBe('css-override');
  });

  it('starts empty when the store file does not exist', async () => {
    const store = new FixHistoryStore(join(dir, 'nope'));
    await store.load();
    expect(store.all()).toHaveLength(0);
  });

  it('findSimilar filters by site+category+element and sorts newest first', async () => {
    const store = new FixHistoryStore(dir);
    await store.load();
    const hero: FixIssue = { category: 'spacing', severity: 'major', element: '.hero', description: 'x' };
    await store.record(mkAttempt({ strategy: 'a', outcome: 'resolved', timestamp: '2026-07-01T00:00:00.000Z' }));
    await store.record(mkAttempt({ strategy: 'b', outcome: 'no-change', timestamp: '2026-07-05T00:00:00.000Z' }));
    // Different element — excluded.
    await store.record(
      mkAttempt({
        strategy: 'c',
        outcome: 'resolved',
        issue: { category: 'spacing', severity: 'minor', element: '.footer', description: 'y' },
      }),
    );
    // Different site — excluded.
    await store.record(mkAttempt({ strategy: 'd', outcome: 'resolved', siteUrl: 'https://other.test' }));

    const similar = store.findSimilar(hero, SITE);
    expect(similar.map((s) => s.strategy)).toEqual(['b', 'a']); // newest (07-05) first
  });

  it('getEffectiveness aggregates success rate, counts and confidence per strategy', async () => {
    const store = new FixHistoryStore(dir);
    await store.load();
    // css-override: 2 resolved + 1 no-change (spacing)
    await store.record(mkAttempt({ strategy: 'css-override', outcome: 'resolved', durationMs: 100 }));
    await store.record(mkAttempt({ strategy: 'css-override', outcome: 'resolved', durationMs: 300 }));
    await store.record(mkAttempt({ strategy: 'css-override', outcome: 'no-change', durationMs: 200 }));
    // A different category is ignored.
    await store.record(
      mkAttempt({
        strategy: 'css-override',
        outcome: 'resolved',
        issue: { category: 'color', severity: 'minor', element: '.hero', description: 'z' },
      }),
    );

    const eff = store.getEffectiveness('spacing');
    expect(eff).toHaveLength(1);
    const css = eff[0]!;
    expect(css.totalAttempts).toBe(3);
    expect(css.resolvedCount).toBe(2);
    expect(css.successRate).toBeCloseTo(2 / 3, 5);
    expect(css.avgDurationMs).toBeCloseTo(200, 5);
    expect(css.confidence).toBeCloseTo(0.3, 5); // 3/10
  });
});

describe('FixStrategyRanker', () => {
  const dir = join(tmpdir(), `elconv-fixrank-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    seq = 0;
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  async function seed(): Promise<FixHistoryStore> {
    const store = new FixHistoryStore(dir);
    await store.load();
    // css-override: 7 resolved on other elements + 1 REGRESSED on .hero → global strong, .hero bad.
    for (let i = 0; i < 7; i++) {
      await store.record(
        mkAttempt({
          strategy: 'css-override',
          outcome: 'resolved',
          issue: { category: 'spacing', severity: 'major', element: `.other-${i}`, description: 'd' },
        }),
      );
    }
    await store.record(mkAttempt({ strategy: 'css-override', outcome: 'regressed' })); // on .hero
    // setting-change: 1 resolved on .hero + 1 no-change on another → global weak, .hero proven.
    await store.record(mkAttempt({ strategy: 'setting-change', outcome: 'resolved' })); // on .hero
    await store.record(
      mkAttempt({
        strategy: 'setting-change',
        outcome: 'no-change',
        issue: { category: 'spacing', severity: 'minor', element: '.nav', description: 'd' },
      }),
    );
    return store;
  }

  it('per-element evidence overrides the global rate: proven beats a known failure', async () => {
    const store = await seed();
    const ranker = new FixStrategyRanker(store);
    const hero: FixIssue = { category: 'spacing', severity: 'major', element: '.hero', description: 'gap' };

    const ranked = ranker.rank(hero, SITE);
    expect(ranked.map((r) => r.strategy)).toEqual(['setting-change', 'css-override']);

    const setting = ranked.find((r) => r.strategy === 'setting-change')!;
    const css = ranked.find((r) => r.strategy === 'css-override')!;
    expect(setting.verdict).toBe('proven'); // resolved on .hero before
    expect(css.verdict).toBe('skip'); // regressed on .hero before
    expect(setting.score).toBeGreaterThan(css.score);
    expect(css.score).toBeLessThan(0.5); // -0.5 penalty applied
  });

  it('flags low-sample strategies as "unknown"', async () => {
    const store = new FixHistoryStore(dir);
    await store.load();
    await store.record(mkAttempt({ strategy: 'lonely', outcome: 'resolved' }));
    const ranker = new FixStrategyRanker(store);
    // A brand-new element (no similar history) → no per-element bonus/penalty.
    const fresh: FixIssue = { category: 'spacing', severity: 'minor', element: '.brand-new', description: 'd' };
    const ranked = ranker.rank(fresh, SITE);
    expect(ranked[0]!.verdict).toBe('unknown'); // confidence 0.1 < 0.3
  });

  it('selectStrategies drops "skip" candidates and caps at the limit', async () => {
    const store = await seed();
    const ranker = new FixStrategyRanker(store);
    const hero: FixIssue = { category: 'spacing', severity: 'major', element: '.hero', description: 'gap' };
    const ranked = ranker.rank(hero, SITE);

    const chosen = selectStrategies(ranked);
    expect(chosen.map((r) => r.strategy)).toEqual(['setting-change']); // css-override skipped
    expect(selectStrategies(ranked, 0)).toHaveLength(0);
  });
});
