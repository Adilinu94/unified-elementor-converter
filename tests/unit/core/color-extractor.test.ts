import { describe, it, expect } from 'vitest';
import {
  toHex,
  hexToRgb,
  hexDistance,
  luminance,
  saturation,
  extractColorFrequency,
  clusterColors,
  assignSemanticNames,
  type StyleNode,
} from '@elconv/core';

describe('color-extractor', () => {
  describe('toHex', () => {
    it('converts rgb() to hex', () => {
      expect(toHex('rgb(99, 91, 255)')).toBe('#635bff');
    });
    it('converts rgba() to hex (ignoring full alpha)', () => {
      expect(toHex('rgba(255, 0, 0, 1)')).toBe('#ff0000');
    });
    it('skips nearly-transparent colors', () => {
      expect(toHex('rgba(0, 0, 0, 0.05)')).toBe(null);
    });
    it('normalizes 3-digit hex', () => {
      expect(toHex('#abc')).toBe('#aabbcc');
    });
    it('strips alpha from 8-digit hex', () => {
      expect(toHex('#ff0000aa')).toBe('#ff0000');
    });
    it('returns null for invalid input', () => {
      expect(toHex('not-a-color')).toBe(null);
      expect(toHex('')).toBe(null);
      expect(toHex(null)).toBe(null);
      expect(toHex(undefined)).toBe(null);
    });
  });

  describe('hexToRgb / hexDistance', () => {
    it('decodes hex to rgb triple', () => {
      expect(hexToRgb('#635bff')).toEqual([0x63, 0x5b, 0xff]);
    });
    it('returns 0 for identical colors', () => {
      expect(hexDistance('#ffffff', '#ffffff')).toBe(0);
    });
    it('returns positive for distinct colors', () => {
      expect(hexDistance('#000000', '#ffffff')).toBeGreaterThan(400);
    });
    it('returns small for near-duplicates', () => {
      expect(hexDistance('#ffffff', '#fefefe')).toBeLessThan(5);
    });
  });

  describe('luminance / saturation', () => {
    it('returns high luminance for white', () => {
      expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    });
    it('returns low luminance for black', () => {
      expect(luminance('#000000')).toBeCloseTo(0, 5);
    });
    it('returns 0 saturation for grayscale', () => {
      expect(saturation('#808080')).toBeCloseTo(0, 5);
    });
    it('returns high saturation for vivid colors', () => {
      expect(saturation('#ff0000')).toBeGreaterThan(0.9);
    });
  });

  describe('extractColorFrequency', () => {
    it('counts color usage across style nodes', () => {
      const styles: StyleNode[] = [
        { selector: 'a', tag: 'A', styles: { color: '#ff0000' } },
        { selector: 'b', tag: 'B', styles: { color: '#ff0000' } },
        { selector: 'c', tag: 'C', styles: { color: '#00ff00' } },
      ];
      const freq = extractColorFrequency(styles);
      expect(freq.get('#ff0000')).toBe(2);
      expect(freq.get('#00ff00')).toBe(1);
    });
    it('skips transparent colors', () => {
      const styles: StyleNode[] = [
        { selector: 'a', tag: 'A', styles: { 'background-color': 'rgba(0,0,0,0)' } },
      ];
      const freq = extractColorFrequency(styles);
      expect(freq.size).toBe(0);
    });
    it('reads all color properties', () => {
      const styles: StyleNode[] = [
        {
          selector: 'a', tag: 'A', styles: {
            color: '#ff0000',
            'background-color': '#00ff00',
            'border-color': '#0000ff',
            fill: '#ffff00',
            stroke: '#ff00ff',
          },
        },
      ];
      const freq = extractColorFrequency(styles);
      expect(freq.size).toBe(5);
    });
  });

  describe('clusterColors', () => {
    it('merges near-duplicate colors into one cluster', () => {
      const freq = new Map([
        ['#ffffff', 100],
        ['#fefefe', 50],
        ['#000000', 30],
      ]);
      const clusters = clusterColors(freq, { clusterThreshold: 15 });
      expect(clusters).toHaveLength(2);
      // The white cluster should have count=150 (100+50)
      const white = clusters.find((c) => c.canonical === '#ffffff');
      expect(white?.count).toBe(150);
      expect(white?.variants).toContain('#fefefe');
    });
    it('sorts clusters by frequency descending', () => {
      const freq = new Map([
        ['#111111', 5],
        ['#ffffff', 100],
        ['#000000', 50],
      ]);
      const clusters = clusterColors(freq, { clusterThreshold: 5 });
      expect(clusters[0].count).toBeGreaterThanOrEqual(clusters[1].count);
    });
    it('respects maxClusters', () => {
      const freq = new Map([
        ['#ff0000', 1], ['#00ff00', 1], ['#0000ff', 1], ['#ffff00', 1], ['#ff00ff', 1], ['#00ffff', 1],
      ]);
      const clusters = clusterColors(freq, { maxClusters: 3 });
      expect(clusters).toHaveLength(3);
    });
  });

  describe('assignSemanticNames', () => {
    it('uses CSS-variable name hints first', () => {
      const clusters = [
        { canonical: '#635bff', count: 34, variants: ['#635bff'] },
        { canonical: '#ffffff', count: 412, variants: ['#ffffff'] },
      ];
      const tokens = assignSemanticNames(clusters, {
        '--color-brand-primary': '#635bff',
        '--color-bg': '#ffffff',
      });
      expect(tokens.primary).toBe('#635bff');
      expect(tokens.background).toBe('#ffffff');
    });
    it('falls back to luminance heuristics', () => {
      const clusters = [
        { canonical: '#ffffff', count: 412, variants: ['#ffffff'] },
        { canonical: '#1a1f36', count: 203, variants: ['#1a1f36'] },
      ];
      const tokens = assignSemanticNames(clusters, {});
      expect(tokens.background).toBe('#ffffff'); // high luminance
      expect(tokens.text).toBe('#1a1f36'); // low luminance
    });
    it('returns null for unmatched roles', () => {
      const tokens = assignSemanticNames([], {});
      expect(tokens.primary).toBe(null);
      expect(tokens.accent).toBe(null);
    });
  });
});
