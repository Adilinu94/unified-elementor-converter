/**
 * Tests for the JSON-Guard additions (Phase 41, GAP-H) in @elconv/target-v3:
 * G4:breakpoint-coverage, G5:image-url-present, G7c:flex-row-child-width,
 * runV3Guards() wrapper + formatGuardReport().
 * Ported/adapted from site-clone-to-v3/tests/unit/json-guard.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { runV3Guards, V3_GUARDS, type V3Element } from '@elconv/target-v3';
import { runGuards, formatGuardReport } from '@elconv/core';

function makeV3Widget(id: string, widgetType: string, settings: Record<string, unknown> = {}): V3Element {
  return { id, elType: 'widget', widgetType, settings };
}

function makeV3Column(id: string, widgets: V3Element[] = [], settings?: Record<string, unknown>): V3Element {
  return { id, elType: 'column', settings: settings ?? {}, elements: widgets };
}

function makeV3Section(id: string, columns: V3Element[] = [], settings?: Record<string, unknown>): V3Element {
  return { id, elType: 'section', settings: settings ?? {}, elements: columns };
}

const validV3Tree: V3Element[] = [
  makeV3Section('s1', [
    makeV3Column('c1', [
      makeV3Widget('w1', 'heading', { title: 'Hello' }),
      makeV3Widget('w2', 'image', { image: { url: 'https://example.com/img.jpg' } }),
    ]),
  ]),
  makeV3Section('s2', [
    makeV3Column('c2', [
      makeV3Widget('w3', 'text-editor', { editor: '<p>Content</p>' }),
    ]),
  ]),
];

describe('runV3Guards — scoring engine', () => {
  it('score starts at 100 when all guards pass', () => {
    const report = runV3Guards(validV3Tree);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.threshold).toBe(85);
  });

  it('critical failure deducts 20 points', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('dup', [])]),
      makeV3Section('s2', [makeV3Column('dup', [])]),
    ];
    const report = runV3Guards(tree);
    const g1 = report.results.find((r) => r.name === 'G1:unique-ids')!;
    expect(g1.result.passed).toBe(false);
    expect(report.score).toBeLessThanOrEqual(80);
  });

  it('warning failure deducts 5 points', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [makeV3Widget('w1', 'image', { image: { url: '' } })]),
      ]),
    ];
    const report = runV3Guards(tree);
    const g5 = report.results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(false);
    expect(g5.severity).toBe('warning');
    expect(report.score).toBeLessThanOrEqual(95);
  });

  it('custom threshold works', () => {
    const report = runV3Guards(validV3Tree, 50);
    expect(report.threshold).toBe(50);
    expect(report.passed).toBe(true);
  });

  it('report contains one result per guard', () => {
    const report = runV3Guards(validV3Tree);
    expect(report.results).toHaveLength(V3_GUARDS.length);
  });

  it('handles empty tree without throwing', () => {
    expect(() => runV3Guards([])).not.toThrow();
    expect(runV3Guards([]).score).toBe(100);
  });
});

describe('G4: breakpoint-coverage', () => {
  it('passes when no breakpoint overrides exist', () => {
    const g4 = runV3Guards(validV3Tree).results.find((r) => r.name === 'G4:breakpoint-coverage')!;
    expect(g4.result.passed).toBe(true);
  });

  it('passes when both tablet and mobile overrides exist', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('c1', [])], {
        padding_tablet: '20px',
        padding_mobile: '10px',
      }),
    ];
    const g4 = runV3Guards(tree).results.find((r) => r.name === 'G4:breakpoint-coverage')!;
    expect(g4.result.passed).toBe(true);
  });

  it('fails when tablet override exists but mobile is missing', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('c1', [])], {
        padding_tablet: '20px',
      }),
    ];
    const g4 = runV3Guards(tree).results.find((r) => r.name === 'G4:breakpoint-coverage')!;
    expect(g4.result.passed).toBe(false);
    expect(g4.result.message).toContain('1 section');
  });
});

describe('G5: image-url-present', () => {
  it('passes when all image widgets have URLs', () => {
    const g5 = runV3Guards(validV3Tree).results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(true);
  });

  it('fails when image widget has empty URL', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [makeV3Widget('w1', 'image', { image: { url: '' } })]),
      ]),
    ];
    const g5 = runV3Guards(tree).results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(false);
  });

  it('fails when image widget has no image setting at all', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [makeV3Widget('w1', 'image', {})]),
      ]),
    ];
    const g5 = runV3Guards(tree).results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(false);
  });

  it('passes when no image widgets exist in tree', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [makeV3Widget('w1', 'heading', { title: 'Hi' })]),
      ]),
    ];
    const g5 = runV3Guards(tree).results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(true);
  });
});

describe('G7c: flex-row-child-width', () => {
  it('fails for flex-row container with unconstrained container children', () => {
    const tree: V3Element[] = [
      {
        id: 'row1',
        elType: 'container',
        settings: { flex_direction: 'row' },
        elements: [
          { id: 'a', elType: 'container', settings: {}, isInner: true },
          { id: 'b', elType: 'container', settings: {}, isInner: true },
        ],
      },
    ];
    const g7c = runV3Guards(tree).results.find((r) => r.name === 'G7c:flex-row-child-width')!;
    expect(g7c.result.passed).toBe(false);
    expect(g7c.result.message).toContain('risk stacking');
  });

  it('passes when flex-row children have _inline_size constraints', () => {
    const tree: V3Element[] = [
      {
        id: 'row1',
        elType: 'container',
        settings: { flex_direction: 'row' },
        elements: [
          { id: 'a', elType: 'container', settings: { _inline_size: 50 }, isInner: true },
          { id: 'b', elType: 'container', settings: { _inline_size: 50 }, isInner: true },
        ],
      },
    ];
    const g7c = runV3Guards(tree).results.find((r) => r.name === 'G7c:flex-row-child-width')!;
    expect(g7c.result.passed).toBe(true);
  });
});

describe('formatGuardReport', () => {
  it('includes score and PASSED/FAILED status', () => {
    const report = runV3Guards(validV3Tree);
    const text = formatGuardReport(report);
    expect(text).toContain('100/100');
    expect(text).toContain('PASSED');
  });

  it('shows FAILED when score is below threshold', () => {
    const tree: V3Element[] = [
      makeV3Section('same', []),
      makeV3Section('same', []),
    ];
    const text = formatGuardReport(runV3Guards(tree));
    expect(text).toContain('FAILED');
  });

  it('shows guard name in each line', () => {
    const text = formatGuardReport(runV3Guards(validV3Tree));
    expect(text).toContain('G1:unique-ids');
    expect(text).toContain('G5:image-url-present');
  });
});

describe('runGuards edge cases', () => {
  it('score never goes below 0 even with many failures', () => {
    const fails = Array.from({ length: 10 }, (_, i) => ({
      name: `fail-${i}`,
      severity: 'critical' as const,
      check: () => ({ passed: false, message: `fail ${i}` }),
    }));
    const report = runGuards<V3Element[]>([], fails, 85);
    expect(report.score).toBe(0);
    expect(report.passed).toBe(false);
  });
});
