/**
 * Tests for the ClinicHub-lessons report API in packages/target-v3/src/normalize.ts
 * (merged from the former v3-container-normalize.ts):
 * nested isInner + flex-row child width constraints.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { V3Element } from '@elconv/target-v3';
import {
  normalizeV3ContainerTreeWithReport,
  findNestedContainersMissingIsInnerAncestorAware,
  findFlexRowStackRiskParents,
} from '@elconv/target-v3';
import { runV3Guards } from '@elconv/target-v3';
import { validateSettingsAgainstSchema, type WidgetSchemaMap } from '@elconv/core';

/**
 * The committed control snapshot. It is what makes "a container declares no
 * `_element_width`" a verifiable fact rather than an assertion: the file records
 * the controls Elementor 4.2.1 exposes per widget.
 */
const SNAPSHOT = JSON.parse(
  readFileSync(resolve(__dirname, '../../../schemas/elementor-v3-controls.snapshot.json'), 'utf8'),
) as { widgets: WidgetSchemaMap };

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

  it('constrains flex-row container children with the container\'s own width control', () => {
    // A container declares `width` (slider, gated on `content_width: 'full'`). It
    // declares NO `_element_width` / `_element_custom_width` — that pair is a
    // widget control, and writing it here was 92 schema-gate errors on a real page.
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
      expect(child.settings).not.toHaveProperty('_element_width');
      expect(child.settings).not.toHaveProperty('_element_custom_width');
      expect(child.settings?.['content_width']).toBe('full');
      expect(child.settings?.['width']).toEqual({ unit: '%', size: 33, sizes: [] });
    }
  });

  it('produces a tree the schema gate accepts', () => {
    // The end-to-end claim behind the change: every key this function writes
    // exists on the element it lands on, in the shape that control declares.
    const tree: V3Element[] = [
      container('row', { flex_direction: 'row' }, [
        container('a', {}, [widget('w1')]),
        container('b', {}, [widget('w2')]),
      ]),
    ];
    const { tree: fixed } = normalizeV3ContainerTreeWithReport(tree);
    const report = validateSettingsAgainstSchema(fixed as never, SNAPSHOT.widgets);
    expect(report.errorCount).toBe(0);
  });

  it('does not override children that already have a width', () => {
    const tree: V3Element[] = [
      container(
        'row',
        { flex_direction: 'row' },
        [
          container('a', { content_width: 'full', width: { unit: '%', size: 40, sizes: [] } }, [widget('w1')], true),
          container('b', { content_width: 'full', width: { unit: '%', size: 60, sizes: [] } }, [widget('w2')], true),
        ],
        false,
      ),
    ];

    const report = normalizeV3ContainerTreeWithReport(tree);
    expect(report.flexRowWidthFixed).toBe(0);
    const a = report.tree[0]?.elements?.[0]?.settings?.['width'] as { size: number };
    expect(a.size).toBe(40);
  });

  it('does not overwrite a source-measured max-width', () => {
    // `boxed_width` comes from a measured `max-width`: the source already said how
    // wide this box may be. Overwriting it would also flip `content_width` to
    // 'full', which makes `boxed_width` unsatisfiable — Elementor stores it and
    // never renders it.
    const tree: V3Element[] = [
      container('row', { flex_direction: 'row' }, [
        container('sized', { boxed_width: { unit: 'px', size: 320, sizes: [] } }, [widget('w1')]),
        container('plain-a', {}, [widget('w2')]),
        container('plain-b', {}, [widget('w3')]),
      ]),
    ];

    const report = normalizeV3ContainerTreeWithReport(tree);
    const sized = report.tree[0]?.elements?.[0];
    expect(sized?.settings).not.toHaveProperty('width');
    expect(sized?.settings?.['content_width']).toBeUndefined();
    // Counted separately, so a skip is visible rather than silent.
    expect(report.flexRowWidthSkipped).toBe(1);
    expect(report.flexRowWidthFixed).toBe(2);
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
  it('findNestedContainersMissingIsInnerAncestorAware detects bad nests', () => {
    const tree: V3Element[] = [
      container('root', {}, [container('child', {}, [widget('w1')], false)], false),
    ];
    expect(findNestedContainersMissingIsInnerAncestorAware(tree)).toContain('child');
  });

  it('findNestedContainersMissingIsInnerAncestorAware is a no-op for a container nested only under classic section>column', () => {
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
            elements: [container('con1', {}, [widget('w1')], false)],
          },
        ],
      },
    ];
    // 'con1' has no container ancestor (its parents are section/column), so it's
    // not "nested inside a container" and must not be flagged.
    expect(findNestedContainersMissingIsInnerAncestorAware(tree)).toEqual([]);
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

  it('findFlexRowStackRiskParents ignores an out-of-flow child', () => {
    // An absolutely-positioned child never joins the flex layout, so the one
    // remaining in-flow child has nothing to stack with — the measured shape of
    // ir_MR1faeDEt, whose second child carries the source's `position: absolute`.
    const tree: V3Element[] = [
      container(
        'row',
        { flex_direction: 'row' },
        [
          container('a', { content_width: 'full' }, [widget('w1')]),
          container('b', { position: 'absolute' }, [widget('w2')]),
        ],
      ),
    ];
    expect(findFlexRowStackRiskParents(tree)).toEqual([]);
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
