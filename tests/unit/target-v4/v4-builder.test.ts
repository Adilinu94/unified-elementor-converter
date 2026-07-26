import { describe, it, expect, beforeEach } from 'vitest';
import { buildV4Tree, resetV4IdCounter } from '../../../packages/target-v4/src/builder.ts';
import { V4_GUARDS } from '../../../packages/target-v4/src/guards.ts';
import { isValidStyleId, sanitizeStyleId, generateStyleId, resetStyleIdCounter } from '../../../packages/target-v4/src/style-id.ts';
import { wrapSize, wrapColor, normalizeHex, rgbToHex, hexToRgb, hexDistance } from '../../../packages/target-v4/src/framer-utils.ts';
import { runGuards, findContamination, EMPTY_DESIGN_TOKEN_SET, type SourceSpec } from '../../../packages/core/src/index.ts';
import type { V4TreeNode } from '../../../packages/target-v4/src/types.ts';

function makeSpec(overrides?: Partial<SourceSpec>): SourceSpec {
  return {
    source: { type: 'url', url: 'https://example.com' },
    tokens: EMPTY_DESIGN_TOKEN_SET,
    sections: [
      {
        id: 'sec1',
        semanticRole: 'hero',
        layout: 'single-column',
        widgets: [
          { id: 'w1', type: 'heading', text: 'Hello V4', styles: { 'font-size': '48px', color: '#333333' } },
          { id: 'w2', type: 'text', text: 'Paragraph here', styles: { color: '#666666' } },
          { id: 'w3', type: 'button', text: 'Click', href: 'https://x.com', styles: { 'background-color': '#0066ff' } },
          { id: 'w4', type: 'image', imageUrl: 'https://img.test/hero.png', styles: {} },
        ],
        styles: { 'background-color': '#f5f5f5' },
      },
    ],
    cssVars: {},
    warnings: [],
    ...overrides,
  };
}

describe('V4 Builder', () => {
  beforeEach(() => resetV4IdCounter());

  it('produces V4 atomic elements from SourceSpec', () => {
    const tree = buildV4Tree(makeSpec());
    expect(tree.length).toBe(1);
    expect(tree[0].type).toBe('e-flexbox');
    expect(tree[0].elements!.length).toBe(4);
  });

  it('maps heading to e-heading', () => {
    const tree = buildV4Tree(makeSpec());
    const heading = tree[0].elements![0];
    expect(heading.type).toBe('e-heading');
    expect(heading.settings.title).toBe('Hello V4');
  });

  it('maps button to e-button with link', () => {
    const tree = buildV4Tree(makeSpec());
    const btn = tree[0].elements![2];
    expect(btn.type).toBe('e-button');
    expect((btn.settings.link as Record<string, unknown>).url).toBe('https://x.com');
  });

  it('maps image with $$type image-src', () => {
    const tree = buildV4Tree(makeSpec());
    const img = tree[0].elements![3];
    expect(img.type).toBe('e-image');
    const imgSetting = img.settings.image as { '$$type': string; value: { url: string } };
    expect(imgSetting['$$type']).toBe('image-src');
    expect(imgSetting.value.url).toBe('https://img.test/hero.png');
  });

  it('section has styles with $$type wrapped props', () => {
    const tree = buildV4Tree(makeSpec());
    const styleKeys = Object.keys(tree[0].styles);
    expect(styleKeys.length).toBeGreaterThan(0);
    const cls = tree[0].styles[styleKeys[0]];
    const bgProp = cls.variants[0].props.background_color as { '$$type': string };
    expect(bgProp['$$type']).toBe('color');
  });

  it('output never contains V3 markers', () => {
    const tree = buildV4Tree(makeSpec());
    expect(findContamination(tree, 'v4')).toEqual([]);
  });

  it('multi-column uses flex_direction row', () => {
    const spec = makeSpec({
      sections: [{
        id: 's', layout: 'multi-column', columns: 2,
        widgets: [{ id: 'w', type: 'heading', text: 'X', styles: {} }],
        styles: {},
      }],
    });
    const tree = buildV4Tree(spec);
    expect(tree[0].settings.flex_direction).toBe('row');
  });
});

describe('V4 Style IDs', () => {
  beforeEach(() => resetStyleIdCounter());

  it('isValidStyleId accepts valid IDs', () => {
    expect(isValidStyleId('hero_section')).toBe(true);
    expect(isValidStyleId('a')).toBe(true);
    expect(isValidStyleId('bg_color_2')).toBe(true);
  });

  it('isValidStyleId rejects hyphens', () => {
    expect(isValidStyleId('hero-section')).toBe(false);
    expect(isValidStyleId('my-style')).toBe(false);
  });

  it('isValidStyleId rejects starting with number', () => {
    expect(isValidStyleId('1abc')).toBe(false);
    expect(isValidStyleId('_abc')).toBe(false);
  });

  it('sanitizeStyleId fixes hyphens', () => {
    expect(sanitizeStyleId('hero-section')).toBe('hero_section');
    expect(sanitizeStyleId('My-Style-Name')).toBe('my_style_name');
  });

  it('sanitizeStyleId prefixes numbers', () => {
    expect(sanitizeStyleId('123abc')).toBe('s_123abc');
  });

  it('generateStyleId produces valid IDs', () => {
    const id = generateStyleId('Hero Section');
    expect(isValidStyleId(id)).toBe(true);
  });
});

describe('V4 $$type Wrappers', () => {
  it('wrapSize produces correct envelope', () => {
    const s = wrapSize(16, 'px');
    expect(s['$$type']).toBe('size');
    expect(s.value).toEqual({ size: 16, unit: 'px' });
  });

  it('wrapColor normalizes hex', () => {
    const c = wrapColor('#FFF');
    expect(c['$$type']).toBe('color');
    expect(c.value).toBe('#ffffff');
  });

  it('normalizeHex expands 3-char', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
  });

  it('rgbToHex converts correctly', () => {
    expect(rgbToHex('rgb(255, 128, 0)')).toBe('#ff8000');
  });

  it('hexToRgb parses correctly', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
  });

  it('hexDistance is 0 for same color', () => {
    expect(hexDistance('#333333', '#333333')).toBe(0);
  });

  it('hexDistance > 0 for different colors', () => {
    expect(hexDistance('#000000', '#ffffff')).toBeGreaterThan(400);
  });
});

describe('V4 Guards', () => {
  beforeEach(() => resetV4IdCounter());

  it('clean tree passes all guards ≥85', () => {
    const tree = buildV4Tree(makeSpec());
    const report = runGuards(tree, V4_GUARDS);
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.passed).toBe(true);
  });

  it('G_NO_V3 catches V3 contamination', () => {
    const badTree: V4TreeNode[] = [{
      type: 'e-flexbox', elType: 'container', widgetType: 'e-flexbox',
      id: '1', settings: { isInner: true }, styles: {},
    }];
    const report = runGuards(badTree, V4_GUARDS);
    const noV3 = report.results.find((r) => r.name.includes('G_NO_V3'));
    expect(noV3!.result.passed).toBe(false);
  });

  it('G7 catches hyphens in style IDs', () => {
    const badTree: V4TreeNode[] = [{
      type: 'e-flexbox', elType: 'e-flexbox', widgetType: 'e-flexbox',
      id: '1', settings: {},
      styles: { 'bad-style': { id: 'bad-style', label: 'x', type: 'class', variants: [{ meta: { breakpoint: null, state: null }, props: { color: { '$$type': 'color', value: '#000' } }, custom_css: null }] } },
    }];
    const report = runGuards(badTree, V4_GUARDS);
    const g7 = report.results.find((r) => r.name.includes('G7'));
    expect(g7!.result.passed).toBe(false);
  });

  it('G_STYLE_ID_VALID rejects invalid format', () => {
    const badTree: V4TreeNode[] = [{
      type: 'e-flexbox', elType: 'e-flexbox', widgetType: 'e-flexbox',
      id: '1', settings: {},
      styles: { '123bad': { id: '123bad', label: 'x', type: 'class', variants: [{ meta: { breakpoint: null, state: null }, props: { a: 1 }, custom_css: null }] } },
    }];
    const report = runGuards(badTree, V4_GUARDS);
    const gStyle = report.results.find((r) => r.name.includes('G_STYLE_ID_VALID'));
    expect(gStyle!.result.passed).toBe(false);
  });
});
