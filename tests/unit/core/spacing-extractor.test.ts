import { describe, it, expect } from 'vitest';
import {
  extractSpacingTokens,
  parsePx,
  median,
  mode,
  type StyleNode,
} from '@elconv/core';

describe('spacing-extractor', () => {
  describe('parsePx', () => {
    it('parses px values', () => {
      expect(parsePx('80px')).toBe(80);
      expect(parsePx('0px')).toBe(0);
    });
    it('converts rem to px (16px base)', () => {
      expect(parsePx('5rem')).toBe(80);
      expect(parsePx('2.5rem')).toBe(40);
    });
    it('converts em to px (16px base)', () => {
      expect(parsePx('1.5em')).toBe(24);
    });
    it('returns 0 for invalid input', () => {
      expect(parsePx('auto')).toBe(0);
      expect(parsePx('100%')).toBe(0);
      expect(parsePx('')).toBe(0);
      expect(parsePx(null)).toBe(0);
    });
    it('rounds fractional values', () => {
      expect(parsePx('12.7px')).toBe(13);
    });
  });

  describe('median', () => {
    it('returns middle for odd-length arrays', () => {
      expect(median([1, 2, 3])).toBe(2);
      expect(median([10, 20, 30, 40, 50])).toBe(30);
    });
    it('returns average of two middles for even-length arrays', () => {
      expect(median([1, 2, 3, 4])).toBe(3);
      expect(median([10, 20, 30, 40])).toBe(25);
    });
    it('returns null for empty array', () => {
      expect(median([])).toBe(null);
    });
  });

  describe('mode', () => {
    it('returns most common value', () => {
      expect(mode([1, 2, 2, 3, 3, 3])).toBe(3);
    });
    it('returns first value when all are unique', () => {
      expect(mode([1, 2, 3])).toBe(1);
    });
    it('returns null for empty array', () => {
      expect(mode([])).toBe(null);
    });
  });

  describe('extractSpacingTokens', () => {
    it('extracts section-padding from tall sections', () => {
      const styles: StyleNode[] = [
        { selector: 's1', tag: 'SECTION', styles: { 'min-height': '600px', 'padding-top': '80px' } },
        { selector: 's2', tag: 'SECTION', styles: { 'min-height': '500px', 'padding-top': '100px' } },
        { selector: 's3', tag: 'SECTION', styles: { 'min-height': '400px', 'padding-top': '60px' } },
        { selector: 's4', tag: 'DIV', styles: { 'min-height': '100px', 'padding-top': '40px' } }, // too short, ignored
      ];
      const spacing = extractSpacingTokens(styles);
      expect(spacing.sectionPadding).toBe(80); // median of [60, 80, 100]
    });
    it('extracts container-width from max-width', () => {
      const styles: StyleNode[] = [
        { selector: 'w1', tag: 'DIV', styles: { 'max-width': '1140px' } },
        { selector: 'w2', tag: 'DIV', styles: { 'max-width': '1140px' } },
        { selector: 'w3', tag: 'DIV', styles: { 'max-width': '1200px' } },
        { selector: 'w4', tag: 'DIV', styles: { 'max-width': '100%' } }, // ignored
      ];
      const spacing = extractSpacingTokens(styles);
      expect(spacing.containerWidth).toBe(1140);
    });
    it('uses defaults when input is empty', () => {
      const spacing = extractSpacingTokens([]);
      expect(spacing.sectionPadding).toBe(80);
      expect(spacing.containerWidth).toBe(1140);
    });
    it('respects min/max container width', () => {
      const styles: StyleNode[] = [
        { selector: 's', tag: 'DIV', styles: { 'max-width': '200px' } }, // too small
        { selector: 'b', tag: 'DIV', styles: { 'max-width': '3000px' } }, // too large
      ];
      const spacing = extractSpacingTokens(styles);
      expect(spacing.containerWidth).toBe(1140); // default
    });
  });
});
