import { describe, it, expect } from 'vitest';
import { runTokenPipeline } from '@elconv/core';

describe('runTokenPipeline', () => {
  const input = {
    colorStyles: [{ id: 'c1', name: 'Brand', value: '#ff0000' }],
    textStyles: [
      { id: 't1', name: 'H1', fontFamily: 'Inter', fontSize: 40, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0 },
      { id: 't2', name: 'Body', fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0 },
    ],
  };

  it('produces one KitColor per FramerColorStyle', () => {
    const result = runTokenPipeline(input);
    expect(result.kitColors).toEqual([{ id: expect.stringMatching(/^color_/), title: 'Brand', color: '#ff0000' }]);
  });

  it('produces one KitTypography per FramerTextStyle', () => {
    const result = runTokenPipeline(input);
    expect(result.kitTypography).toHaveLength(2);
    expect(result.kitTypography[0]!.fontSize).toEqual({ size: 40, unit: 'px' });
  });

  it('deduplicates font registrations by family, merging weights from all text styles using it', () => {
    const result = runTokenPipeline(input);
    expect(result.fontRegistrations).toHaveLength(1); // both text styles use Inter
    expect(result.fontRegistrations[0]!.weights).toEqual([400, 700]); // sorted ascending
  });

  it('summary.uniqueFonts counts distinct font families, not text styles', () => {
    const result = runTokenPipeline(input);
    expect(result.summary.uniqueFonts).toBe(1);
    expect(result.summary.totalTextStyles).toBe(2);
  });

  it('builds a Google Fonts URL with + for spaces and ; for multiple weights', () => {
    const result = runTokenPipeline({
      colorStyles: [],
      textStyles: [{ id: 't1', name: 'X', fontFamily: 'Open Sans', fontSize: 16, fontWeight: 400, lineHeight: 1, letterSpacing: 0 }],
    });
    expect(result.fontRegistrations[0]!.googleFontsUrl).toContain('family=Open+Sans');
  });

  it('the WPCode font-link snippet includes preconnect tags plus one stylesheet link per registered font', () => {
    const result = runTokenPipeline(input);
    expect(result.wpcodeFontLink).toContain('preconnect');
    expect(result.wpcodeFontLink.match(/<link href=/g)).toHaveLength(1); // 1 family (deduped)
  });

  it('generates exactly 4 MCP calls: kit-colors, kit-typography, N font registrations, 1 wpcode snippet', () => {
    const result = runTokenPipeline(input);
    expect(result.mcpCalls).toHaveLength(4); // colors + typography + 1 font-family + 1 wpcode
    expect(result.mcpCalls[0]!.ability).toBe('novamira-adrianv2/set-active-kit');
    expect(result.mcpCalls[0]!.params.section).toBe('colors');
    expect(result.mcpCalls[1]!.params.section).toBe('typography');
  });

  it('the WPCode snippet call never includes a priority field (matches wpcode-helper safety rule)', () => {
    const result = runTokenPipeline(input);
    const snippetCall = result.mcpCalls.find((c) => c.ability === 'novamira-adrianv2/create-wpcode-snippet')!;
    expect(snippetCall.params).not.toHaveProperty('priority');
  });

  it('handles zero colors/text styles without throwing', () => {
    const result = runTokenPipeline({ colorStyles: [], textStyles: [] });
    expect(result.kitColors).toEqual([]);
    expect(result.fontRegistrations).toEqual([]);
    expect(result.mcpCalls).toHaveLength(3); // colors + typography + wpcode (0 font registrations)
  });

  it('registers each distinct font family as its own MCP call', () => {
    const result = runTokenPipeline({
      colorStyles: [],
      textStyles: [
        { id: 't1', name: 'A', fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: 1, letterSpacing: 0 },
        { id: 't2', name: 'B', fontFamily: 'Roboto', fontSize: 16, fontWeight: 400, lineHeight: 1, letterSpacing: 0 },
      ],
    });
    const fontCalls = result.mcpCalls.filter((c) => c.ability === 'novamira-adrianv2/register-google-font');
    expect(fontCalls).toHaveLength(2);
    expect(fontCalls.map((c) => c.params.family).sort()).toEqual(['Inter', 'Roboto']);
  });
});
