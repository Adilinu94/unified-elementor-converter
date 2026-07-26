import { describe, it, expect } from 'vitest';
import {
  rgbToOklch,
  oklchToRgb,
  oklchRoundTripDelta,
  formatOklchCss,
  parseOklch,
  oklchHexToRgb as hexToRgb,
  oklchRgbToHex as rgbToHex,
  type Rgb,
} from '@elconv/core';
import {
  detectTokenSource,
  parseBoxShadow,
  extractOklchColorTokens,
  extractShadowTokens,
  extractRadiusTokens,
  extractTypeScaleTokens,
  extractTokens,
  bucketize,
  bucketizeBy,
} from '@elconv/core';
import {
  resolveToken,
  resolveAll,
  resolvedHex,
  resolvedRgb,
  sourceOf,
  buildCustomCssForTokens,
  findExtractedForRole,
  type ResolverContext,
} from '@elconv/core';
import {
  detectTheme,
  detectFromDataAttribute,
  detectFromClassList,
  detectFromMediaQuery,
  buildThemeConditionalCss,
  type ThemeDetectorOptions,
} from '@elconv/core';
import type { StyleNode } from '@elconv/core';

// ---------- oklch-converter ----------

describe('oklch-converter', () => {
  it('hexToRgb parses short and long forms', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#1a2b3c')).toEqual({ r: 26, g: 43, b: 60 });
    expect(hexToRgb('#1a2b3cff')).toEqual({ r: 26, g: 43, b: 60 });
    expect(hexToRgb('not-a-color')).toBeNull();
  });

  it('rgbToHex pads single-digit channels', () => {
    expect(rgbToHex({ r: 1, g: 2, b: 3 })).toBe('#010203');
  });

  it('rgbToOklch/oklchToRgb round-trips within <1 delta per channel', () => {
    const samples: Rgb[] = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 128, g: 128, b: 128 },
      { r: 26, g: 43, b: 60 },
      { r: 245, g: 245, b: 220 },
    ];
    for (const original of samples) {
      const round = oklchToRgb(rgbToOklch(original));
      const delta = Math.max(
        Math.abs(original.r - round.r),
        Math.abs(original.g - round.g),
        Math.abs(original.b - round.b),
      );
      expect(delta).toBeLessThanOrEqual(1);
    }
  });

  it('oklchRoundTripDelta reports <1 for valid sRGB', () => {
    expect(oklchRoundTripDelta('#3a7bd5')).toBeLessThanOrEqual(1);
  });

  it('formatOklchCss produces valid CSS', () => {
    const css = formatOklchCss(rgbToOklch({ r: 255, g: 100, b: 50 }));
    expect(css).toMatch(/^oklch\([\d.]+% [\d.]+ [\d.]+\)$/);
  });

  it('parseOklch round-trips with formatOklchCss', () => {
    const original = rgbToOklch({ r: 200, g: 100, b: 50 });
    const css = formatOklchCss(original);
    const parsed = parseOklch(css);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(original.L, 1);
    expect(parsed!.C).toBeCloseTo(original.C, 1);
    expect(parsed!.h).toBeCloseTo(original.h, 0);
  });

  it('parseOklch returns null for invalid input', () => {
    expect(parseOklch('rgb(1,2,3)')).toBeNull();
    expect(parseOklch('not-oklch')).toBeNull();
  });
});

// ---------- token-extractor ----------

describe('token-extractor', () => {
  const sampleStyles: StyleNode[] = [
    {
      selector: '.btn',
      tag: 'button',
      styles: { 'background-color': '#3b82f6', color: '#ffffff', 'font-size': '14px' },
    },
    {
      selector: '.btn',
      tag: 'button',
      styles: { 'background-color': '#3b82f6', color: '#ffffff', 'font-size': '14px' },
    },
    {
      selector: '.heading',
      tag: 'h1',
      styles: { color: '#111827', 'font-size': '32px', 'line-height': '40px' },
    },
    {
      selector: '.card',
      tag: 'div',
      styles: {
        'border-radius': '8px',
        'box-shadow': '0 2px 4px rgba(0,0,0,0.1)',
      },
    },
  ];

  it('detectTokenSource classifies inline vs css-variables vs tailwind', () => {
    const cssVars = { '--brand-primary': '#3b82f6' };
    expect(detectTokenSource(sampleStyles, cssVars)).toBe('mixed');
    expect(detectTokenSource(sampleStyles, {})).toBe('inline');
    expect(
      detectTokenSource(
        [{ selector: '.bg-blue-500', tag: 'div', styles: {} }],
        { '--brand': '#3b82f6' },
      ),
    ).toBe('mixed');
  });

  it('parseBoxShadow extracts offset/blur/spread/color', () => {
    const result = parseBoxShadow('2px 4px 8px 1px rgba(0, 0, 0, 0.2)');
    expect(result).not.toBeNull();
    expect(result!.offsetX).toBe(2);
    expect(result!.offsetY).toBe(4);
    expect(result!.blur).toBe(8);
    expect(result!.spread).toBe(1);
  });

  it('parseBoxShadow returns null for "none" or invalid', () => {
    expect(parseBoxShadow('none')).toBeNull();
    expect(parseBoxShadow('invalid')).toBeNull();
  });

  it('extractOklchColorTokens groups by hex + tags with cssVar', () => {
    const tokens = extractOklchColorTokens(sampleStyles, { '--brand-primary': '#3b82f6' }, {
      minFrequency: 1,
    });
    expect(Object.keys(tokens).length).toBeGreaterThan(0);
    const blue = Object.values(tokens).find((t) => t.hex === '#3b82f6');
    expect(blue).toBeDefined();
    expect(blue!.cssVar).toBe('--brand-primary');
    expect(blue!.oklchCss).toMatch(/^oklch\(/);
  });

  it('extractShadowTokens returns sorted by frequency', () => {
    const manyShadows: StyleNode[] = [
      ...sampleStyles,
      {
        selector: '.card2',
        tag: 'div',
        styles: { 'box-shadow': '0 2px 4px rgba(0,0,0,0.1)' },
      },
      {
        selector: '.card3',
        tag: 'div',
        styles: { 'box-shadow': '0 2px 4px rgba(0,0,0,0.1)' },
      },
    ];
    const shadows = extractShadowTokens(manyShadows);
    expect(shadows[0]?.frequency).toBeGreaterThanOrEqual(2);
  });

  it('extractRadiusTokens buckets with tolerance', () => {
    const styles: StyleNode[] = [
      { selector: '.a', tag: 'div', styles: { 'border-radius': '8px' } },
      { selector: '.b', tag: 'div', styles: { 'border-radius': '8.5px' } },
      { selector: '.c', tag: 'div', styles: { 'border-radius': '16px' } },
    ];
    const radii = extractRadiusTokens(styles, { bucketPx: 2 });
    expect(radii.length).toBe(2);
  });

  it('extractTypeScaleTokens tracks size + lineHeight', () => {
    const tokens = extractTypeScaleTokens(sampleStyles);
    const headingToken = tokens.find((t) => t.size === 32);
    expect(headingToken).toBeDefined();
    expect(headingToken!.lineHeight).toBe(40);
  });

  it('bucketize groups by numeric value within tolerance', () => {
    const result = bucketize([{ value: 8 }, { value: 9 }, { value: 16 }], 2);
    expect(result.size).toBe(2);
  });

  it('bucketizeBy allows custom key + seed functions', () => {
    const result = bucketizeBy(
      [{ size: 14 }, { size: 15 }, { size: 24 }],
      (s) => s.size,
      1,
      (s) => ({ size: s.size, lineHeight: null }),
    );
    expect(result.length).toBe(2);
    expect(result[0]!.frequency).toBe(2);
  });

  it('extractTokens combines all categories', () => {
    const tokens = extractTokens(sampleStyles, { '--brand-primary': '#3b82f6' });
    expect(tokens.colors['color-0']).toBeDefined();
    expect(tokens.shadows.length).toBeGreaterThan(0);
    expect(tokens.radii.length).toBeGreaterThan(0);
    expect(tokens.typeScale.length).toBeGreaterThan(0);
    expect(tokens.source).toBe('mixed');
  });
});

// ---------- token-resolver ----------

describe('token-resolver', () => {
  const sampleStyles: StyleNode[] = [
    { selector: '.btn', tag: 'button', styles: { 'background-color': '#3b82f6', color: '#ffffff' } },
    { selector: '.btn', tag: 'button', styles: { 'background-color': '#3b82f6', color: '#ffffff' } },
  ];
  const cssVars = { '--brand-primary': '#3b82f6' };
  const tokens = extractTokens(sampleStyles, cssVars);
  const ctx: ResolverContext = { extracted: tokens, cssVariables: cssVars };

  it('resolveToken prefers override over extracted', () => {
    const result = resolveToken('primary', {
      ...ctx,
      overrides: { primary: '#ff00ff' },
    });
    expect(result.source).toBe('override');
    expect(result.hex).toBe('#ff00ff');
  });

  it('resolveToken falls through to extracted via role hint', () => {
    const result = resolveToken('primary', ctx);
    expect(result.source).toBe('extracted');
    expect(result.hex).toBe('#3b82f6');
  });

  it('resolveToken returns fallback for unknown role', () => {
    const result = resolveToken('nonexistent-role-xyz', ctx);
    expect(result.source).toBe('fallback');
  });

  it('resolvedHex / resolvedRgb match resolveToken', () => {
    const t = resolveToken('primary', ctx);
    expect(resolvedHex('primary', ctx)).toBe(t.hex);
    expect(resolvedRgb('primary', ctx)).toEqual(t.rgb);
  });

  it('sourceOf returns provenance string', () => {
    expect(sourceOf('primary', ctx)).toBe('extracted');
    expect(sourceOf('nonexistent-xyz', ctx)).toBe('fallback');
  });

  it('buildCustomCssForTokens emits :root block', () => {
    const css = buildCustomCssForTokens(ctx, ['primary', 'background']);
    expect(css).toContain(':root {');
    expect(css).toContain('--primary: #3b82f6;');
    expect(css).toContain('--background: #6b7280;');
  });

  it('resolveAll returns map for batch roles', () => {
    const result = resolveAll(['primary', 'background'], ctx);
    expect(result.primary).toBeDefined();
    expect(result.background).toBeDefined();
  });

  it('findExtractedForRole returns null for unknown hints', () => {
    expect(findExtractedForRole(tokens, 'nonexistent-xyz')).toBeNull();
  });
});

// ---------- theme-detector ----------

describe('theme-detector', () => {
  const htmlEl = (attrs: Record<string, string>, classes: string[] = []) => ({
    getAttribute: (n: string) => attrs[n] ?? null,
    classList: { contains: (c: string) => classes.includes(c) },
  });

  it('detectFromDataAttribute reads data-theme', () => {
    expect(detectFromDataAttribute(htmlEl({ 'data-theme': 'dark' }))).toBe('dark');
    expect(detectFromDataAttribute(htmlEl({ 'data-theme': 'light' }))).toBe('light');
    expect(detectFromDataAttribute(htmlEl({ 'data-theme': 'auto' }))).toBe('auto');
    expect(detectFromDataAttribute(htmlEl({}))).toBeNull();
  });

  it('detectFromClassList detects dark class', () => {
    expect(detectFromClassList(htmlEl({}, ['dark']))).toBe('dark');
    expect(detectFromClassList(htmlEl({}, ['theme-dark']))).toBe('dark');
    expect(detectFromClassList(htmlEl({}, ['container']))).toBeNull();
  });

  it('detectFromMediaQuery reads prefers-color-scheme', () => {
    const mm = (q: string) =>
      q.includes('dark') ? { matches: true } : { matches: false };
    expect(detectFromMediaQuery(mm)).toBe('dark');
    const mm2 = (q: string) =>
      q.includes('light') ? { matches: true } : { matches: false };
    expect(detectFromMediaQuery(mm2)).toBe('light');
  });

  it('detectTheme prefers data-attribute over class over media-query', () => {
    const html = htmlEl({ 'data-theme': 'dark' });
    const body = htmlEl({}, ['light']);
    const result = detectTheme(html, body);
    expect(result.mode).toBe('dark');
    expect(result.source).toBe('data-attribute');
  });

  it('detectTheme falls through to class', () => {
    const html = htmlEl({});
    const body = htmlEl({}, ['dark']);
    const result = detectTheme(html, body);
    expect(result.mode).toBe('dark');
    expect(result.source).toBe('class');
  });

  it('detectTheme resolves auto via media-query', () => {
    const html = htmlEl({});
    const body = htmlEl({});
    const mm = (q: string) => (q.includes('dark') ? { matches: true } : { matches: false });
    const result = detectTheme(html, body, mm);
    expect(result.mode).toBe('auto');
    expect(result.resolvedMode).toBe('dark');
    expect(result.source).toBe('media-query');
  });

  it('detectTheme defaults to light when no signal', () => {
    const html = htmlEl({});
    const body = htmlEl({});
    const result = detectTheme(html, body, () => null);
    expect(result.mode).toBe('light');
    expect(result.source).toBe('default');
  });

  it('buildThemeConditionalCss wraps for auto mode', () => {
    const html = htmlEl({});
    const body = htmlEl({});
    const mm = (q: string) => (q.includes('dark') ? { matches: true } : { matches: false });
    const theme = detectTheme(html, body, mm);
    const css = buildThemeConditionalCss(theme, 'body { color: white; }');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
  });
});

// Force ThemeDetectorOptions to be considered used (compile-time sanity)
const _opts: ThemeDetectorOptions = {};
void _opts;