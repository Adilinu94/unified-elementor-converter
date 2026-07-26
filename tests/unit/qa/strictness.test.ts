import { describe, it, expect } from 'vitest';
import {
  STRICTNESS_PROFILES,
  getProfile,
  listStrictnesses,
  shouldFix,
  passesTarget,
} from '@elconv/qa';

describe('strictness profiles', () => {
  it('exposes all three profiles', () => {
    expect(Object.keys(STRICTNESS_PROFILES).sort()).toEqual(['balanced', 'draft', 'pixel-perfect']);
  });

  it('orders profiles by strictness (draft < balanced < pixel-perfect)', () => {
    expect(STRICTNESS_PROFILES.draft.minMatchPercent).toBeLessThan(STRICTNESS_PROFILES.balanced.minMatchPercent);
    expect(STRICTNESS_PROFILES.balanced.minMatchPercent).toBeLessThan(STRICTNESS_PROFILES['pixel-perfect'].minMatchPercent);
  });

  it('each profile has positive maxRounds and maxFixesPerRound', () => {
    for (const profile of Object.values(STRICTNESS_PROFILES)) {
      expect(profile.maxRounds).toBeGreaterThan(0);
      expect(profile.maxFixesPerRound).toBeGreaterThan(0);
    }
  });

  it('draft only fixes high severity', () => {
    expect(STRICTNESS_PROFILES.draft.severitiesToFix).toEqual(['high']);
  });

  it('balanced fixes high + medium', () => {
    expect(STRICTNESS_PROFILES.balanced.severitiesToFix.sort()).toEqual(['high', 'medium']);
  });

  it('pixel-perfect fixes all severities', () => {
    expect(STRICTNESS_PROFILES['pixel-perfect'].severitiesToFix.sort()).toEqual(['high', 'low', 'medium']);
  });
});

describe('getProfile', () => {
  it('returns profile for known strictness', () => {
    expect(getProfile('draft').name).toBe('draft');
    expect(getProfile('balanced').name).toBe('balanced');
    expect(getProfile('pixel-perfect').name).toBe('pixel-perfect');
  });

  it('throws on unknown strictness', () => {
    expect(() => getProfile('ultra' as never)).toThrow(/Unknown strictness/);
  });
});

describe('listStrictnesses', () => {
  it('returns all strictness names', () => {
    expect(listStrictnesses().sort()).toEqual(['balanced', 'draft', 'pixel-perfect']);
  });
});

describe('shouldFix', () => {
  it('draft fixes only high', () => {
    expect(shouldFix('high', 'draft')).toBe(true);
    expect(shouldFix('medium', 'draft')).toBe(false);
    expect(shouldFix('low', 'draft')).toBe(false);
  });

  it('balanced fixes high + medium', () => {
    expect(shouldFix('high', 'balanced')).toBe(true);
    expect(shouldFix('medium', 'balanced')).toBe(true);
    expect(shouldFix('low', 'balanced')).toBe(false);
  });

  it('pixel-perfect fixes everything', () => {
    expect(shouldFix('high', 'pixel-perfect')).toBe(true);
    expect(shouldFix('medium', 'pixel-perfect')).toBe(true);
    expect(shouldFix('low', 'pixel-perfect')).toBe(true);
  });
});

describe('passesTarget', () => {
  it('draft target = 70%', () => {
    expect(passesTarget(70, 'draft')).toBe(true);
    expect(passesTarget(69.99, 'draft')).toBe(false);
  });

  it('balanced target = 85%', () => {
    expect(passesTarget(85, 'balanced')).toBe(true);
    expect(passesTarget(84.99, 'balanced')).toBe(false);
  });

  it('pixel-perfect target = 95%', () => {
    expect(passesTarget(95, 'pixel-perfect')).toBe(true);
    expect(passesTarget(94.99, 'pixel-perfect')).toBe(false);
  });

  it('higher than target always passes', () => {
    expect(passesTarget(100, 'draft')).toBe(true);
    expect(passesTarget(99.5, 'pixel-perfect')).toBe(true);
  });
});
