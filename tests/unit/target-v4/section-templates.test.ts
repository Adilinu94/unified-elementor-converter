import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifySection,
  selectTemplate,
  getAllTemplates,
  resetV4SectionTemplateIds,
  type SectionType,
} from '@elconv/target-v4';

describe('classifySection (V4)', () => {
  it('classifies by name keyword', () => {
    expect(classifySection('Hero Banner', 1, {})).toBe('hero');
    expect(classifySection('Stats Counter', 1, {})).toBe('stats');
    expect(classifySection('Our Services', 1, {})).toBe('services');
    expect(classifySection('How it works', 1, {})).toBe('process');
    expect(classifySection('Meet the Team', 1, {})).toBe('team');
    expect(classifySection('Contact Us', 1, {})).toBe('contact');
    expect(classifySection('Site Header', 1, {})).toBe('floating-header');
  });

  it('falls back to services for many children, generic otherwise', () => {
    expect(classifySection('Random Section', 5, {})).toBe('services');
    expect(classifySection('Random Section', 1, {})).toBe('generic');
  });
});

describe('getAllTemplates (V4)', () => {
  it('returns one template per section type', () => {
    const templates = getAllTemplates();
    const types: SectionType[] = ['hero', 'stats', 'services', 'process', 'team', 'contact', 'floating-header', 'generic'];
    expect(templates).toHaveLength(types.length);
  });
});

describe('V4 template generators', () => {
  beforeEach(() => resetV4SectionTemplateIds());

  for (const type of ['hero', 'stats', 'services', 'process', 'team', 'contact', 'floating-header', 'generic'] as SectionType[]) {
    it(`${type}: produces a V4 Atomic tree (no V3 elType, every node has $$type-free settings + a styles map)`, () => {
      const template = selectTemplate(type);
      const tree = template.generate({});
      expect(tree.length).toBeGreaterThan(0);

      const walk = (nodes: typeof tree): void => {
        for (const node of nodes) {
          expect(node.elType).not.toBe('section');
          expect(node.elType).not.toBe('column');
          expect(node.elType).not.toBe('container'); // V3-only elType name
          expect(node).toHaveProperty('styles');
          if (node.elements) walk(node.elements);
        }
      };
      walk(tree);
    });
  }

  it('hero: applies custom heading/subheading params', () => {
    const tree = selectTemplate('hero').generate({ heading: 'Custom Title', subheading: 'Custom Sub' });
    const heading = tree[0].elements!.find((e) => e.widgetType === 'e-heading')!;
    const sub = tree[0].elements!.find((e) => e.widgetType === 'e-paragraph')!;
    expect(heading.settings.title).toBe('Custom Title');
    expect(sub.settings.content).toBe('Custom Sub');
  });

  it('stats: renders one e-heading per stat item', () => {
    const items = [{ title: '1' }, { title: '2' }, { title: '3' }, { title: '4' }].map((i) => ({ title: i.title, description: '' }));
    const tree = selectTemplate('stats').generate({ items });
    expect(tree[0].elements).toHaveLength(4);
  });

  it('services: renders one card per service item with a title and description', () => {
    const items = [{ title: 'X', description: 'Y' }];
    const tree = selectTemplate('services').generate({ items });
    const grid = tree[0].elements![1];
    expect(grid.elements).toHaveLength(1);
    const card = grid.elements![0];
    expect(card.elements!.find((e) => e.widgetType === 'e-heading')?.settings.title).toBe('X');
    expect(card.elements!.find((e) => e.widgetType === 'e-paragraph')?.settings.content).toBe('Y');
  });

  it('style IDs never contain hyphens (V4 atomic class-name rule)', () => {
    for (const type of ['hero', 'stats', 'services', 'generic'] as SectionType[]) {
      const tree = selectTemplate(type).generate({});
      const walk = (nodes: typeof tree): void => {
        for (const node of nodes) {
          for (const styleId of Object.keys(node.styles)) {
            expect(styleId).not.toMatch(/-/);
          }
          if (node.elements) walk(node.elements);
        }
      };
      walk(tree);
    }
  });
});
