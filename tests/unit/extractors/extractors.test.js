import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { extractFromHtml } from '../../../packages/extractors/src/html-parser.ts';
import { extractFromFramerXml } from '../../../packages/extractors/src/framer-xml.ts';
import { extractDesignTokens, mergeTokenSets, classifyTokenRoles, tokensToCssVars, } from '../../../packages/extractors/src/design-tokens.ts';
const FIXTURES = resolve(import.meta.dirname, 'fixtures');
describe('HTML Parser Extractor', () => {
    it('extracts sections from HTML file', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        expect(result.spec.source.type).toBe('html-export');
        expect(result.spec.sections.length).toBe(3);
    });
    it('detects semantic roles', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        expect(result.spec.sections[0].semanticRole).toBe('hero');
        expect(result.spec.sections[1].semanticRole).toBe('services');
        expect(result.spec.sections[2].semanticRole).toBe('footer');
    });
    it('extracts headings as widgets', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        const heroWidgets = result.spec.sections[0].widgets;
        const heading = heroWidgets.find((w) => w.type === 'heading');
        expect(heading).toBeDefined();
        expect(heading.text).toBe('Build Amazing Websites');
    });
    it('extracts paragraphs', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        const heroWidgets = result.spec.sections[0].widgets;
        const text = heroWidgets.find((w) => w.type === 'text');
        expect(text).toBeDefined();
        expect(text.text).toContain('Convert any design');
    });
    it('extracts buttons', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        const heroWidgets = result.spec.sections[0].widgets;
        const btn = heroWidgets.find((w) => w.type === 'button');
        expect(btn).toBeDefined();
        expect(btn.text).toBe('Get Started');
        expect(btn.href).toBe('#start');
    });
    it('extracts images', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        const svcWidgets = result.spec.sections[1].widgets;
        const img = svcWidgets.find((w) => w.type === 'image');
        expect(img).toBeDefined();
        expect(img.imageUrl).toBe('https://example.com/img1.png');
    });
    it('extracts CSS variables', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        expect(result.spec.cssVars['--primary-color']).toBe('#2563eb');
        expect(result.spec.cssVars['--text-color']).toBe('#1a1a2e');
    });
    it('extracts color tokens with occurrences', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        const colors = result.spec.tokens.colors;
        expect(colors.length).toBeGreaterThan(0);
        // #2563eb appears multiple times
        const primary = colors.find((c) => c.hex === '#2563eb');
        expect(primary).toBeDefined();
        expect(primary.occurrences).toBeGreaterThanOrEqual(2);
    });
    it('detects flex layout', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        expect(result.spec.sections[1].layout).toBe('flex-row');
    });
    it('returns durationMs', async () => {
        const result = await extractFromHtml(resolve(FIXTURES, 'sample.html'));
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
});
describe('Framer XML Extractor', () => {
    it('extracts sections from Framer XML', async () => {
        const result = await extractFromFramerXml(resolve(FIXTURES, 'sample-framer.xml'));
        expect(result.spec.source.type).toBe('framer-xml');
        expect(result.spec.sections.length).toBe(3);
    });
    it('detects section roles from names', async () => {
        const result = await extractFromFramerXml(resolve(FIXTURES, 'sample-framer.xml'));
        expect(result.spec.sections[0].semanticRole).toBe('hero');
        expect(result.spec.sections[2].semanticRole).toBe('footer');
    });
    it('extracts headings from Framer nodes', async () => {
        const result = await extractFromFramerXml(resolve(FIXTURES, 'sample-framer.xml'));
        const heroWidgets = result.spec.sections[0].widgets;
        const heading = heroWidgets.find((w) => w.type === 'heading');
        expect(heading).toBeDefined();
        expect(heading.text).toBe('Welcome to Framer');
    });
    it('extracts text nodes', async () => {
        const result = await extractFromFramerXml(resolve(FIXTURES, 'sample-framer.xml'));
        const heroWidgets = result.spec.sections[0].widgets;
        const text = heroWidgets.find((w) => w.type === 'text');
        expect(text).toBeDefined();
        expect(text.text).toBe('Design faster, ship faster.');
    });
    it('extracts buttons with href', async () => {
        const result = await extractFromFramerXml(resolve(FIXTURES, 'sample-framer.xml'));
        const heroWidgets = result.spec.sections[0].widgets;
        const btn = heroWidgets.find((w) => w.type === 'button');
        expect(btn).toBeDefined();
        expect(btn.href).toBe('#signup');
    });
    it('extracts images with src', async () => {
        const result = await extractFromFramerXml(resolve(FIXTURES, 'sample-framer.xml'));
        const featWidgets = result.spec.sections[1].widgets;
        const img = featWidgets.find((w) => w.type === 'image');
        expect(img).toBeDefined();
        expect(img.imageUrl).toBe('https://example.com/feature.png');
    });
    it('detects grid layout', async () => {
        const result = await extractFromFramerXml(resolve(FIXTURES, 'sample-framer.xml'));
        expect(result.spec.sections[1].layout).toBe('grid');
    });
    it('extracts color tokens from styles', async () => {
        const result = await extractFromFramerXml(resolve(FIXTURES, 'sample-framer.xml'));
        const colors = result.spec.tokens.colors;
        expect(colors.length).toBeGreaterThan(0);
        // #0f172a appears in multiple frames
        const dark = colors.find((c) => c.hex === '#0f172a');
        expect(dark).toBeDefined();
        expect(dark.occurrences).toBeGreaterThanOrEqual(2);
    });
});
describe('Design Token Extractor', () => {
    const sampleCss = `
    .hero { background: #2563eb; color: #ffffff; font-size: 48px; }
    .text { color: #1a1a2e; font-family: 'Inter', sans-serif; }
    .btn { background: #2563eb; padding: 12px; font-size: 16px; }
    .footer { background: #1a1a2e; color: #ffffff; font-family: 'Inter', sans-serif; }
    .card { border: 1px solid #e2e8f0; padding: 24px; font-size: 16px; }
  `;
    it('extracts repeated colors', () => {
        const tokens = extractDesignTokens(sampleCss);
        const blue = tokens.colors.find((c) => c.hex === '#2563eb');
        expect(blue).toBeDefined();
        expect(blue.occurrences).toBe(2);
    });
    it('extracts font families', () => {
        const tokens = extractDesignTokens(sampleCss);
        const inter = tokens.fonts.find((f) => f.family === 'Inter');
        expect(inter).toBeDefined();
        expect(inter.occurrences).toBe(2);
    });
    it('extracts repeated sizes', () => {
        const tokens = extractDesignTokens(sampleCss);
        const size16 = tokens.sizes.find((s) => s.px === 16);
        expect(size16).toBeDefined();
        expect(size16.occurrences).toBe(2);
    });
    it('ignores single-occurrence colors', () => {
        const tokens = extractDesignTokens(sampleCss);
        const single = tokens.colors.find((c) => c.hex === '#e2e8f0');
        expect(single).toBeUndefined();
    });
    it('mergeTokenSets deduplicates and sums', () => {
        const set1 = extractDesignTokens('.a { color: #ff0000; } .b { color: #ff0000; }');
        const set2 = extractDesignTokens('.c { color: #ff0000; } .d { color: #ff0000; }');
        const merged = mergeTokenSets(set1, set2);
        const red = merged.colors.find((c) => c.hex === '#ff0000');
        expect(red).toBeDefined();
        expect(red.occurrences).toBe(4);
    });
    it('classifyTokenRoles assigns semantic roles', () => {
        const tokens = extractDesignTokens(sampleCss);
        const classified = classifyTokenRoles(tokens);
        const roles = classified.colors.map((c) => c.role);
        expect(roles.some((r) => r !== undefined)).toBe(true);
    });
    it('tokensToCssVars produces CSS custom properties', () => {
        const tokens = extractDesignTokens(sampleCss);
        const classified = classifyTokenRoles(tokens);
        const vars = tokensToCssVars(classified);
        const keys = Object.keys(vars);
        expect(keys.some((k) => k.startsWith('--elconv-color-'))).toBe(true);
    });
    it('handles rgb() colors', () => {
        const css = '.a { color: rgb(37, 99, 235); } .b { color: rgb(37, 99, 235); }';
        const tokens = extractDesignTokens(css);
        const blue = tokens.colors.find((c) => c.hex === '#2563eb');
        expect(blue).toBeDefined();
        expect(blue.occurrences).toBe(2);
    });
    it('normalizes 3-digit hex', () => {
        const css = '.a { color: #fff; } .b { color: #fff; } .c { color: #ffffff; }';
        const tokens = extractDesignTokens(css);
        const white = tokens.colors.find((c) => c.hex === '#ffffff');
        expect(white).toBeDefined();
        expect(white.occurrences).toBe(3);
    });
});
//# sourceMappingURL=extractors.test.js.map