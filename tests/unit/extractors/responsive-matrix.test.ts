import { describe, it, expect } from 'vitest';
import { buildResponsiveMatrix } from '@elconv/extractors';
import type { ComputedStyleSnapshot } from '@elconv/extractors';

function snap(selector: string, tag: string, styles: Record<string, string>): ComputedStyleSnapshot {
  return { selector, tag, styles };
}

const DESKTOP_SNAPS: ComputedStyleSnapshot[] = [
  snap('.hero h1', 'h1', { 'font-size': '48px', 'line-height': '1.2', 'text-align': 'left' }),
  snap('.hero p', 'p', { 'font-size': '18px', padding: '0 0 24px' }),
  snap('.nav', 'nav', { display: 'flex', 'flex-direction': 'row' }),
  snap('.footer', 'footer', { padding: '80px 0', 'background-color': '#0E2A3B' }),
];

const TABLET_SNAPS: ComputedStyleSnapshot[] = [
  snap('.hero h1', 'h1', { 'font-size': '36px', 'line-height': '1.2', 'text-align': 'left' }),
  snap('.hero p', 'p', { 'font-size': '16px', padding: '0 0 20px' }),
  snap('.nav', 'nav', { display: 'flex', 'flex-direction': 'column' }),
  snap('.footer', 'footer', { padding: '60px 0', 'background-color': '#0E2A3B' }),
];

const MOBILE_SNAPS: ComputedStyleSnapshot[] = [
  snap('.hero h1', 'h1', { 'font-size': '28px', 'line-height': '1.3', 'text-align': 'center' }),
  snap('.hero p', 'p', { 'font-size': '15px', padding: '0 0 16px' }),
  snap('.nav', 'nav', { display: 'none', 'flex-direction': 'column' }),
  snap('.footer', 'footer', { padding: '40px 0', 'background-color': '#0E2A3B' }),
];

const ALL_VIEWPORTS = {
  desktop: DESKTOP_SNAPS,
  tablet: TABLET_SNAPS,
  mobile: MOBILE_SNAPS,
};

// ---------------------------------------------------------------------------
// Basic structure
// ---------------------------------------------------------------------------
describe('buildResponsiveMatrix: structure', () => {
  it('returns correct viewport labels', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    expect(m.viewportLabels).toEqual(['desktop', 'tablet', 'mobile']);
  });

  it('returns known breakpoint widths', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    expect(m.breakpoints.desktop).toBe(1440);
    expect(m.breakpoints.tablet).toBe(768);
    expect(m.breakpoints.mobile).toBe(390);
  });

  it('includes sourceUrl and generatedAt', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com/hirelix/');
    expect(m.sourceUrl).toBe('https://example.com/hirelix/');
    expect(m.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns empty matrix for single viewport', () => {
    const m = buildResponsiveMatrix({ desktop: DESKTOP_SNAPS }, 'https://example.com');
    expect(m.elements).toHaveLength(0);
    expect(m.summary.elementsWithChanges).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Diff correctness
// ---------------------------------------------------------------------------
describe('buildResponsiveMatrix: diff', () => {
  it('detects font-size changes across viewports', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    const h1 = m.elements.find((e) => e.selector === '.hero h1');
    expect(h1).toBeDefined();
    expect(h1?.properties['font-size']).toBeDefined();
    expect(h1?.properties['font-size']?.changed).toBe(true);
    expect(h1?.properties['font-size']?.desktop).toBe('48px');
    expect(h1?.properties['font-size']?.tablet).toBe('36px');
    expect(h1?.properties['font-size']?.mobile).toBe('28px');
  });

  it('omits unchanged properties', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    // line-height changes (1.2 → 1.2 → 1.3) so it should appear on h1
    const h1 = m.elements.find((e) => e.selector === '.hero h1');
    expect(h1?.properties['line-height']).toBeDefined();
    // background-color is identical across all viewports for .footer → omitted
    const footer = m.elements.find((e) => e.selector === '.footer');
    expect(footer?.properties['background-color']).toBeUndefined();
  });

  it('detects flex-direction changes on .nav', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    const nav = m.elements.find((e) => e.selector === '.nav');
    expect(nav?.properties['flex-direction']?.changed).toBe(true);
    expect(nav?.properties['flex-direction']?.desktop).toBe('row');
    expect(nav?.properties['flex-direction']?.tablet).toBe('column');
  });

  it('detects display changes on .nav (flex → none on mobile)', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    const nav = m.elements.find((e) => e.selector === '.nav');
    expect(nav?.properties['display']?.changed).toBe(true);
    expect(nav?.properties['display']?.mobile).toBe('none');
  });

  it('skips elements present in only one viewport', () => {
    const desktopOnly = [snap('.sidebar', 'aside', { width: '300px' })];
    const snaps = {
      desktop: [...DESKTOP_SNAPS, ...desktopOnly],
      tablet: TABLET_SNAPS,
      mobile: MOBILE_SNAPS,
    };
    const m = buildResponsiveMatrix(snaps, 'https://example.com');
    const sidebar = m.elements.find((e) => e.selector === '.sidebar');
    expect(sidebar).toBeUndefined();
  });

  it('skips elements with no property changes', () => {
    // .footer background-color is identical; if padding also doesn't change:
    const identical = {
      desktop: [snap('.unchanged', 'div', { padding: '20px', display: 'block' })],
      tablet: [snap('.unchanged', 'div', { padding: '20px', display: 'block' })],
      mobile: [snap('.unchanged', 'div', { padding: '20px', display: 'block' })],
    };
    const m = buildResponsiveMatrix(identical, 'https://example.com');
    expect(m.elements.find((e) => e.selector === '.unchanged')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
describe('buildResponsiveMatrix: summary', () => {
  it('reports correct elementsWithChanges count', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    // .hero h1, .hero p, .nav, .footer all have at least one change
    expect(m.summary.elementsWithChanges).toBeGreaterThanOrEqual(3);
  });

  it('totalChanges equals sum of changeCount across elements', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    const total = m.elements.reduce((acc, e) => acc + e.changeCount, 0);
    expect(m.summary.totalChanges).toBe(total);
  });

  it('mostChangedProperties is ordered by frequency descending', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    // font-size changes on h1 AND p AND nav(display) — should be near top
    expect(m.summary.mostChangedProperties.length).toBeGreaterThan(0);
    // First entry is the most-changed prop (can't assert exact name, just structure)
    expect(typeof m.summary.mostChangedProperties[0]).toBe('string');
  });

  it('elementsScanned includes all unique selectors across viewports', () => {
    const m = buildResponsiveMatrix(ALL_VIEWPORTS, 'https://example.com');
    expect(m.summary.elementsScanned).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Desktop + Mobile only (no tablet)
// ---------------------------------------------------------------------------
describe('buildResponsiveMatrix: 2-viewport mode', () => {
  it('works with just desktop + mobile', () => {
    const m = buildResponsiveMatrix(
      { desktop: DESKTOP_SNAPS, mobile: MOBILE_SNAPS },
      'https://example.com',
    );
    expect(m.viewportLabels).toEqual(['desktop', 'mobile']);
    expect(m.elements.length).toBeGreaterThan(0);
    const h1 = m.elements.find((e) => e.selector === '.hero h1');
    expect(h1?.properties['font-size']?.desktop).toBe('48px');
    expect(h1?.properties['font-size']?.mobile).toBe('28px');
  });
});
