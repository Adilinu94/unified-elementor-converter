import { describe, it, expect } from 'vitest';
import { mapFramerToElementor, getUnreliableMappings } from '@elconv/extractors';

describe('mapFramerToElementor', () => {
  it('maps a direct attribute unchanged', () => {
    const result = mapFramerToElementor({ textAlign: 'center' });
    expect(result.elementorSettings.align).toBe('center');
  });

  it('maps a px attribute to a {size, unit} object, dropping unparseable values', () => {
    const result = mapFramerToElementor({ width: 400, borderRadius: 'not-a-number' });
    expect(result.elementorSettings.width).toEqual({ size: 400, unit: 'px' });
    expect(result.elementorSettings.border_radius).toBeUndefined();
  });

  it('maps an enum attribute through its enumMap, falling back to the raw value if unmapped', () => {
    const result = mapFramerToElementor({ stackDirection: 'horizontal', alignment: 'unknown-value' });
    expect(result.elementorSettings.flex_direction).toBe('row');
    expect(result.elementorSettings.flex_align_items).toBe('unknown-value');
  });

  it('maps a color attribute, distinguishing heading (title_color) usage', () => {
    const result = mapFramerToElementor({ color: '#ff0000' });
    expect(result.elementorSettings.title_color).toBe('#ff0000');
  });

  it('expands the "complex" padding transform into the full 4-side + unit shape', () => {
    const result = mapFramerToElementor({ padding: { top: 10, left: 5 } });
    expect(result.elementorSettings.padding).toEqual({ top: 10, right: 0, bottom: 0, left: 5, unit: 'px', isLinked: false });
  });

  it('expands the "complex" shadow transform into an Elementor box_shadow object', () => {
    const result = mapFramerToElementor({ shadow: { x: 2, y: 4, blur: 8, color: 'rgba(0,0,0,0.5)' } });
    expect(result.elementorSettings.box_shadow).toMatchObject({
      horizontal: { size: 2, unit: 'px' },
      vertical: { size: 4, unit: 'px' },
      blur: { size: 8, unit: 'px' },
      color: 'rgba(0,0,0,0.5)',
    });
  });

  it('expands "typography" (inlineTextStyle) into individual settings + forces typography_typography:custom', () => {
    const result = mapFramerToElementor({
      inlineTextStyle: { fontSize: 24, fontFamily: 'Inter', fontWeight: 700 },
    });
    expect(result.elementorSettings.typography_typography).toBe('custom');
    expect(result.elementorSettings.typography_font_size).toEqual({ size: 24, unit: 'px' });
    expect(result.elementorSettings.typography_font_family).toBe('Inter');
  });

  it('auto-adds typography_typography:custom for standalone font* / lineHeight / letterSpacing attrs', () => {
    const result = mapFramerToElementor({ fontSize: 18 });
    expect(result.elementorSettings.typography_typography).toBe('custom');
  });

  it('warns exactly for attributes flagged v4Reliable:false, with the mapping notes included', () => {
    const result = mapFramerToElementor({ fontSize: 18, textAlign: 'center' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('fontSize');
    expect(result.warnings[0]).toContain('NOT V4-reliable');
  });

  it('collects unrecognized attributes into `unmapped` instead of throwing', () => {
    const result = mapFramerToElementor({ someRandomFramerProp: 'x' });
    expect(result.unmapped).toEqual(['someRandomFramerProp']);
    expect(result.elementorSettings).toEqual({});
  });

  it('skips null/undefined attribute values entirely (not even added to unmapped)', () => {
    const result = mapFramerToElementor({ width: undefined, height: null });
    expect(result.unmapped).toEqual([]);
    expect(result.elementorSettings).toEqual({});
  });

  it('media transform returns a {url, id:""} placeholder (real ID needs a WP upload step)', () => {
    const result = mapFramerToElementor({ backgroundImage: 'https://x/img.png' });
    expect(result.elementorSettings.background_image).toEqual({ url: 'https://x/img.png', id: '' });
  });
});

describe('getUnreliableMappings', () => {
  it('returns exactly the entries flagged v4Reliable:false', () => {
    const unreliable = getUnreliableMappings();
    expect(unreliable.length).toBeGreaterThan(0);
    expect(unreliable.every((e) => e.v4Reliable === false)).toBe(true);
    expect(unreliable.some((e) => e.framerAttr === 'fontSize')).toBe(true);
    expect(unreliable.some((e) => e.framerAttr === 'textAlign')).toBe(false); // v4Reliable:true
  });
});
