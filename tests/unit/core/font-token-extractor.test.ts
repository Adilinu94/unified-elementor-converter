import { describe, it, expect } from 'vitest';
import {
  extractFontTokens,
  mostCommon,
  resolveSource,
  type FontDetected,
  type StyleNode,
} from '@elconv/core';

describe('font-token-extractor', () => {
  describe('mostCommon', () => {
    it('returns the most frequent value', () => {
      expect(mostCommon(['a', 'b', 'a', 'c', 'a'])).toBe('a');
    });
    it('returns null for empty array', () => {
      expect(mostCommon([])).toBe(null);
    });
  });

  describe('resolveSource', () => {
    const intercepted: FontDetected[] = [
      { url: 'https://fonts.googleapis.com/css?family=Inter', type: 'google-fonts-css', family: 'Inter' },
      { url: 'https://example.com/sohne-bold.woff2', type: 'woff2', family: 'Sohne' },
    ];
    it('identifies Google Fonts', () => {
      expect(resolveSource('Inter', intercepted)).toBe('google-fonts');
    });
    it('identifies custom woff2', () => {
      expect(resolveSource('Sohne', intercepted)).toBe('custom-woff2');
    });
    it('returns system for unknown fonts', () => {
      expect(resolveSource('Helvetica', intercepted)).toBe('system');
    });
    it('returns system for null family', () => {
      expect(resolveSource(null, intercepted)).toBe('system');
    });
  });

  describe('extractFontTokens', () => {
    it('extracts heading font from h1/h2', () => {
      const styles: StyleNode[] = [
        { selector: 'h1', tag: 'H1', styles: { 'font-family': 'Sohne', 'font-weight': '700' } },
        { selector: 'h2', tag: 'H2', styles: { 'font-family': 'Sohne', 'font-weight': '600' } },
        { selector: 'p', tag: 'P', styles: { 'font-family': 'Inter', 'font-weight': '400' } },
      ];
      const fonts = extractFontTokens(styles, []);
      expect(fonts.heading.family).toBe('Sohne');
      expect(fonts.heading.weights).toEqual([600, 700]);
      expect(fonts.body.family).toBe('Inter');
      expect(fonts.body.weights).toEqual([400]);
    });
    it('detects mono fonts on <code>', () => {
      const styles: StyleNode[] = [
        { selector: 'code', tag: 'CODE', styles: { 'font-family': 'Roboto Mono' } },
        { selector: 'pre', tag: 'PRE', styles: { 'font-family': 'Roboto Mono' } },
        { selector: 'p', tag: 'P', styles: { 'font-family': 'Inter' } },
      ];
      const fonts = extractFontTokens(styles, []);
      expect(fonts.mono.family).toBe('Roboto Mono');
    });
    it('detects mono fonts by family-name pattern', () => {
      const styles: StyleNode[] = [
        { selector: 'span', tag: 'SPAN', styles: { 'font-family': 'Courier New' } },
      ];
      const fonts = extractFontTokens(styles, []);
      expect(fonts.mono.family).toBe('Courier New');
    });
    it('returns null for empty input', () => {
      const fonts = extractFontTokens([], []);
      expect(fonts.heading.family).toBe(null);
      expect(fonts.heading.weights).toEqual([]);
      expect(fonts.body.family).toBe(null);
    });
    it('resolves source from intercepted URLs', () => {
      const styles: StyleNode[] = [
        { selector: 'h1', tag: 'H1', styles: { 'font-family': 'Inter' } },
      ];
      const fonts = extractFontTokens(styles, [
        { url: 'https://fonts.googleapis.com/css2?family=Inter', type: 'google-fonts-css', family: 'Inter' },
      ]);
      expect(fonts.heading.source).toBe('google-fonts');
    });
  });
});
