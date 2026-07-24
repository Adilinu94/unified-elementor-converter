import { describe, it, expect } from 'vitest';
import {
  buildDesignTokens,
  type StyleNode,
  type FontDetected,
  type DesignTokens,
} from '@elconv/core';

function findColor(tokens: DesignTokens, role: string) {
  return tokens.colors.find((c) => c.role === role);
}
function findFont(tokens: DesignTokens, role: string) {
  return tokens.fonts.find((f) => f.role === role);
}
function findSize(tokens: DesignTokens, id: string) {
  return tokens.sizes.find((s) => s.id === id);
}

describe('design-token-extractor (orchestrator)', () => {
  it('builds a complete design-tokens.json', () => {
    const styles: StyleNode[] = [
      { selector: 'body', tag: 'BODY', styles: { color: '#1a1f36', 'background-color': '#ffffff' } },
      { selector: '.btn-primary', tag: 'BUTTON', styles: { color: '#ffffff', 'background-color': '#635bff' } },
      { selector: 'h1', tag: 'H1', styles: { 'font-family': 'Sohne', 'font-weight': '700' } },
      { selector: 'p', tag: 'P', styles: { 'font-family': 'Inter', 'font-weight': '400' } },
      { selector: 'section', tag: 'SECTION', styles: { 'min-height': '500px', 'padding-top': '80px' } },
      { selector: 'container', tag: 'DIV', styles: { 'max-width': '1140px' } },
    ];
    const cssVariables = {
      '--color-brand-primary': '#635bff',
      '--color-bg': '#ffffff',
    };
    const fontsDetected: FontDetected[] = [
      { url: 'https://example.com/sohne.woff2', type: 'woff2', family: 'Sohne' },
    ];
    const tokens = buildDesignTokens({
      styles,
      cssVariables,
      fontsDetected,
      sourceUrl: 'https://example.com/',
    });
    expect(tokens.$schema).toBe('urn:novamira:design-tokens:v1');
    expect(tokens.source_url).toBe('https://example.com/');
    expect(tokens.extracted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Colors: primary should be the brand color via CSS-var hint
    expect(findColor(tokens, 'primary')?.hex).toBe('#635bff');
    expect(findColor(tokens, 'primary')?.css_var).toBe('--color-brand-primary');
    expect(findColor(tokens, 'background')?.hex).toBe('#ffffff');
    expect(findColor(tokens, 'background')?.css_var).toBe('--color-bg');
    // Fonts
    expect(findFont(tokens, 'heading')?.family).toBe('Sohne');
    expect(findFont(tokens, 'body')?.family).toBe('Inter');
    // Spacing
    expect(findSize(tokens, 'section-padding')?.px).toBe(80);
    expect(findSize(tokens, 'container-width')?.px).toBe(1140);
    // User overrides
    expect(tokens.user_overrides).toEqual({});
  });

  it('handles empty input gracefully', () => {
    const tokens = buildDesignTokens({
      styles: [],
      cssVariables: {},
      fontsDetected: [],
      sourceUrl: 'https://empty.example.com/',
    });
    expect(findColor(tokens, 'primary')).toBeUndefined();
    expect(findColor(tokens, 'background')).toBeUndefined();
    expect(findFont(tokens, 'heading')).toBeUndefined();
    expect(findSize(tokens, 'section-padding')?.px).toBe(80);
    expect(findSize(tokens, 'container-width')?.px).toBe(1140);
  });

  it('tracks frequency for each color token', () => {
    const styles: StyleNode[] = [
      { selector: 'a', tag: 'A', styles: { color: '#1a1f36' } },
      { selector: 'b', tag: 'B', styles: { color: '#1a1f36' } },
      { selector: 'c', tag: 'C', styles: { color: '#1a1f36' } },
    ];
    const tokens = buildDesignTokens({
      styles,
      cssVariables: {},
      fontsDetected: [],
      sourceUrl: 'https://test.com/',
    });
    // Low-luminance color -> assigned to 'text'
    expect(findColor(tokens, 'text')?.hex).toBe('#1a1f36');
    expect(findColor(tokens, 'text')?.occurrences).toBe(3);
  });

  it('uses luminance heuristics when no CSS-var hints are available', () => {
    const styles: StyleNode[] = [
      { selector: 'h', tag: 'H1', styles: { color: '#000000' } }, // text
      { selector: 'b', tag: 'BODY', styles: { 'background-color': '#ffffff' } }, // background
    ];
    const tokens = buildDesignTokens({
      styles,
      cssVariables: {},
      fontsDetected: [],
      sourceUrl: 'https://test.com/',
    });
    expect(findColor(tokens, 'text')?.hex).toBe('#000000');
    expect(findColor(tokens, 'background')?.hex).toBe('#ffffff');
  });
});
