/**
 * Tests for the JSON-Guard additions (Phase 41, GAP-H) in @elconv/target-v4:
 * G11:style-classes-binding + runV4Guards() wrapper.
 * Adapted from site-clone-to-v3/tests/unit/json-guard.test.ts to the
 * monorepo V4TreeNode shape (classes live in settings.classes $$type envelope).
 */

import { describe, it, expect } from 'vitest';
import { runV4Guards, V4_GUARDS, type V4TreeNode, type V4StyleClass } from '@elconv/target-v4';

function makeStyle(id: string): V4StyleClass {
  return {
    id,
    label: id,
    type: 'class',
    variants: [
      { meta: { breakpoint: null, state: null }, props: { color: { '$$type': 'color', value: '#111111' } }, custom_css: null },
    ],
  };
}

function makeV4Element(
  id: string,
  type: string,
  overrides: Partial<V4TreeNode> = {},
): V4TreeNode {
  return {
    id,
    type,
    elType: type === 'e-flexbox' || type === 'e-div-block' ? type : 'widget',
    widgetType: type,
    settings: {},
    styles: {},
    elements: [],
    ...overrides,
  };
}

const validV4Tree: V4TreeNode[] = [
  makeV4Element('e1', 'e-flexbox', {
    settings: { classes: { '$$type': 'classes', value: ['hero_section'] } },
    styles: { hero_section: makeStyle('hero_section') },
    elements: [
      makeV4Element('e2', 'e-heading', {
        settings: {
          classes: { '$$type': 'classes', value: ['hero_title'] },
          title: { '$$type': 'html-content', value: 'Hero Title' },
        },
        styles: { hero_title: makeStyle('hero_title') },
      }),
    ],
  }),
];

describe('runV4Guards', () => {
  it('passes a valid tree with score 100', () => {
    const report = runV4Guards(validV4Tree);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.threshold).toBe(85);
  });

  it('report contains one result per guard', () => {
    const report = runV4Guards(validV4Tree);
    expect(report.results).toHaveLength(V4_GUARDS.length);
  });

  it('handles empty tree without throwing', () => {
    expect(() => runV4Guards([])).not.toThrow();
  });
});

describe('G11: style-classes-binding', () => {
  it('passes when every class is bound to a style definition', () => {
    const g11 = runV4Guards(validV4Tree).results.find((r) => r.name === 'G11:style-classes-binding')!;
    expect(g11.result.passed).toBe(true);
  });

  it('fails when a class is referenced but not defined in styles{}', () => {
    const tree: V4TreeNode[] = [
      makeV4Element('e1', 'e-heading', {
        settings: { classes: { '$$type': 'classes', value: ['ghost_class'] } },
        styles: {},
      }),
    ];
    const g11 = runV4Guards(tree).results.find((r) => r.name === 'G11:style-classes-binding')!;
    expect(g11.result.passed).toBe(false);
    expect(g11.result.message).toContain('orphan class reference');
    expect(g11.result.details).toContain('ghost_class');
  });

  it('skips global class references (gc-* prefix)', () => {
    const tree: V4TreeNode[] = [
      makeV4Element('e1', 'e-heading', {
        settings: { classes: { '$$type': 'classes', value: ['gc-primary-button'] } },
        styles: {},
      }),
    ];
    const g11 = runV4Guards(tree).results.find((r) => r.name === 'G11:style-classes-binding')!;
    expect(g11.result.passed).toBe(true);
  });

  it('is severity: warning (−5 points)', () => {
    const tree: V4TreeNode[] = [
      makeV4Element('e1', 'e-heading', {
        settings: {
          classes: { '$$type': 'classes', value: ['ghost_class'] },
          title: { '$$type': 'html-content', value: 'Heading' },
        },
        styles: {},
      }),
    ];
    const report = runV4Guards(tree);
    const g11 = report.results.find((r) => r.name === 'G11:style-classes-binding')!;
    expect(g11.severity).toBe('warning');
    expect(report.score).toBe(95);
  });
});


