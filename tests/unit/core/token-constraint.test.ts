import { describe, it, expect } from 'vitest';
import { rgbToOklch, oklchHexToRgb as hexToRgb } from '@elconv/core';
import type { OklchColorToken } from '@elconv/core';
import {
  buildConstraintSet,
  enforceColor,
  enforceColorsInSettings,
} from '@elconv/core';

function makeToken(hex: string, frequency: number): OklchColorToken {
  const rgb = hexToRgb(hex)!;
  const oklch = rgbToOklch(rgb);
  return { hex, rgb, oklch, oklchCss: `oklch(${oklch.L} ${oklch.C} ${oklch.h})`, frequency, cssVar: null };
}

const PRIMARY_BLUE = makeToken('#1a73e8', 10);
const BRAND_RED = makeToken('#e83a1a', 8);
const NEAR_BLACK = makeToken('#111111', 20);

const SET = {
  colors: [PRIMARY_BLUE, BRAND_RED, NEAR_BLACK],
  spacing: [],
  radii: [0, 4, 8],
  shadows: [],
  fonts: [],
};

describe('buildConstraintSet', () => {
  it('filters out colors below the minimum frequency', () => {
    const rare = makeToken('#abcdef', 1);
    const set = buildConstraintSet([PRIMARY_BLUE, rare], [], 2);
    expect(set.colors).toEqual([PRIMARY_BLUE]);
  });

  it('falls back to a standard spacing scale when no raw values are given', () => {
    const set = buildConstraintSet([PRIMARY_BLUE], []);
    expect(set.spacing[0]).toEqual({ px: 0, name: 'none' });
    expect(set.spacing.length).toBeGreaterThan(1);
  });

  it('derives a spacing scale from observed raw values when given enough of them', () => {
    const set = buildConstraintSet([PRIMARY_BLUE], [], 2, [8, 8, 8, 16, 16, 32]);
    expect(set.spacing.map((s) => s.px)).toEqual([0, 8, 16, 32]);
  });

  it('includes the default radius scale', () => {
    const set = buildConstraintSet([PRIMARY_BLUE], []);
    expect(set.radii).toContain(8);
  });
});

describe('enforceColor', () => {
  it('returns an exact match with distance 0', () => {
    const match = enforceColor('#1a73e8', SET);
    expect(match.token).toBe(PRIMARY_BLUE);
    expect(match.snapped).toBe(false);
    expect(match.distance).toBe(0);
  });

  it('is case-insensitive for exact matches', () => {
    const match = enforceColor('#1A73E8', SET);
    expect(match.token).toBe(PRIMARY_BLUE);
    expect(match.snapped).toBe(false);
  });

  it('snaps a near-identical color to the nearest token within tolerance', () => {
    const match = enforceColor('#1b74e9', SET); // one bit off per channel
    expect(match.token).toBe(PRIMARY_BLUE);
    expect(match.snapped).toBe(true);
    expect(match.snappedHex).toBe('#1a73e8');
  });

  it('returns no match for a color too far from every token', () => {
    const match = enforceColor('#00ff00', SET, 0.05);
    expect(match.token).toBeNull();
    expect(match.snapped).toBe(false);
    expect(match.distance).toBeGreaterThan(0.05);
  });

  it('returns no match (not a throw) for an unparseable hex value', () => {
    const match = enforceColor('not-a-color', SET);
    expect(match.token).toBeNull();
    expect(match.distance).toBe(Infinity);
  });

  it('respects a custom maxSnapDistance', () => {
    const closeButNotExact = enforceColor('#1b74e9', SET, 0.0001);
    expect(closeButNotExact.token).toBeNull();
  });
});

describe('enforceColorsInSettings', () => {
  it('snaps hex-looking values and leaves everything else untouched', () => {
    const settings = {
      title_color: '#1b74e9', // snaps to PRIMARY_BLUE
      text_color: '#00ff00', // no match within default tolerance
      widget_type: 'heading', // not a color, must pass through untouched
      opacity: 0.8,
    };

    const { settings: result, warnings } = enforceColorsInSettings(settings, SET);

    expect(result.title_color).toBe('#1a73e8');
    expect(result.text_color).toBe('#00ff00'); // unmatched values are left as-is
    expect(result.widget_type).toBe('heading');
    expect(result.opacity).toBe(0.8);

    expect(warnings).toHaveLength(2);
    expect(warnings.find((w) => w.key === 'title_color')).toMatchObject({ matched: true, snappedHex: '#1a73e8' });
    expect(warnings.find((w) => w.key === 'text_color')).toMatchObject({ matched: false });
  });

  it('returns no warnings when every color is an exact match', () => {
    const { warnings } = enforceColorsInSettings({ title_color: '#1a73e8' }, SET);
    expect(warnings).toHaveLength(0);
  });
});
