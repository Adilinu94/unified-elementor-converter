import { describe, expect, it } from 'vitest';
import { parseResponsiveOverrides } from '../../../packages/cli/src/framer-build-wizard.ts';

describe('parseResponsiveOverrides', () => {
  it('accepts tablet/mobile variant arrays with selector and overrides', () => {
    expect(parseResponsiveOverrides({
      tablet: [{ selector: 'hero', overrides: { flex_direction: 'row' } }],
      mobile: [{ selector: 'hero', overrides: { padding: { top: 8 } } }],
    })).toEqual({
      tablet: [{ selector: 'hero', overrides: { flex_direction: 'row' } }],
      mobile: [{ selector: 'hero', overrides: { padding: { top: 8 } } }],
    });
  });

  it.each([
    ['a primitive', null, 'must be an object'],
    ['a non-array breakpoint', { mobile: {} }, 'responsive.mobile must be an array'],
    ['a missing selector', { mobile: [{ overrides: {} }] }, 'selector must be a non-empty string'],
    ['a missing overrides object', { mobile: [{ selector: 'hero' }] }, 'overrides must be an object'],
    ['no breakpoints', {}, 'must contain tablet and/or mobile entries'],
  ])('rejects %s with a useful message', (_label, value, message) => {
    expect(() => parseResponsiveOverrides(value)).toThrow(message);
  });
});
