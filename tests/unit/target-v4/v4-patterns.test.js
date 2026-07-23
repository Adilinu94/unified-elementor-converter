import { describe, it, expect, beforeEach } from 'vitest';
import { buildV4GlassHeader, resetV4GlassHeaderIds, } from '../../../packages/target-v4/src/patterns/glass-header.ts';
import { buildV4StatRow, resetV4StatRowIds, } from '../../../packages/target-v4/src/patterns/stat-row.ts';
import { listV4Patterns, resetAllV4PatternIds, } from '../../../packages/target-v4/src/patterns/index.ts';
describe('V4 Pattern: Glass Header (Atomic)', () => {
    beforeEach(() => resetV4GlassHeaderIds());
    it('builds an e-flexbox container', () => {
        const result = buildV4GlassHeader({ title: 'Welcome' });
        expect(result.type).toBe('e-flexbox');
        expect(result.elType).toBe('e-flexbox');
        expect(result.elements).toBeDefined();
    });
    it('includes e-heading for title', () => {
        const result = buildV4GlassHeader({ title: 'Hello World' });
        const heading = result.elements.find((el) => el.type === 'e-heading');
        expect(heading).toBeDefined();
        expect(heading.settings.title).toBe('Hello World');
    });
    it('includes e-paragraph for subtitle', () => {
        const result = buildV4GlassHeader({ title: 'Title', subtitle: 'Subtitle text' });
        const paragraph = result.elements.find((el) => el.type === 'e-paragraph');
        expect(paragraph).toBeDefined();
        expect(paragraph.settings.content).toBe('Subtitle text');
    });
    it('includes e-image for logo', () => {
        const result = buildV4GlassHeader({ title: 'Title', logoUrl: 'https://example.com/logo.png' });
        const image = result.elements.find((el) => el.type === 'e-image');
        expect(image).toBeDefined();
    });
    it('includes e-button for CTA', () => {
        const result = buildV4GlassHeader({ title: 'Title', ctaText: 'Click Me' });
        const button = result.elements.find((el) => el.type === 'e-button');
        expect(button).toBeDefined();
        expect(button.settings.text).toBe('Click Me');
    });
    it('uses $$type wrapped styles', () => {
        const result = buildV4GlassHeader({ title: 'Title' });
        const json = JSON.stringify(result.styles);
        expect(json).toContain('$$type');
    });
    it('uses only V4 atomic types (no V3 contamination)', () => {
        const result = buildV4GlassHeader({ title: 'Title', subtitle: 'Sub', logoUrl: 'logo.png' });
        const json = JSON.stringify(result);
        expect(json).not.toContain('"elType":"container"');
        expect(json).not.toContain('"elType":"section"');
        expect(json).not.toContain('"widgetType":"heading"');
        expect(json).not.toContain('"widgetType":"text-editor"');
    });
    it('has style classes with variants', () => {
        const result = buildV4GlassHeader({ title: 'Title' });
        const styleKeys = Object.keys(result.styles);
        expect(styleKeys.length).toBeGreaterThan(0);
        const firstStyle = result.styles[styleKeys[0]];
        expect(firstStyle.type).toBe('class');
        expect(firstStyle.variants).toBeDefined();
        expect(firstStyle.variants.length).toBeGreaterThan(0);
    });
});
describe('V4 Pattern: Stat Row (Atomic)', () => {
    beforeEach(() => resetV4StatRowIds());
    it('builds an e-flexbox container', () => {
        const result = buildV4StatRow({
            stats: [{ value: '100', label: 'Users' }],
        });
        expect(result.type).toBe('e-flexbox');
    });
    it('creates stat cards for each stat', () => {
        const result = buildV4StatRow({
            stats: [
                { value: '100', label: 'Users' },
                { value: '50', label: 'Projects' },
            ],
        });
        expect(result.elements.length).toBe(2);
        expect(result.elements[0].type).toBe('e-flexbox');
    });
    it('displays stat values with prefix/suffix', () => {
        const result = buildV4StatRow({
            stats: [{ value: '99', label: 'Uptime', suffix: '%' }],
        });
        const card = result.elements[0];
        const heading = card.elements.find((el) => el.type === 'e-heading');
        expect(heading.settings.title).toBe('99%');
    });
    it('uses $$type wrapped styles', () => {
        const result = buildV4StatRow({
            stats: [{ value: '42', label: 'Answer' }],
        });
        const json = JSON.stringify(result);
        expect(json).toContain('$$type');
    });
    it('uses only V4 atomic types', () => {
        const result = buildV4StatRow({
            stats: [{ value: '1', label: 'Test' }],
        });
        const json = JSON.stringify(result);
        expect(json).not.toContain('"elType":"container"');
        expect(json).not.toContain('"widgetType":"heading"');
        expect(json).toContain('e-heading');
        expect(json).toContain('e-paragraph');
    });
});
describe('V4 Patterns Registry', () => {
    it('lists available patterns', () => {
        const patterns = listV4Patterns();
        expect(patterns).toContain('glass-header');
        expect(patterns).toContain('stat-row');
    });
    it('resets all pattern IDs', () => {
        resetAllV4PatternIds();
        const result1 = buildV4GlassHeader({ title: 'Test' });
        resetAllV4PatternIds();
        const result2 = buildV4GlassHeader({ title: 'Test' });
        expect(result1.id).toBe(result2.id);
    });
    it('V4 patterns are different from V3 patterns', () => {
        resetAllV4PatternIds();
        const v4Result = buildV4GlassHeader({ title: 'Test' });
        // V4 uses e-flexbox, not container
        expect(v4Result.type).toBe('e-flexbox');
        expect(v4Result.elType).toBe('e-flexbox');
        // V4 uses e-heading, not heading
        const heading = v4Result.elements.find((el) => el.type === 'e-heading');
        expect(heading).toBeDefined();
    });
});
//# sourceMappingURL=v4-patterns.test.js.map