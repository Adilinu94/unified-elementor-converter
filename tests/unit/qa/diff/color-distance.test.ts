import { describe, it, expect } from 'vitest';
import { colorDistanceOklch, isVisuallyEqual } from '@elconv/qa';

describe('colorDistanceOklch', () => {
  it('returns 0 for identical colors', () => {
    expect(colorDistanceOklch([26, 115, 232], [26, 115, 232])).toBeCloseTo(0, 5);
  });

  it('returns a small distance for near-identical colors (anti-aliasing noise)', () => {
    const d = colorDistanceOklch([26, 115, 232], [27, 116, 233]);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.02);
  });

  it('returns a large distance for very different colors', () => {
    const d = colorDistanceOklch([0, 0, 0], [255, 255, 255]);
    expect(d).toBeGreaterThan(0.5);
  });
});

describe('isVisuallyEqual', () => {
  it('treats identical hex colors as equal', () => {
    expect(isVisuallyEqual('#1a73e8', '#1a73e8')).toBe(true);
  });

  it('treats near-identical hex colors as equal within the default threshold', () => {
    expect(isVisuallyEqual('#1a73e8', '#1b74e9')).toBe(true);
  });

  it('treats black and white as not equal', () => {
    expect(isVisuallyEqual('#000000', '#ffffff')).toBe(false);
  });

  it('returns false (not equal) for an unparseable hex value instead of throwing', () => {
    expect(isVisuallyEqual('not-a-color', '#000000')).toBe(false);
  });

  it('respects a custom threshold', () => {
    // Same pair as the "near-identical" case above, but with a threshold too tight to allow it.
    expect(isVisuallyEqual('#1a73e8', '#1b74e9', 0.0001)).toBe(false);
  });
});
