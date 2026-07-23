import { describe, it, expect } from 'vitest';
import { mapElementToWidget, classifySection } from '@elconv/target-v3';
describe('Widget Mapper', () => {
    it('maps h1 → heading', () => {
        const result = mapElementToWidget('h1', 'h1.title', { 'font-size': '48px', color: '#333' }, 'Hello');
        expect(result.type).toBe('heading');
        expect(result.settings.header_size).toBe('h1');
        expect(result.content).toBe('Hello');
    });
    it('maps p → text-editor', () => {
        const result = mapElementToWidget('p', 'p.intro', { color: '#666' }, 'Text');
        expect(result.type).toBe('text-editor');
    });
    it('maps button → button', () => {
        const result = mapElementToWidget('button', 'button.cta', { 'background-color': '#007bff' }, 'Click');
        expect(result.type).toBe('button');
    });
    it('maps a.btn → button', () => {
        const result = mapElementToWidget('a', 'a.btn-primary', {}, 'Link');
        expect(result.type).toBe('button');
    });
    it('maps img → image', () => {
        const result = mapElementToWidget('img', 'img.hero', {}, undefined);
        expect(result.type).toBe('image');
    });
    it('maps form → form with Pro warning', () => {
        const result = mapElementToWidget('form', 'form.contact', {}, undefined);
        expect(result.type).toBe('form');
        expect(result.warnings).toContain('form widget requires Elementor Pro');
    });
    it('maps unknown → html fallback', () => {
        const result = mapElementToWidget('canvas', 'canvas#chart', {}, undefined);
        expect(result.type).toBe('html');
        expect(result.warnings.length).toBeGreaterThan(0);
    });
});
describe('Style Classifier', () => {
    it('classifies sticky header', () => {
        const result = classifySection({ selector: 'header', tag: 'header', styles: { position: 'sticky' } }, []);
        expect(result).toBe('sticky-header');
    });
    it('classifies footer', () => {
        const result = classifySection({ selector: 'footer', tag: 'footer', styles: { 'padding-top': '80px', 'padding-bottom': '80px' } }, []);
        expect(result).toBe('footer');
    });
    it('classifies hero', () => {
        const result = classifySection({ selector: 'section.hero', tag: 'section', styles: {}, yRange: [0, 800] }, [{ selector: 'h1', tag: 'h1', styles: {} }]);
        expect(result).toBe('hero');
    });
    it('classifies card-grid', () => {
        const result = classifySection({ selector: 'div.grid', tag: 'div', styles: { display: 'grid' } }, [
            { selector: 'div.card', tag: 'div', styles: {} },
            { selector: 'div.card', tag: 'div', styles: {} },
            { selector: 'div.card', tag: 'div', styles: {} },
        ]);
        expect(result).toBe('card-grid');
    });
    it('defaults to content', () => {
        const result = classifySection({ selector: 'div.wrapper', tag: 'div', styles: {} }, []);
        expect(result).toBe('content');
    });
});
//# sourceMappingURL=classifier.test.js.map