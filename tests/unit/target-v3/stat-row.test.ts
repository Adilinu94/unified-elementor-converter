import { describe, it, expect, beforeEach } from 'vitest';
import { buildStatRow, resetStatRowIds, type StatItem } from '@elconv/target-v3';

const STATS: StatItem[] = [
  { value: '10', label: 'a' },
  { value: '20', label: 'b' },
  { value: '30', label: 'c' },
  { value: '40', label: 'd' },
];

function cardWidths(tree: ReturnType<typeof buildStatRow>): number[] {
  return tree.elements!.map((card) => (card.settings.flex_basis as { size: number }).size);
}

describe('buildStatRow — columns option', () => {
  beforeEach(() => resetStatRowIds());

  it('defaults to one column per stat', () => {
    const widths = cardWidths(buildStatRow({ stats: STATS }));
    expect(widths).toHaveLength(4);
    expect(widths.every((w) => w === widths[0])).toBe(true);
  });

  it('produces a wider card width for 2 columns than for 4 columns', () => {
    const two = cardWidths(buildStatRow({ stats: STATS, columns: 2 }))[0];
    const four = cardWidths(buildStatRow({ stats: STATS, columns: 4 }))[0];
    expect(two).toBeGreaterThan(four);
  });

  it('uses full width for a single column', () => {
    const widths = cardWidths(buildStatRow({ stats: STATS, columns: 1 }));
    expect(widths[0]).toBe(100);
  });
});
