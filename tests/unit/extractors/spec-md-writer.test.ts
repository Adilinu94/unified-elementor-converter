import { describe, it, expect } from 'vitest';
import { renderOverviewMd, renderSectionMd } from '@elconv/extractors';
import type { PageSpec, SectionSpec } from '@elconv/extractors';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSpec(overrides: Partial<PageSpec> = {}): PageSpec {
  return {
    schemaVersion: '2.0',
    sourceUrl: 'https://example.com/hirelix/',
    extractedAt: '2026-06-25T10:00:00.000Z',
    sectionCount: 2,
    hasHeader: true,
    hasFooter: true,
    sourceFramework: 'wordpress',
    tokens: {
      colors: { primary: '#0E2A3B', white: '#FFFFFF' },
      fonts: { heading: 'Manrope', body: 'Roboto' },
      spacing: { sectionY: '80px' },
      radii: {},
      shadows: {},
    },
    sections: [
      {
        section_id: 'sec-1',
        kind: 'hero',
        y_range: [0, 850],
        selector: 'section.hero-wrapper',
        widgets: [
          { kind: 'heading', widget_id: 'w1', text: 'Welcome to Hirelix' },
          { kind: 'button', widget_id: 'w2', text: 'Get Started', href: '#contact' },
        ],
        notes: ['Large height + h1 detected'],
      },
      {
        section_id: 'sec-2',
        kind: 'features',
        y_range: [850, 1600],
        selector: 'section.features-grid',
        widgets: [
          { kind: 'image', widget_id: 'w3', asset: 'assets/icon-check.svg' },
          { kind: 'text', widget_id: 'w4', text: 'Fast deployment' },
        ],
        style: { 'background-color': '#F5F5F5' },
        tokens: { background: { path: 'colors.white', fallback: '#FFFFFF' } },
      },
    ],
    assetSummary: { images: 4, svgs: 2, fonts: 3, favicons: 1 },
    warnings: [],
    ...overrides,
  };
}

function makeSection(overrides: Partial<SectionSpec> = {}): SectionSpec {
  return {
    section_id: 'sec-test',
    kind: 'hero',
    y_range: [0, 600],
    selector: 'section.hero',
    widgets: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// renderOverviewMd
// ---------------------------------------------------------------------------
describe('spec-md-writer: renderOverviewMd', () => {
  it('includes page hostname in heading', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('# Page Spec — example.com');
  });

  it('includes source URL', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('https://example.com/hirelix/');
  });

  it('includes extraction date (YYYY-MM-DD only)', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('2026-06-25');
    expect(md).not.toContain('2026-06-25T'); // no ISO full string in overview
  });

  it('shows section count and header/footer flags', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('Sections:** 2');
    expect(md).toContain('Header:** yes');
    expect(md).toContain('Footer:** yes');
  });

  it('shows framework when set', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('wordpress');
  });

  it('omits framework line when not set', () => {
    const spec = makeSpec({ sourceFramework: undefined });
    const md = renderOverviewMd(spec);
    expect(md).not.toContain('Framework');
  });

  it('renders section table with correct file links', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('[section-01-hero.spec.md]');
    expect(md).toContain('[section-02-features.spec.md]');
  });

  it('renders section table with selectors', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('section.hero-wrapper');
    expect(md).toContain('section.features-grid');
  });

  it('renders asset summary table', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('## Assets');
    expect(md).toContain('| 4 |'); // images
    expect(md).toContain('| 1 |'); // favicons in same row
  });

  it('renders design token sections', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).toContain('## Design Tokens');
    expect(md).toContain('`primary`: #0E2A3B');
    expect(md).toContain('`heading`: Manrope');
    expect(md).toContain('`sectionY`: 80px');
  });

  it('omits Design Tokens section when all token groups are empty', () => {
    const spec = makeSpec({
      tokens: { colors: {}, fonts: {}, spacing: {}, radii: {}, shadows: {} },
    });
    const md = renderOverviewMd(spec);
    expect(md).not.toContain('## Design Tokens');
  });

  it('renders warnings when present', () => {
    const spec = makeSpec({ warnings: ['Token colors.accent unresolved'] });
    const md = renderOverviewMd(spec);
    expect(md).toContain('## Warnings');
    expect(md).toContain('Token colors.accent unresolved');
  });

  it('omits Warnings section when empty', () => {
    const md = renderOverviewMd(makeSpec());
    expect(md).not.toContain('## Warnings');
  });
});

// ---------------------------------------------------------------------------
// renderSectionMd
// ---------------------------------------------------------------------------
describe('spec-md-writer: renderSectionMd', () => {
  it('includes section index and kind in heading', () => {
    const md = renderSectionMd(makeSection({ kind: 'hero' }), 1, 'https://example.com');
    expect(md).toContain('# Section 1 — hero');
  });

  it('includes selector and y_range', () => {
    const md = renderSectionMd(makeSection(), 1, 'https://example.com');
    expect(md).toContain('section.hero');
    expect(md).toContain('0–600 px');
  });

  it('renders widget count in heading', () => {
    const section = makeSection({
      widgets: [
        { kind: 'heading', widget_id: 'w1', text: 'Hello' },
        { kind: 'button', widget_id: 'w2', text: 'CTA', href: '#' },
      ],
    });
    const md = renderSectionMd(section, 1, 'https://example.com');
    expect(md).toContain('## Widgets (2)');
  });

  it('renders widget table rows', () => {
    const section = makeSection({
      widgets: [
        { kind: 'heading', widget_id: 'w1', text: 'Hello World' },
        { kind: 'image', widget_id: 'w2', asset: 'assets/photo.jpg' },
        { kind: 'button', widget_id: 'w3', href: '#contact' },
      ],
    });
    const md = renderSectionMd(section, 1, 'https://example.com');
    expect(md).toContain('heading');
    expect(md).toContain('Hello World');
    expect(md).toContain('photo.jpg');
    expect(md).toContain('#contact');
  });

  it('shows "no widgets" message when widgets array is empty', () => {
    const md = renderSectionMd(makeSection({ widgets: [] }), 1, 'https://example.com');
    expect(md).toContain('_No widgets detected._');
  });

  it('truncates long widget text at 50 chars', () => {
    const longText = 'A'.repeat(60);
    const section = makeSection({
      widgets: [{ kind: 'text', widget_id: 'w1', text: longText }],
    });
    const md = renderSectionMd(section, 1, 'https://example.com');
    expect(md).toContain('…');
    // Should not exceed 53 chars (50 + ellipsis + some markup)
    const row = md.split('\n').find((l) => l.includes('text'));
    expect(row?.length).toBeLessThan(120);
  });

  it('renders style block as CSS fenced code', () => {
    const section = makeSection({
      style: { 'background-color': '#0E2A3B', padding: '80px 0' },
    });
    const md = renderSectionMd(section, 1, 'https://example.com');
    expect(md).toContain('## Style');
    expect(md).toContain('```css');
    expect(md).toContain('background-color: #0E2A3B;');
    expect(md).toContain('padding: 80px 0;');
  });

  it('omits Style section when style is empty', () => {
    const md = renderSectionMd(makeSection({ style: {} }), 1, 'https://example.com');
    expect(md).not.toContain('## Style');
  });

  it('renders Token References table', () => {
    const section = makeSection({
      tokens: {
        background: { path: 'colors.primary', fallback: '#0E2A3B' },
        font: { path: 'fonts.heading' },
      },
    });
    const md = renderSectionMd(section, 1, 'https://example.com');
    expect(md).toContain('## Token References');
    expect(md).toContain('`colors.primary`');
    expect(md).toContain('#0E2A3B');
    expect(md).toContain('`fonts.heading`');
  });

  it('renders Notes list', () => {
    const section = makeSection({ notes: ['Detected as hero: h1 + large height', 'Has fullscreen background'] });
    const md = renderSectionMd(section, 1, 'https://example.com');
    expect(md).toContain('## Notes');
    expect(md).toContain('- Detected as hero: h1 + large height');
    expect(md).toContain('- Has fullscreen background');
  });

  it('omits Notes section when notes array is absent', () => {
    const md = renderSectionMd(makeSection({ notes: undefined }), 1, 'https://example.com');
    expect(md).not.toContain('## Notes');
  });

  it('includes source page URL in header', () => {
    const md = renderSectionMd(makeSection(), 3, 'https://preview.raddito.net/hirelix/');
    expect(md).toContain('preview.raddito.net');
  });
});
