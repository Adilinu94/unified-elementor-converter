import { describe, it, expect } from 'vitest';
import {
  isPageSpec,
  emptyTokens,
  type PageSpec,
} from '@elconv/extractors';
import {
  buildPageSpec,
  buildSectionSpec,
  classifySectionKind,
  type BuildSpecInput,
} from '@elconv/extractors';

describe('spec-schema', () => {
  it('emptyTokens() returns an empty snapshot', () => {
    const t = emptyTokens();
    expect(t.colors).toEqual({});
    expect(t.fonts).toEqual({});
    expect(t.spacing).toEqual({});
  });

  it('isPageSpec accepts a valid PageSpec', () => {
    const valid: PageSpec = {
      schemaVersion: '2.0',
      sourceUrl: 'https://example.com',
      extractedAt: new Date().toISOString(),
      sectionCount: 1,
      hasHeader: false,
      hasFooter: false,
      tokens: emptyTokens(),
      sections: [],
      assetSummary: { images: 0, svgs: 0, fonts: 0, favicons: 0 },
      warnings: [],
    };
    expect(isPageSpec(valid)).toBe(true);
  });

  it('isPageSpec rejects null / non-objects', () => {
    expect(isPageSpec(null)).toBe(false);
    expect(isPageSpec('string')).toBe(false);
    expect(isPageSpec(42)).toBe(false);
  });

  it('isPageSpec rejects wrong schemaVersion', () => {
    expect(
      isPageSpec({
        schemaVersion: '1.0',
        sourceUrl: 'x',
        extractedAt: '',
        sectionCount: 0,
        hasHeader: false,
        hasFooter: false,
        tokens: emptyTokens(),
        sections: [],
        assetSummary: { images: 0, svgs: 0, fonts: 0, favicons: 0 },
        warnings: [],
      }),
    ).toBe(false);
  });

  it('isPageSpec rejects missing sections array', () => {
    expect(
      isPageSpec({
        schemaVersion: '2.0',
        sourceUrl: 'x',
        extractedAt: '',
        sectionCount: 0,
        hasHeader: false,
        hasFooter: false,
        tokens: emptyTokens(),
        assetSummary: { images: 0, svgs: 0, fonts: 0, favicons: 0 },
        warnings: [],
      }),
    ).toBe(false);
  });
});

describe('spec-builder', () => {
  describe('classifySectionKind', () => {
    it('classifies header tag', () => {
      expect(
        classifySectionKind({ tag: 'header', classes: '', childCount: 1 }),
      ).toBe('header');
    });
    it('classifies footer tag', () => {
      expect(
        classifySectionKind({ tag: 'footer', classes: '', childCount: 1 }),
      ).toBe('footer');
    });
    it('classifies hero by class', () => {
      expect(
        classifySectionKind({ tag: 'div', classes: 'hero-section', childCount: 1 }),
      ).toBe('hero');
    });
    it('classifies features by id', () => {
      expect(
        classifySectionKind({ tag: 'div', id: 'features', classes: '', childCount: 1 }),
      ).toBe('features');
    });
    it('classifies CTA by class', () => {
      expect(
        classifySectionKind({ tag: 'section', classes: 'cta-banner', childCount: 1 }),
      ).toBe('cta');
    });
    it('classifies testimonials by class', () => {
      expect(
        classifySectionKind({ tag: 'section', classes: 'kundenstimmen', childCount: 1 }),
      ).toBe('testimonials');
    });
    it('falls back to generic', () => {
      expect(
        classifySectionKind({ tag: 'div', classes: 'unknown-thing', childCount: 5 }),
      ).toBe('generic');
    });
  });

  describe('buildSectionSpec', () => {
    it('produces a SectionSpec with auto-classified kind', () => {
      const section = buildSectionSpec({
        section_id: 'hero',
        selector: '.hero',
        y_range: [0, 600],
        layout: 'block',
        child_count: 3,
        tag: 'section',
        id: 'hero',
        classes: 'hero-section',
      });
      expect(section.kind).toBe('hero');
      expect(section.section_id).toBe('hero');
      expect(section.y_range).toEqual([0, 600]);
      expect(section.widgets).toEqual([]);
      expect(section.notes?.some((n) => n.includes('hero'))).toBe(true);
    });

    it('uses resolved widgets if provided', () => {
      const section = buildSectionSpec({
        section_id: 'cta',
        selector: '.cta',
        y_range: [0, 100],
        layout: 'block',
        child_count: 1,
        tag: 'section',
        classes: 'cta',
        resolved: {
          kind: 'cta',
          widgets: [
            { kind: 'heading', widget_id: 'cta-heading-0', text: 'Call us today' },
            { kind: 'button', widget_id: 'cta-button-1', text: 'Click me', href: '#' },
          ],
        },
      });
      expect(section.kind).toBe('cta');
      expect(section.widgets).toHaveLength(2);
      expect(section.widgets[0].text).toBe('Call us today');
    });
  });

  describe('buildPageSpec', () => {
    const baseInput: BuildSpecInput = {
      sourceUrl: 'https://example.com',
      sections: [
        {
          section_id: 'header',
          selector: '.header',
          y_range: [0, 80],
          layout: 'block',
          child_count: 1,
          tag: 'header',
          id: 'header',
          classes: 'site-header',
        },
        {
          section_id: 'hero',
          selector: '.hero',
          y_range: [100, 700],
          layout: 'flex',
          child_count: 2,
          tag: 'section',
          classes: 'hero-section',
        },
        {
          section_id: 'footer',
          selector: '.footer',
          y_range: [800, 900],
          layout: 'block',
          child_count: 1,
          tag: 'footer',
          classes: 'site-footer',
        },
      ],
      assetSummary: { images: 5, svgs: 2, fonts: 3, favicons: 1 },
    };

    it('produces a complete PageSpec with correct counts', () => {
      const spec = buildPageSpec(baseInput);
      expect(spec.schemaVersion).toBe('2.0');
      expect(spec.sourceUrl).toBe('https://example.com');
      expect(spec.sectionCount).toBe(3);
      expect(spec.hasHeader).toBe(true);
      expect(spec.hasFooter).toBe(true);
      expect(spec.sections).toHaveLength(3);
    });

    it('classifies each section correctly', () => {
      const spec = buildPageSpec(baseInput);
      expect(spec.sections[0].kind).toBe('header');
      expect(spec.sections[1].kind).toBe('hero');
      expect(spec.sections[2].kind).toBe('footer');
    });

    it('emits a warning when tokens are missing', () => {
      const spec = buildPageSpec(baseInput);
      expect(spec.warnings.some((w) => w.includes('tokens'))).toBe(true);
    });

    it('uses provided tokens when available', () => {
      const spec = buildPageSpec({
        ...baseInput,
        tokens: {
          colors: { primary: '#ff0000' },
          fonts: { body: 'Inter' },
          spacing: { sectionY: '120px' },
          radii: {},
          shadows: {},
        },
      });
      expect(spec.tokens.colors.primary).toBe('#ff0000');
      expect(spec.warnings).toEqual([]);
    });

    it('serializes to JSON and round-trips through isPageSpec', () => {
      const spec = buildPageSpec(baseInput);
      const json = JSON.parse(JSON.stringify(spec));
      expect(isPageSpec(json)).toBe(true);
    });
  });
});