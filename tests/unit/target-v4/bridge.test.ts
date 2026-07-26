import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapWidgetType,
  mapElType,
  convertSettings,
  generateStyleClass,
  convertElement,
  bridgeV3toV4,
  validateBridgeOutput,
  resetBridgeIds,
} from '@elconv/target-v4';
import type { V3Element } from '@elconv/target-v3';

describe('Bridge V3→V4', () => {
  beforeEach(() => resetBridgeIds());

  describe('mapWidgetType', () => {
    it('maps heading → e-heading', () => {
      expect(mapWidgetType('heading')).toBe('e-heading');
    });

    it('maps text-editor → e-paragraph', () => {
      expect(mapWidgetType('text-editor')).toBe('e-paragraph');
    });

    it('maps button → e-button', () => {
      expect(mapWidgetType('button')).toBe('e-button');
    });

    it('maps container → e-flexbox', () => {
      expect(mapWidgetType('container')).toBe('e-flexbox');
    });

    it('falls back to e-div-block for unknown', () => {
      expect(mapWidgetType('unknown-widget')).toBe('e-div-block');
    });

    it('throws in strict mode for unknown', () => {
      expect(() => mapWidgetType('unknown-widget', true)).toThrow('Unmappable');
    });
  });

  describe('mapElType', () => {
    it('maps section → e-flexbox', () => {
      expect(mapElType('section')).toBe('e-flexbox');
    });

    it('maps column → e-flexbox', () => {
      expect(mapElType('column')).toBe('e-flexbox');
    });

    it('maps widget → e-div-block', () => {
      expect(mapElType('widget')).toBe('e-div-block');
    });
  });

  describe('convertSettings', () => {
    it('wraps font_size as $$type size', () => {
      const result = convertSettings({ font_size: 24 });
      expect(result.font_size).toEqual({ '$$type': 'size', value: { size: 24, unit: 'px' } });
    });

    it('wraps color properties', () => {
      const result = convertSettings({ _color: '#ff0000' });
      expect(result._color).toEqual({ '$$type': 'color', value: '#ff0000' });
    });

    it('wraps padding as dimensions', () => {
      const result = convertSettings({ padding: { top: 10, right: 20, bottom: 10, left: 20, unit: 'px' } });
      expect(result.padding).toMatchObject({ '$$type': 'dimensions' });
    });

    it('passes through other values', () => {
      const result = convertSettings({ title: 'Hello', align: 'center' });
      expect(result.title).toBe('Hello');
      expect(result.align).toBe('center');
    });

    it('handles undefined settings', () => {
      expect(convertSettings(undefined)).toEqual({});
    });
  });

  describe('generateStyleClass', () => {
    it('generates style class from settings with style props', () => {
      const style = generateStyleClass('el1', { padding: { top: 10 }, _color: '#fff' });
      expect(style).not.toBeNull();
      expect(style!.id).toBe('style_el1');
      expect(style!.type).toBe('class');
    });

    it('returns null for empty settings', () => {
      expect(generateStyleClass('el1', { title: 'Hello' })).toBeNull();
    });
  });

  describe('convertElement', () => {
    it('converts V3 section to e-flexbox', () => {
      const v3: V3Element = { id: 's1', elType: 'section', settings: {} };
      const v4 = convertElement(v3);
      expect(v4.type).toBe('e-flexbox');
      expect(v4.id).toBe('s1');
    });

    it('converts V3 heading widget to e-heading', () => {
      const v3: V3Element = { id: 'h1', elType: 'widget', widgetType: 'heading', settings: { title: 'Hi' } };
      const v4 = convertElement(v3);
      expect(v4.type).toBe('e-heading');
      expect(v4.widgetType).toBe('e-heading');
    });

    it('converts children recursively', () => {
      const v3: V3Element = {
        id: 's1',
        elType: 'section',
        elements: [
          { id: 'c1', elType: 'column', elements: [{ id: 'w1', elType: 'widget', widgetType: 'button' }] },
        ],
      };
      const v4 = convertElement(v3);
      expect(v4.elements).toHaveLength(1);
      expect(v4.elements![0].type).toBe('e-flexbox');
      expect(v4.elements![0].elements![0].type).toBe('e-button');
    });

    it('generates new IDs when preserveIds=false', () => {
      const v3: V3Element = { id: 'orig', elType: 'section' };
      const v4 = convertElement(v3, { preserveIds: false });
      expect(v4.id).not.toBe('orig');
      expect(v4.id).toMatch(/^br_/);
    });
  });

  describe('bridgeV3toV4', () => {
    it('bridges full tree', () => {
      const v3Tree: V3Element[] = [
        {
          id: 'sec1',
          elType: 'section',
          elements: [
            { id: 'col1', elType: 'column', elements: [
              { id: 'h1', elType: 'widget', widgetType: 'heading', settings: { title: 'Hello' } },
              { id: 'p1', elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>World</p>' } },
            ]},
          ],
        },
      ];
      const result = bridgeV3toV4(v3Tree);
      expect(result.tree).toHaveLength(1);
      expect(result.mappedCount).toBe(4);
      expect(result.skippedCount).toBe(0);
      expect(result.tree[0].type).toBe('e-flexbox');
    });
  });

  describe('validateBridgeOutput', () => {
    it('passes valid V4 tree', () => {
      const v4Tree = [{ type: 'e-flexbox', elType: 'e-flexbox', widgetType: 'e-flexbox', id: 'x', settings: {}, styles: {} }];
      const result = validateBridgeOutput(v4Tree);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('detects V3 contamination', () => {
      const bad = [{ type: 'e-flexbox', elType: 'section', widgetType: 'e-flexbox', id: 'x', settings: {}, styles: {} }];
      const result = validateBridgeOutput(bad);
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toContain('section');
    });

    it('detects non-e- types', () => {
      const bad = [{ type: 'container', elType: 'widget', widgetType: 'container', id: 'x', settings: {}, styles: {} }];
      const result = validateBridgeOutput(bad);
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toContain("doesn't follow V4 naming");
    });
  });
});
