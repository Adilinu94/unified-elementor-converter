import { describe, it, expect } from 'vitest';
import type { DesignTokens } from '@elconv/core';
import { designTokensToConstraintSet } from '@elconv/core';

function makeDesignTokens(overrides: Partial<DesignTokens> = {}): DesignTokens {
  return {
    $schema: 'https://site-clone-to-v3.local/schemas/design-tokens.v2.json',
    source_url: 'https://example.com',
    extracted_at: '2026-07-07T00:00:00.000Z',
    colors: [
      { id: 'primary', hex: '#1a73e8', occurrences: 10, gv_id: null, css_var: '--color-primary', role: 'primary' },
      { id: 'secondary', hex: '#e83a1a', occurrences: 5, gv_id: null, css_var: null, role: 'secondary' },
      { id: 'background', hex: '#ffffff', occurrences: 20, gv_id: null, css_var: null, role: 'background' },
      { id: 'text', hex: '#111111', occurrences: 15, gv_id: null, css_var: null, role: 'text' },
    ],
    fonts: [
      { id: 'heading', family: 'Manrope', occurrences: 0, gv_id: null, role: 'heading' },
      { id: 'body', family: 'Roboto', occurrences: 0, gv_id: null, role: 'body' },
    ],
    sizes: [
      { id: 'section-padding', px: 80, occurrences: 0, gv_id: null },
      { id: 'container-width', px: 1200, occurrences: 0, gv_id: null },
    ],
    user_overrides: {},
    ...overrides,
  };
}

describe('designTokensToConstraintSet', () => {
  it('converts color tokens to OklchColorToken entries', () => {
    const set = designTokensToConstraintSet(makeDesignTokens());
    const hexes = set.colors.map((c) => c.hex).sort();
    // background(20)/primary(10)/text(15) pass the default minColorFrequency
    // of 2; secondary(5) also passes.
    expect(hexes).toEqual(['#111111', '#1a73e8', '#e83a1a', '#ffffff']);
  });

  it('produces one entry per color token', () => {
    const set = designTokensToConstraintSet(makeDesignTokens());
    expect(set.colors.length).toBe(4);
  });

  it('filters out colors below the default minColorFrequency', () => {
    const tokens = makeDesignTokens({
      colors: [{ id: 'primary', hex: '#1a73e8', occurrences: 1, gv_id: null, role: 'primary' }],
    });
    const set = designTokensToConstraintSet(tokens);
    expect(set.colors).toEqual([]);
  });

  it('produces one FontToken per font token (no weight tracked)', () => {
    const set = designTokensToConstraintSet(makeDesignTokens());
    expect(set.fonts).toEqual([{ family: 'Manrope' }, { family: 'Roboto' }]);
  });

  it('carries an explicit weight through when the font token has one', () => {
    const tokens = makeDesignTokens({
      fonts: [{ id: 'heading', family: 'Manrope', weight: 700, occurrences: 0, gv_id: null, role: 'heading' }],
    });
    const set = designTokensToConstraintSet(tokens);
    expect(set.fonts).toEqual([{ family: 'Manrope', weight: 700 }]);
  });

  it('skips font tokens with no family', () => {
    const tokens = makeDesignTokens({
      fonts: [{ id: 'body', occurrences: 0, gv_id: null, role: 'body' }],
    });
    const set = designTokensToConstraintSet(tokens);
    expect(set.fonts).toEqual([]);
  });

  it('falls back to the default spacing scale (no raw samples available)', () => {
    const set = designTokensToConstraintSet(makeDesignTokens());
    expect(set.spacing[0]).toEqual({ px: 0, name: 'none' });
    expect(set.spacing.length).toBeGreaterThan(1);
  });
});
