import { describe, it, expect } from 'vitest';
import {
  checkSectionRender,
  extractExpectedVisuals,
  buildRenderCheckCall,
  type SectionRenderCheckInput,
  type V3Element,
} from '@elconv/target-v3';

function widget(id: string, widgetType: string, settings: Record<string, unknown> = {}): V3Element {
  return { id, elType: 'widget', widgetType, settings };
}
function container(id: string, settings: Record<string, unknown> = {}): V3Element {
  return { id, elType: 'container', settings };
}

describe('checkSectionRender', () => {
  it('passes when actual styles match expected exactly', () => {
    const input: SectionRenderCheckInput = {
      sectionId: 's1',
      sectionRole: 'hero',
      element: container('s1'),
      expectedVisuals: [{ selector: '#s1', styles: { 'background-color': '#ff0000' } }],
      liveUrl: 'https://example.com',
    };
    const result = checkSectionRender(input, new Map([['#s1', { 'background-color': '#ff0000' }]]));
    expect(result.passed).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.cssComplementBlock).toBeNull();
  });

  it('flags every expected property as a mismatch when the selector is not found', () => {
    const input: SectionRenderCheckInput = {
      sectionId: 's1',
      sectionRole: 'hero',
      element: container('s1'),
      expectedVisuals: [{ selector: '#missing', styles: { 'padding-top': '20px' } }],
      liveUrl: 'https://example.com',
    };
    const result = checkSectionRender(input, new Map());
    expect(result.passed).toBe(false);
    expect(result.mismatches[0]).toMatchObject({
      selector: '#missing',
      property: 'padding-top',
      expected: '20px',
      actual: 'ELEMENT_NOT_FOUND',
    });
  });

  it('treats equivalent hex and rgb colors as matching', () => {
    const input: SectionRenderCheckInput = {
      sectionId: 's1',
      sectionRole: 'hero',
      element: container('s1'),
      expectedVisuals: [{ selector: '#s1', styles: { 'background-color': '#ff0000' } }],
      liveUrl: 'https://example.com',
    };
    const result = checkSectionRender(input, new Map([['#s1', { 'background-color': 'rgb(255, 0, 0)' }]]));
    expect(result.passed).toBe(true);
  });

  it('allows numeric drift within the 2px tolerance', () => {
    const input: SectionRenderCheckInput = {
      sectionId: 's1',
      sectionRole: 'hero',
      element: container('s1'),
      expectedVisuals: [{ selector: '#s1', styles: { 'padding-top': '20px' } }],
      liveUrl: 'https://example.com',
    };
    const result = checkSectionRender(input, new Map([['#s1', { 'padding-top': '21px' }]]));
    expect(result.passed).toBe(true);
  });

  it('flags a mismatch when numeric drift exceeds the 2px tolerance', () => {
    const input: SectionRenderCheckInput = {
      sectionId: 's1',
      sectionRole: 'hero',
      element: container('s1'),
      expectedVisuals: [{ selector: '#s1', styles: { 'padding-top': '20px' } }],
      liveUrl: 'https://example.com',
    };
    const result = checkSectionRender(input, new Map([['#s1', { 'padding-top': '25px' }]]));
    expect(result.passed).toBe(false);
    expect(result.mismatches[0]!.property).toBe('padding-top');
  });

  it('flags a mismatch on the second value of a multi-value gap shorthand', () => {
    // row matches (10px), but column drifts wildly (5px expected vs 40px actual)
    const input: SectionRenderCheckInput = {
      sectionId: 's1',
      sectionRole: 'hero',
      element: container('s1'),
      expectedVisuals: [{ selector: '#s1 .e-con-inner', styles: { gap: '10px 5px' } }],
      liveUrl: 'https://example.com',
    };
    const result = checkSectionRender(input, new Map([['#s1 .e-con-inner', { gap: '10px 40px' }]]));
    expect(result.passed).toBe(false);
  });

  it('merges multiple mismatches on the same selector into a single CSS block', () => {
    const input: SectionRenderCheckInput = {
      sectionId: 's1',
      sectionRole: 'hero',
      element: container('s1'),
      expectedVisuals: [
        { selector: '#s1', styles: { 'padding-top': '20px', 'padding-bottom': '20px' } },
      ],
      liveUrl: 'https://example.com',
    };
    // selector not found -> both properties mismatch
    const result = checkSectionRender(input, new Map());
    expect(result.mismatches).toHaveLength(2);
    expect(result.cssComplementBlock!.match(/#s1 \{/g)).toHaveLength(1);
  });
});

describe('extractExpectedVisuals', () => {
  it('extracts background color', () => {
    const el = container('c1', { background_color: '#123456' });
    expect(extractExpectedVisuals(el, 42)).toEqual([
      { selector: 'body.page-id-42 #c1', styles: { 'background-color': '#123456' } },
    ]);
  });

  it('extracts heading font size with default px unit', () => {
    const el = widget('h1', 'heading', { typography_font_size: { size: 32 } });
    expect(extractExpectedVisuals(el, 1)).toContainEqual({
      selector: 'body.page-id-1 #h1 .elementor-heading-title',
      styles: { 'font-size': '32px' },
    });
  });

  it('does not extract font size for non-heading widgets', () => {
    const el = widget('t1', 'text-editor', { typography_font_size: { size: 32 } });
    expect(extractExpectedVisuals(el, 1)).toEqual([]);
  });

  it('extracts non-zero padding on all sides', () => {
    const el = container('c1', { padding: { top: 10, right: 20, bottom: 30, left: 40, unit: 'px' } });
    expect(extractExpectedVisuals(el, 1)).toContainEqual({
      selector: 'body.page-id-1 #c1',
      styles: {
        'padding-top': '10px',
        'padding-right': '20px',
        'padding-bottom': '30px',
        'padding-left': '40px',
      },
    });
  });

  it('extracts an explicit zero padding value instead of silently dropping it', () => {
    // A section flush against the next one (top: 0) is a real, intentional design value,
    // not "no padding set" -- it must still be checked against the live render.
    const el = container('c1', { padding: { top: 0, bottom: 40, unit: 'px' } });
    const visuals = extractExpectedVisuals(el, 1);
    const paddingVisual = visuals.find((v) => v.selector === 'body.page-id-1 #c1');
    expect(paddingVisual?.styles['padding-top']).toBe('0px');
    expect(paddingVisual?.styles['padding-bottom']).toBe('40px');
  });

  it('extracts flex gap for containers as "row column"', () => {
    const el = container('c1', { flex_gap: { column: '16', row: '24' } });
    expect(extractExpectedVisuals(el, 1)).toContainEqual({
      selector: 'body.page-id-1 #c1 .e-con-inner',
      styles: { gap: '24px 16px' },
    });
  });

  it('does not extract flex gap for widgets', () => {
    const el = widget('w1', 'heading', { flex_gap: { column: '16', row: '24' } });
    expect(extractExpectedVisuals(el, 1)).toEqual([]);
  });

  it('returns no visuals when settings has nothing recognizable', () => {
    expect(extractExpectedVisuals(container('c1', {}), 1)).toEqual([]);
  });
});

describe('buildRenderCheckCall', () => {
  it('builds a novamira/execute-js ability call embedding selectors and properties', () => {
    const call = buildRenderCheckCall('https://example.com/page', ['#s1', '#s2'], ['background-color']);
    expect(call.ability).toBe('novamira/execute-js');
    expect(call.params['url']).toBe('https://example.com/page');
    expect(call.params['code']).toContain('#s1');
    expect(call.params['code']).toContain('#s2');
    expect(call.params['code']).toContain('background-color');
  });
});
