/**
 * Tests for src/builder/v3-container-normalize.ts
 * ClinicHub lessons: nested isInner + flex-row child width constraints.
 */

import { describe, it, expect } from 'vitest';
import type { V3Element } from '@elconv/target-v3';
import {
  normalizeV3ContainerTreeWithReport,
  findNestedContainersMissingIsInner,
  findFlexRowStackRiskParents,
} from '@elconv/target-v3';
import { runV3Guards } from '@elconv/target-v3';

function container(
  id: string,
  settings: Record<string, unknown> = {},
  elements: V3Element[] = [],
  isInner?: boolean,
): V3Element {
  return {
    id,
    elType: 'container',
    settings,
    elements,
    ...(isInner !== undefined ? { isInner } : {}),
  };
}

function widget(id: string): V3Element {
  return { id, elType: 'widget', widgetType: 'heading', settings: { title: 'x' } };
}

describe('normalizeV3ContainerTreeWithReport', () => {
  it('sets isInner:true on nested containers', () => {
    const tree: V3Element[] = [
      container('root', { flex_direction: 'column' }, [
        container('child', { content_width: 'full' }, [widget('w1')]),
      ]),
    ];

    const report = normalizeV3ContainerTreeWithReport(tree);
    expect(report.nestedIsInnerFixed).toBeGreaterThanOrEqual(1);
    const child = report.tree[0]?.elements?.[0];
    expect(child?.isInner).toBe(true);
    expect(report.tree[0]?.isInner).toBe(false);
  });

  it('constrains unconstrained flex-row container children with companion width', () => {
    const tree: V3Element[] = [
      container(
        'row',
        { flex_direction: 'row', content_width: 'full' },
        [
          container('a', { content_width: 'full' }, [widget('w1')]),
          container('b', { content_width: 'full' }, [widget('w2')]),
          container('c', { content_width: 'full' }, [widget('w3')]),
        ],
        false,
      ),
    ];

    const report = normalizeV3ContainerTreeWithReport(tree);
    expect(report.flexRowWidthFixed).toBe(3);
    for (const child of report.tree[0]?.elements ?? []) {
      expect(child.isInner).toBe(true);
      expect(child.settings?.['_element_width']).toBe('initial');
      const cw = child.settings?.['_element_custom_width'] as { size: number; unit: string };
      expect(cw.unit).toBe('%');
      expect(cw.size).toBe(33);
    }
  });

  it('does not override children that already have custom width', () => {
    const tree: V3Element[] = [
      container(
        'row',
        { flex_direction: 'row' },
        [
          container(
            'a',
            {
              content_width: 'full',
              _element_width: 'initial',
              _element_custom_width: { unit: '%', size: 40, sizes: [] },
            },
            [widget('w1')],
            true,
          ),
          container(
            'b',
            {
              content_width: 'full',
              _element_width: 'initial',
              _element_custom_width: { unit: '%', size: 60, sizes: [] },
            },
            [widget('w2')],
            true,
          ),
        ],
        false,
      ),
    ];

    const report = normalizeV3ContainerTreeWithReport(tree);
    expect(report.flexRowWidthFixed).toBe(0);
    const a = report.tree[0]?.elements?.[0]?.settings?.['_element_custom_width'] as { size: number };
    expect(a.size).toBe(40);
  });

  it('is a no-op for classic section>column trees', () => {
    const tree: V3Element[] = [
      {
        id: 's1',
        elType: 'section',
        settings: {},
        elements: [
          {
            id: 'col1',
            elType: 'column',
            settings: {},
            elements: [widget('w1')],
          },
        ],
      },
    ];
    const report = normalizeV3ContainerTreeWithReport(tree);
    expect(report.nestedIsInnerFixed).toBe(0);
    expect(report.flexRowWidthFixed).toBe(0);
    expect(report.tree[0]?.elType).toBe('section');
  });
});

describe('static risk finders + guards', () => {
  it('findNestedContainersMissingIsInner detects bad nests', () => {
    const tree: V3Element[] = [
      container('root', {}, [container('child', {}, [widget('w1')], false)], false),
    ];
    expect(findNestedContainersMissingIsInner(tree)).toContain('child');
  });

  it('findFlexRowStackRiskParents detects unconstrained row children', () => {
    const tree: V3Element[] = [
      container(
        'row',
        { flex_direction: 'row' },
        [
          container('a', { content_width: 'full' }, [widget('w1')]),
          container('b', { content_width: 'full' }, [widget('w2')]),
        ],
      ),
    ];
    expect(findFlexRowStackRiskParents(tree)).toContain('row');
  });

  it('G6c/G7c guards fail before normalize and pass after', () => {
    const tree: V3Element[] = [
      container(
        'row',
        { flex_direction: 'row' },
        [
          container('a', { content_width: 'full' }, [widget('w1')], false),
          container('b', { content_width: 'full' }, [widget('w2')], false),
        ],
        false,
      ),
    ];

    const before = runV3Guards(tree, 0);
    const g6 = before.results.find((r) => r.name === 'G6c:nested-container-is-inner');
    const g7 = before.results.find((r) => r.name === 'G7c:flex-row-child-width');
    expect(g6?.result.passed).toBe(false);
    expect(g7?.result.passed).toBe(false);

    const { tree: fixed } = normalizeV3ContainerTreeWithReport(tree);
    const after = runV3Guards(fixed, 0);
    const g6b = after.results.find((r) => r.name === 'G6c:nested-container-is-inner');
    const g7b = after.results.find((r) => r.name === 'G7c:flex-row-child-width');
    expect(g6b?.result.passed).toBe(true);
    expect(g7b?.result.passed).toBe(true);
  });
});
