import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildGlassHeader,
  resetGlassHeaderIds,
} from '../../../packages/target-v3/src/patterns/glass-header.ts';
import {
  buildStatRow,
  resetStatRowIds,
} from '../../../packages/target-v3/src/patterns/stat-row.ts';
import {
  buildServiceCards,
  resetServiceCardsIds,
} from '../../../packages/target-v3/src/patterns/service-cards.ts';
import {
  listV3Patterns,
  resetAllV3PatternIds,
} from '../../../packages/target-v3/src/patterns/index.ts';

describe('V3 Pattern: Glass Header', () => {
  beforeEach(() => resetGlassHeaderIds());

  it('builds a container with heading and button', () => {
    const result = buildGlassHeader({ title: 'Welcome' });
    expect(result.elType).toBe('container');
    expect(result.elements).toBeDefined();
    expect(result.elements!.length).toBeGreaterThanOrEqual(2);
  });

  it('includes title as heading widget', () => {
    const result = buildGlassHeader({ title: 'Hello World' });
    const heading = result.elements!.find((el) => el.widgetType === 'heading');
    expect(heading).toBeDefined();
    expect(heading!.settings!.title).toBe('Hello World');
  });

  it('includes subtitle when provided', () => {
    const result = buildGlassHeader({ title: 'Title', subtitle: 'Subtitle text' });
    const textEditor = result.elements!.find((el) => el.widgetType === 'text-editor');
    expect(textEditor).toBeDefined();
    expect(textEditor!.settings!.editor).toContain('Subtitle text');
  });

  it('includes logo when provided', () => {
    const result = buildGlassHeader({ title: 'Title', logoUrl: 'https://example.com/logo.png' });
    const image = result.elements!.find((el) => el.widgetType === 'image');
    expect(image).toBeDefined();
  });

  it('applies glassmorphism styles', () => {
    const result = buildGlassHeader({ title: 'Title', blurAmount: 15 });
    expect(result.settings!.backdrop_filter_blur).toEqual({ unit: 'px', size: 15 });
  });

  it('uses only V3 widget types (no V4 contamination)', () => {
    const result = buildGlassHeader({ title: 'Title', subtitle: 'Sub', logoUrl: 'logo.png' });
    const json = JSON.stringify(result);
    expect(json).not.toContain('e-flexbox');
    expect(json).not.toContain('$$type');
    expect(json).not.toContain('e-heading');
  });
});

describe('V3 Pattern: Stat Row', () => {
  beforeEach(() => resetStatRowIds());

  it('builds a row of stat cards', () => {
    const result = buildStatRow({
      stats: [
        { value: '100', label: 'Users' },
        { value: '50', label: 'Projects' },
      ],
    });
    expect(result.elType).toBe('container');
    expect(result.elements!.length).toBe(2);
  });

  it('displays stat values with prefix/suffix', () => {
    const result = buildStatRow({
      stats: [{ value: '99', label: 'Uptime', suffix: '%' }],
    });
    const card = result.elements![0];
    const heading = card.elements!.find((el) => el.widgetType === 'heading');
    expect(heading!.settings!.title).toBe('99%');
  });

  it('applies accent color to values', () => {
    const result = buildStatRow({
      stats: [{ value: '42', label: 'Answer' }],
      accentColor: '#FF0000',
    });
    const card = result.elements![0];
    const heading = card.elements!.find((el) => el.widgetType === 'heading');
    expect(heading!.settings!.title_color).toBe('#FF0000');
  });

  it('uses only V3 widget types', () => {
    const result = buildStatRow({
      stats: [{ value: '1', label: 'Test' }],
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('e-flexbox');
    expect(json).not.toContain('$$type');
  });
});

describe('V3 Pattern: Service Cards', () => {
  beforeEach(() => resetServiceCardsIds());

  it('builds a grid of service cards', () => {
    const result = buildServiceCards({
      cards: [
        { title: 'Service 1', description: 'Description 1' },
        { title: 'Service 2', description: 'Description 2' },
      ],
    });
    expect(result.elType).toBe('container');
    // Should have a grid container inside
    const gridContainer = result.elements!.find((el) => el.elType === 'container');
    expect(gridContainer).toBeDefined();
    expect(gridContainer!.elements!.length).toBe(2);
  });

  it('includes section title when provided', () => {
    const result = buildServiceCards({
      cards: [{ title: 'Card', description: 'Desc' }],
      sectionTitle: 'Our Services',
    });
    const heading = result.elements!.find((el) => el.widgetType === 'heading');
    expect(heading).toBeDefined();
    expect(heading!.settings!.title).toBe('Our Services');
  });

  it('includes icons when provided', () => {
    const result = buildServiceCards({
      cards: [{ title: 'Card', description: 'Desc', icon: 'fas fa-star' }],
    });
    const gridContainer = result.elements!.find((el) => el.elType === 'container');
    const card = gridContainer!.elements![0];
    const icon = card.elements!.find((el) => el.widgetType === 'icon');
    expect(icon).toBeDefined();
  });

  it('includes link buttons when provided', () => {
    const result = buildServiceCards({
      cards: [{ title: 'Card', description: 'Desc', linkText: 'Learn More', linkHref: '/more' }],
    });
    const gridContainer = result.elements!.find((el) => el.elType === 'container');
    const card = gridContainer!.elements![0];
    const button = card.elements!.find((el) => el.widgetType === 'button');
    expect(button).toBeDefined();
    expect(button!.settings!.text).toBe('Learn More');
  });

  it('uses only V3 widget types', () => {
    const result = buildServiceCards({
      cards: [{ title: 'Card', description: 'Desc', icon: 'fas fa-star' }],
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('e-flexbox');
    expect(json).not.toContain('$$type');
  });
});

describe('V3 Patterns Registry', () => {
  it('lists available patterns', () => {
    const patterns = listV3Patterns();
    expect(patterns).toContain('glass-header');
    expect(patterns).toContain('stat-row');
    expect(patterns).toContain('service-cards');
  });

  it('resets all pattern IDs', () => {
    resetAllV3PatternIds();
    const result1 = buildGlassHeader({ title: 'Test' });
    resetAllV3PatternIds();
    const result2 = buildGlassHeader({ title: 'Test' });
    expect(result1.id).toBe(result2.id);
  });
});
