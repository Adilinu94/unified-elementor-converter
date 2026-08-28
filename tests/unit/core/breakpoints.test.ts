/**
 * Tests for the single source of truth on Elementor breakpoint conventions
 * (packages/core/src/breakpoints.ts, work package P5 of BAUPLAN-v6.0).
 *
 * The point of these tests is the distinction Elementor makes silently:
 * `padding_tablet` renders, `tablet_padding` does not.
 */

import { describe, it, expect } from 'vitest';
import {
  RESPONSIVE_BREAKPOINTS,
  ALL_BREAKPOINTS,
  hasBreakpointSuffix,
  hasBreakpointPrefix,
  isBreakpointKey,
  breakpointOf,
  breakpointKey,
  baseControlId,
  findPrefixedBreakpointKeys,
  findSuffixedBreakpointKeys,
} from '@elconv/core';

describe('breakpoint constants', () => {
  it('exposes exactly the two suffixed Elementor breakpoints', () => {
    expect([...RESPONSIVE_BREAKPOINTS]).toEqual(['tablet', 'mobile']);
  });

  it('includes desktop only in ALL_BREAKPOINTS', () => {
    expect([...ALL_BREAKPOINTS]).toEqual(['desktop', 'tablet', 'mobile']);
    expect(RESPONSIVE_BREAKPOINTS as readonly string[]).not.toContain('desktop');
  });
});

describe('hasBreakpointSuffix', () => {
  it('accepts the valid Elementor form', () => {
    expect(hasBreakpointSuffix('padding_tablet')).toBe(true);
    expect(hasBreakpointSuffix('typography_font_size_mobile')).toBe(true);
  });

  it('rejects base keys and the prefix form', () => {
    expect(hasBreakpointSuffix('padding')).toBe(false);
    expect(hasBreakpointSuffix('tablet_padding')).toBe(false);
  });

  it('does not match a breakpoint word in the middle of a key', () => {
    expect(hasBreakpointSuffix('hide_tablet_extra')).toBe(false);
  });

  // Elementor's own visibility switchers end in a breakpoint word without
  // being responsive overrides. Live-verified: hide_desktop/hide_tablet/hide_mobile.
  it('does not treat Elementor visibility switchers as responsive overrides', () => {
    expect(hasBreakpointSuffix('hide_tablet')).toBe(false);
    expect(hasBreakpointSuffix('hide_mobile')).toBe(false);
  });
});

describe('hasBreakpointPrefix', () => {
  it('detects the form Elementor silently ignores', () => {
    expect(hasBreakpointPrefix('tablet_padding')).toBe(true);
    expect(hasBreakpointPrefix('mobile_typography_font_size')).toBe(true);
  });

  it('does not flag the valid suffix form', () => {
    expect(hasBreakpointPrefix('padding_tablet')).toBe(false);
  });

  it('does not flag a control that merely contains the word', () => {
    // `hide_tablet` is a real Elementor control and must not be reported.
    expect(hasBreakpointPrefix('hide_tablet')).toBe(false);
  });
});

describe('isBreakpointKey', () => {
  it('matches only the requested breakpoint', () => {
    expect(isBreakpointKey('padding_tablet', 'tablet')).toBe(true);
    expect(isBreakpointKey('padding_tablet', 'mobile')).toBe(false);
  });

  it('ignores the hide_* visibility switchers', () => {
    expect(isBreakpointKey('hide_tablet', 'tablet')).toBe(false);
  });
});

describe('breakpointOf', () => {
  it('returns desktop for unsuffixed keys', () => {
    expect(breakpointOf('padding')).toBe('desktop');
  });

  it('reads the suffix', () => {
    expect(breakpointOf('padding_tablet')).toBe('tablet');
    expect(breakpointOf('flex_gap_mobile')).toBe('mobile');
  });

  it('treats a prefixed key as desktop — the override is dead, not mobile', () => {
    expect(breakpointOf('mobile_padding')).toBe('desktop');
  });

  it('treats hide_tablet as a desktop-scope control', () => {
    expect(breakpointOf('hide_tablet')).toBe('desktop');
  });
});

describe('breakpointKey', () => {
  it('appends the suffix for responsive breakpoints', () => {
    expect(breakpointKey('padding', 'tablet')).toBe('padding_tablet');
    expect(breakpointKey('flex_gap', 'mobile')).toBe('flex_gap_mobile');
  });

  it('leaves desktop keys unchanged — Elementor has no _desktop suffix', () => {
    expect(breakpointKey('padding', 'desktop')).toBe('padding');
  });

  it('throws instead of producing padding_tablet_mobile', () => {
    expect(() => breakpointKey('padding_tablet', 'mobile')).toThrow('already carries a breakpoint suffix');
  });

  it('throws on the invalid prefix form rather than compounding it', () => {
    expect(() => breakpointKey('tablet_padding', 'mobile')).toThrow('invalid breakpoint prefix');
  });
});

describe('baseControlId', () => {
  it('strips the breakpoint suffix', () => {
    expect(baseControlId('padding_mobile')).toBe('padding');
  });

  it('is a no-op on base keys', () => {
    expect(baseControlId('padding')).toBe('padding');
  });
});

describe('settings scanners', () => {
  const settings = {
    padding: '10px',
    padding_tablet: '8px',
    mobile_padding: '4px',
    hide_tablet: 'yes',
  };

  it('finds only the prefixed keys', () => {
    expect(findPrefixedBreakpointKeys(settings)).toEqual(['mobile_padding']);
  });

  it('finds only the suffixed keys', () => {
    expect(findSuffixedBreakpointKeys(settings)).toEqual(['padding_tablet']);
  });

  it('returns empty arrays for settings without breakpoint keys', () => {
    expect(findPrefixedBreakpointKeys({ padding: '1px' })).toEqual([]);
    expect(findSuffixedBreakpointKeys({ padding: '1px' })).toEqual([]);
  });
});
