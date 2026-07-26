import { describe, it, expect } from 'vitest';
import {
  extractCssFromHtml,
  extractDarkModeBlocks,
  extractColorOverrides,
  matchLightTokens,
  extractDarkModeVariables,
} from '@elconv/extractors';

describe('extractCssFromHtml', () => {
  it('extracts and joins inline <style> block contents', () => {
    const html = '<html><head><style>body{color:red}</style><style>.a{color:blue}</style></head></html>';
    const css = extractCssFromHtml(html);
    expect(css).toContain('body{color:red}');
    expect(css).toContain('.a{color:blue}');
  });

  it('returns an empty string when there are no style blocks', () => {
    expect(extractCssFromHtml('<html><body>hi</body></html>')).toBe('');
  });
});

describe('extractDarkModeBlocks', () => {
  it('parses a single dark-mode media block into selector/declaration pairs', () => {
    const css = `
      @media (prefers-color-scheme: dark) {
        .card { background-color: #111111; color: #eeeeee; }
      }
    `;
    const blocks = extractDarkModeBlocks(css);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].selector).toBe('.card');
    expect(blocks[0].declarations).toEqual([
      { property: 'background-color', value: '#111111' },
      { property: 'color', value: '#eeeeee' },
    ]);
  });

  it('handles nested braces inside the media block (e.g. an @supports rule)', () => {
    const css = `
      @media (prefers-color-scheme: dark) {
        @supports (color: red) { .x { color: red; } }
        .card { color: #fff; }
      }
    `;
    const blocks = extractDarkModeBlocks(css);
    const cardBlock = blocks.find((b) => b.selector === '.card');
    expect(cardBlock?.declarations).toEqual([{ property: 'color', value: '#fff' }]);
  });

  it('returns an empty array when no dark-mode block is present', () => {
    expect(extractDarkModeBlocks('.card { color: red; }')).toEqual([]);
  });
});

describe('extractColorOverrides', () => {
  it('resolves hex, rgb(), and var() fallback color values', () => {
    const overrides = extractColorOverrides([
      {
        selector: '.card',
        declarations: [
          { property: 'background-color', value: '#111' },
          { property: 'color', value: 'rgb(238, 238, 238)' },
          { property: 'border-color', value: 'var(--fallback, #ff0000)' },
        ],
      },
    ]);
    expect(overrides).toEqual([
      { selector: '.card', property: 'background-color', value: '#111', hex: '#111111' },
      { selector: '.card', property: 'color', value: 'rgb(238, 238, 238)', hex: '#eeeeee' },
      { selector: '.card', property: 'border-color', value: '#ff0000', hex: '#ff0000' },
    ]);
  });

  it('ignores non-color declarations', () => {
    const overrides = extractColorOverrides([
      { selector: '.card', declarations: [{ property: 'padding', value: '8px' }] },
    ]);
    expect(overrides).toEqual([]);
  });

  it('keeps custom-property declarations even without a recognized color prop name', () => {
    const overrides = extractColorOverrides([
      { selector: ':root', declarations: [{ property: '--brand-dark', value: '#123456' }] },
    ]);
    expect(overrides).toEqual([{ selector: ':root', property: '--brand-dark', value: '#123456', hex: '#123456' }]);
  });
});

describe('matchLightTokens', () => {
  const overrides = [
    { selector: '.card', property: 'background-color', value: '#111111', hex: '#111111' },
    { selector: '.card', property: 'color', value: 'currentColor', hex: null },
  ];

  it('matches overrides against a light-token set by hex', () => {
    const variables = matchLightTokens(overrides, {
      colors: { unique: [{ hex: '#111111', raw: '#111111', gv_id: 'gv_1' }] },
    });
    expect(variables[0].gv_id).toBe('gv_1');
    expect(variables[0].light_hex).toBe('#111111');
  });

  it('leaves gv_id/light fields null when there is no light-token match or no hex', () => {
    const variables = matchLightTokens(overrides);
    expect(variables[0].gv_id).toBeNull();
    expect(variables[1].gv_id).toBeNull();
    expect(variables[1].dark_hex).toBeNull();
  });

  it('generates a stable, prefixed token_name for every variable', () => {
    const [bg, color] = matchLightTokens(overrides);
    expect(bg.token_name).toMatch(/^dark-surface-/);
    expect(color.token_name).toMatch(/^dark-text-/);
  });
});

describe('extractDarkModeVariables (full pipeline)', () => {
  it('produces a variable set with summary counts from raw CSS', () => {
    const css = `
      @media (prefers-color-scheme: dark) {
        .card { background-color: #111111; }
        .header { background-color: #111111; color: #eeeeee; }
      }
    `;
    const result = extractDarkModeVariables(css);
    expect(result.mode).toBe('dark');
    expect(result.summary.total_variables).toBe(3);
    expect(result.summary.unique_selectors).toBe(2);
    expect(result.summary.unique_properties).toBe(2);
    expect(result.summary.matched_with_light_tokens).toBe(0);
  });

  it('returns an empty variable set when there are no dark-mode blocks', () => {
    const result = extractDarkModeVariables('.card { color: red; }');
    expect(result.variables).toEqual([]);
    expect(result.summary.total_variables).toBe(0);
  });

  it('counts matches when a light-token set is supplied', () => {
    const css = '@media (prefers-color-scheme: dark) { .card { color: #eeeeee; } }';
    const result = extractDarkModeVariables(css, {
      colors: { unique: [{ hex: '#eeeeee', raw: '#eeeeee', gv_id: 'gv_2' }] },
    });
    expect(result.summary.matched_with_light_tokens).toBe(1);
    expect(result.variables[0].light_mapping.gv_id).toBe('gv_2');
  });
});
