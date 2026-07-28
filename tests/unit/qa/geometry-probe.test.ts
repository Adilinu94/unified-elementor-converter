import { describe, it, expect } from 'vitest';
import {
  isWithinTolerance,
  evaluateProbe,
  runGeometryProbes,
  evaluateStructuralProbes,
  buildComputedStyleCollectionCall,
  STRUCTURAL_PROBES,
} from '@elconv/qa';

describe('isWithinTolerance', () => {
  it('returns true for exact string matches', () => {
    expect(isWithinTolerance('color', 'red', 'red')).toBe(true);
  });

  it('applies px tolerance for a known property', () => {
    expect(isWithinTolerance('font-size', '16px', '17px')).toBe(true); // within 2px
    expect(isWithinTolerance('font-size', '16px', '20px')).toBe(false); // outside 2px
  });

  it('converts rem to px (16px base) before comparing', () => {
    expect(isWithinTolerance('font-size', '16px', '1rem')).toBe(true); // 1rem = 16px exactly
    expect(isWithinTolerance('font-size', '32px', '2rem')).toBe(true);
  });

  it('falls back to case-insensitive string comparison for properties with no tolerance table entry', () => {
    expect(isWithinTolerance('color', 'RED', 'red')).toBe(true);
    expect(isWithinTolerance('color', 'red', 'blue')).toBe(false);
  });

  it('falls back to string comparison when a toleranced property has an unparseable value', () => {
    expect(isWithinTolerance('width', 'auto', 'AUTO')).toBe(true);
    expect(isWithinTolerance('width', '16px', 'auto')).toBe(false);
  });
});

describe('evaluateProbe', () => {
  it('matches when all expected styles are within tolerance', () => {
    const result = evaluateProbe(
      { selector: '.btn', expectedStyles: { color: 'red' } },
      { color: 'red' },
    );
    expect(result.match).toBe(true);
    expect(result.diffs).toEqual([]);
    expect(result.suggestedCSSFix).toBeNull();
  });

  it('treats a missing computed style as NOT_FOUND and fails the match', () => {
    const result = evaluateProbe({ selector: '.btn', expectedStyles: { color: 'red' } }, {});
    expect(result.match).toBe(false);
    expect(result.actual.color).toBeUndefined();
    expect(result.diffs[0]!.actual).toBe('NOT_FOUND');
  });

  it('generates a suggested CSS fix listing only the failing properties', () => {
    const result = evaluateProbe(
      { selector: '.btn', expectedStyles: { color: 'red', 'font-size': '16px' } },
      { color: 'red', 'font-size': '40px' },
    );
    expect(result.suggestedCSSFix).toContain('.btn {');
    expect(result.suggestedCSSFix).toContain('font-size: 16px;');
    expect(result.suggestedCSSFix).not.toContain('color: red;'); // color matched, not in the fix
  });

  it('uses the selector as the label when none is given', () => {
    const result = evaluateProbe({ selector: '.btn', expectedStyles: {} }, {});
    expect(result.label).toBe('.btn');
  });
});

describe('runGeometryProbes', () => {
  it('computes a 0-100 score from the pass ratio', () => {
    const expectations = [
      { selector: '.a', expectedStyles: { color: 'red' } },
      { selector: '.b', expectedStyles: { color: 'blue' } },
    ];
    const styles = new Map([['.a', { color: 'red' }], ['.b', { color: 'green' }]]);
    const report = runGeometryProbes('https://x.com', expectations, styles);
    expect(report.passCount).toBe(1);
    expect(report.failCount).toBe(1);
    expect(report.score).toBe(50);
  });

  it('scores 100 for an empty expectations list (nothing to fail)', () => {
    const report = runGeometryProbes('https://x.com', [], new Map());
    expect(report.score).toBe(100);
    expect(report.totalProbes).toBe(0);
  });

  it('uses an empty style object for a selector missing from the computed-styles map', () => {
    const report = runGeometryProbes('https://x.com', [{ selector: '.missing', expectedStyles: { color: 'red' } }], new Map());
    expect(report.results[0]!.match).toBe(false);
  });
});

describe('evaluateStructuralProbes', () => {
  it('"exists" check passes when the DOM result reports exists:true', () => {
    const results = evaluateStructuralProbes([{ probeId: 'header-visible', exists: true, count: 1, styles: {} }]);
    const probe = results.find((r) => r.probeId === 'header-visible')!;
    expect(probe.passed).toBe(true);
  });

  it('"not-exists" check passes when the DOM result reports exists:false', () => {
    const results = evaluateStructuralProbes([{ probeId: 'image-widgets-present', exists: false, count: 0, styles: {} }]);
    const probe = results.find((r) => r.probeId === 'image-widgets-present')!;
    expect(probe.passed).toBe(true);
  });

  it('"style-match" passes only when every expected style key matches exactly', () => {
    const pass = evaluateStructuralProbes([{ probeId: 'no-horizontal-overflow', exists: true, count: 1, styles: { 'overflow-x': 'hidden' } }]);
    expect(pass.find((r) => r.probeId === 'no-horizontal-overflow')!.passed).toBe(true);

    const fail = evaluateStructuralProbes([{ probeId: 'no-horizontal-overflow', exists: true, count: 1, styles: { 'overflow-x': 'visible' } }]);
    expect(fail.find((r) => r.probeId === 'no-horizontal-overflow')!.passed).toBe(false);
  });

  it('"style-not-match" passes when styles differ from the (undesired) expected value', () => {
    const pass = evaluateStructuralProbes([{ probeId: 'button-not-full-width', exists: true, count: 1, styles: { width: 'auto' } }]);
    expect(pass.find((r) => r.probeId === 'button-not-full-width')!.passed).toBe(true);

    const fail = evaluateStructuralProbes([{ probeId: 'button-not-full-width', exists: true, count: 1, styles: { width: '100%' } }]);
    expect(fail.find((r) => r.probeId === 'button-not-full-width')!.passed).toBe(false);
  });

  it('"count-range" passes when count falls within [min, max] inclusive', () => {
    const withinRange = evaluateStructuralProbes([{ probeId: 'html-budget', exists: true, count: 5, styles: {} }]);
    expect(withinRange.find((r) => r.probeId === 'html-budget')!.passed).toBe(true);

    const overRange = evaluateStructuralProbes([{ probeId: 'html-budget', exists: true, count: 6, styles: {} }]);
    expect(overRange.find((r) => r.probeId === 'html-budget')!.passed).toBe(false);
  });

  it('a missing DOM result for a critical probe fails; for an info probe passes by default', () => {
    // no domResults at all -> every probe hits the "not executed" branch
    const results = evaluateStructuralProbes([]);
    const critical = results.find((r) => r.probeId === 'header-visible')!; // severity: critical
    const info = results.find((r) => r.probeId === 'stats-centered')!; // severity: info
    expect(critical.passed).toBe(false);
    expect(info.passed).toBe(true);
  });

  it('produces exactly one result per defined structural probe', () => {
    const results = evaluateStructuralProbes([]);
    expect(results).toHaveLength(STRUCTURAL_PROBES.length);
  });
});

describe('buildComputedStyleCollectionCall', () => {
  it('builds a novamira/execute-js MCP call embedding the selector list', () => {
    const call = buildComputedStyleCollectionCall('https://x.com', ['.a', '.b']);
    expect(call.ability).toBe('novamira/execute-js');
    expect(call.params.url).toBe('https://x.com');
    expect(call.params.code as string).toContain('".a"');
    expect(call.params.code as string).toContain('".b"');
  });
});
