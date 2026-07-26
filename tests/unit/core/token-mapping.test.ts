import { describe, it, expect } from 'vitest';
import { mapDesignTokens, mapColorToken, mapFontToken, mapSpacingToken } from '@elconv/core';
import type { DesignTokens } from '@elconv/core';

const sampleTokens: DesignTokens = {
  $schema: 'https://site-clone-to-v3.local/schemas/design-tokens.v2.json',
  source_url: 'https://example.com',
  extracted_at: new Date().toISOString(),
  colors: [
    { id: 'primary', hex: '#0c211f', occurrences: 0, gv_id: null, role: 'primary' },
    { id: 'background', hex: '#ffffff', occurrences: 0, gv_id: null, role: 'background' },
    { id: 'text', hex: '#333333', occurrences: 0, gv_id: null, role: 'text' },
  ],
  fonts: [
    { id: 'body', family: 'Inter, sans-serif', occurrences: 0, gv_id: null, role: 'body' },
    { id: 'heading', family: 'Playfair Display, serif', occurrences: 0, gv_id: null, role: 'heading' },
  ],
  sizes: [
    { id: 'section', px: 114, occurrences: 0, gv_id: null },
    { id: 'container', px: 1200, occurrences: 0, gv_id: null },
  ],
  user_overrides: {},
};

describe('token-mapping', () => {
  describe('mapColorToken', () => {
    it('creates a color variable with prefixed id', () => {
      const v = mapColorToken('primary', '#0c211f');
      expect(v.id).toMatch(/^sv-[a-f0-9]{6,}$/);
      expect(v.type).toBe('color');
      expect(v.value).toBe('#0c211f');
      expect(v.label).toBe('Primary');
      expect(v.synced).toBe(false);
    });

    it('respects custom prefix', () => {
      const v = mapColorToken('primary', '#0c211f', { prefix: 'x' });
      expect(v.id).toMatch(/^x-[a-f0-9]{6,}$/);
    });

    it('attaches existingId when matched', () => {
      const v = mapColorToken('primary', '#0c211f', {
        existingVariables: [{ id: 'real-id-123', label: 'Primary', value: '#0c211f' }],
      });
      expect(v.existingId).toBe('real-id-123');
    });
  });

  describe('mapFontToken', () => {
    it('creates a font variable', () => {
      const v = mapFontToken('body', 'Inter, sans-serif');
      expect(v.id).toMatch(/^sv-[a-z0-9-]+$/);
      expect(v.type).toBe('font');
      expect(v.value).toBe('Inter, sans-serif');
    });
  });

  describe('mapSpacingToken', () => {
    it('creates a size variable for spacing', () => {
      const v = mapSpacingToken('section', '114px');
      expect(v.id).toMatch(/^sv-114/);
      expect(v.type).toBe('size');
      expect(v.value).toBe('114px');
    });
  });

  describe('mapDesignTokens', () => {
    it('groups tokens by type', () => {
      const result = mapDesignTokens(sampleTokens);
      expect(result.colors).toHaveLength(3);
      expect(result.fonts).toHaveLength(2);
      expect(result.spacings).toHaveLength(2);
    });

    it('deduplicates identical values', () => {
      const dupTokens: DesignTokens = {
        ...sampleTokens,
        colors: [
          { id: 'primary', hex: '#0c211f', occurrences: 0, gv_id: null },
          { id: 'brand', hex: '#0c211f', occurrences: 0, gv_id: null },
        ],
      };
      const result = mapDesignTokens(dupTokens);
      expect(result.colors).toHaveLength(1);
    });

    it('skips color tokens with no hex set', () => {
      const bad: DesignTokens = {
        ...sampleTokens,
        colors: [{ id: 'weird', occurrences: 0, gv_id: null }],
      };
      const result = mapDesignTokens(bad);
      expect(result.colors).toHaveLength(0);
    });

    it('skips font tokens with no family set', () => {
      const bad: DesignTokens = {
        ...sampleTokens,
        fonts: [{ id: 'size', occurrences: 0, gv_id: null }],
      };
      const result = mapDesignTokens(bad);
      expect(result.fonts).toHaveLength(0);
    });

    it('builds classes for color tokens', () => {
      const result = mapDesignTokens(sampleTokens);
      expect(result.classes.length).toBeGreaterThanOrEqual(3);
      for (const c of result.classes) {
        expect(c.selector).toMatch(/^\.sv-/);
      }
    });
  });
});
