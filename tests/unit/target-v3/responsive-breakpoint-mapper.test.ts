/**
 * Tests for applyResponsiveOverrides (target-v3/responsive-breakpoint-mapper).
 *
 * P5 (BAUPLAN-v6.0 §11.1) changed the emitted key form from the Elementor-
 * invalid prefix (`tablet_padding`) to the required suffix (`padding_tablet`).
 * These tests lock in the suffix and the rejection path for keys that already
 * carry a breakpoint marker.
 */

import { describe, it, expect } from 'vitest';
import { applyResponsiveOverrides, runV3Guards } from '@elconv/target-v3';

interface Tree {
  id: string;
  elType: string;
  settings?: Record<string, unknown>;
  elements?: Tree[];
}

function makeTree(): Tree[] {
  return [
    {
      id: 'sec1',
      elType: 'section',
      settings: { css_classes: 'hero' },
      elements: [
        {
          id: 'col1',
          elType: 'column',
          settings: {},
          elements: [{ id: 'w1', elType: 'widget', settings: {} }],
        },
      ],
    },
  ];
}

describe('applyResponsiveOverrides', () => {
  it('writes the Elementor suffix form, never the prefix form', () => {
    const tree = makeTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = applyResponsiveOverrides(tree as any, {
      tablet: [{ selector: 'hero', overrides: { padding: '20px' } }],
      mobile: [{ selector: 'hero', overrides: { padding: '10px', flex_direction: 'column' } }],
    });

    const settings = tree[0]!.settings!;
    expect(settings.padding_tablet).toBe('20px');
    expect(settings.padding_mobile).toBe('10px');
    expect(settings.flex_direction_mobile).toBe('column');
    expect(settings.tablet_padding).toBeUndefined();
    expect(settings.mobile_padding).toBeUndefined();
    expect(report.applied).toBe(2);
    expect(report.byBreakpoint).toEqual({ tablet: 1, mobile: 1 });
    expect(report.rejectedKeys).toEqual([]);
  });

  it('matches by element id as well as css class', () => {
    const tree = makeTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyResponsiveOverrides(tree as any, {
      mobile: [{ selector: 'w1', overrides: { typography_font_size: 14 } }],
    });
    expect(tree[0]!.elements![0]!.elements![0]!.settings!.typography_font_size_mobile).toBe(14);
  });

  it('counts unmatched selectors as skipped instead of throwing', () => {
    const tree = makeTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = applyResponsiveOverrides(tree as any, {
      mobile: [{ selector: 'does-not-exist', overrides: { padding: '1px' } }],
    });
    expect(report.applied).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it('rejects an override key that already carries a breakpoint suffix', () => {
    const tree = makeTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = applyResponsiveOverrides(tree as any, {
      mobile: [{ selector: 'hero', overrides: { padding_tablet: '8px' } }],
    });
    expect(report.rejectedKeys).toEqual(['padding_tablet']);
    expect(Object.keys(tree[0]!.settings!)).not.toContain('padding_tablet_mobile');
  });

  it('rejects an override key that uses the invalid prefix form', () => {
    const tree = makeTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = applyResponsiveOverrides(tree as any, {
      mobile: [{ selector: 'hero', overrides: { tablet_padding: '8px' } }],
    });
    expect(report.rejectedKeys).toEqual(['tablet_padding']);
    expect(Object.keys(tree[0]!.settings!)).not.toContain('tablet_padding_mobile');
  });

  it('produces output that passes the G4b prefix guard', () => {
    const tree = makeTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyResponsiveOverrides(tree as any, {
      tablet: [{ selector: 'hero', overrides: { padding: '20px' } }],
      mobile: [{ selector: 'hero', overrides: { padding: '10px' } }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = runV3Guards(tree as any);
    const g4b = report.results.find((r) => r.name === 'G4b:breakpoint-prefix-misuse')!;
    const g4 = report.results.find((r) => r.name === 'G4:breakpoint-coverage')!;
    expect(g4b.result.passed).toBe(true);
    expect(g4.result.passed).toBe(true);
  });
});
