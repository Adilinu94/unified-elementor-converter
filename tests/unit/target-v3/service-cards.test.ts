import { describe, it, expect, beforeEach } from 'vitest';
import { buildServiceCards, resetServiceCardsIds, type ServiceCard } from '@elconv/target-v3';

const CARDS: ServiceCard[] = [
  { title: 'A', description: 'a' },
  { title: 'B', description: 'b' },
  { title: 'C', description: 'c' },
];

function cardWidths(tree: ReturnType<typeof buildServiceCards>): number[] {
  const grid = tree.elements!.find((e) => e.elType === 'container' && e.elements)!;
  return grid.elements!.map((card) => (card.settings.flex_basis as { size: number }).size);
}

describe('buildServiceCards — columns option', () => {
  beforeEach(() => resetServiceCardsIds());

  it('defaults to 3 columns when not specified', () => {
    const tree = buildServiceCards({ cards: CARDS });
    const widths = cardWidths(tree);
    expect(widths.every((w) => w === widths[0])).toBe(true);
    expect(widths[0]).toBeGreaterThan(20);
    expect(widths[0]).toBeLessThan(34);
  });

  it('produces a wider card width for 2 columns than for 4 columns', () => {
    const two = cardWidths(buildServiceCards({ cards: CARDS, columns: 2 }))[0];
    const four = cardWidths(buildServiceCards({ cards: CARDS, columns: 4 }))[0];
    expect(two).toBeGreaterThan(four);
  });

  it('uses full width for a single column', () => {
    const widths = cardWidths(buildServiceCards({ cards: CARDS, columns: 1 }));
    expect(widths[0]).toBe(100);
  });
});
