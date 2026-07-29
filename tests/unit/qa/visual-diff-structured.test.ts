import { describe, it, expect } from 'vitest';
import { computeStructuredDiff, buildDomSnapshotCall, type DomSnapshot, type DomSection } from '@elconv/qa';

function section(role: string, overrides: Partial<DomSection> = {}): DomSection {
  return {
    id: role, selector: `.${role}`, role,
    boundingBox: { x: 0, y: 0, width: 1000, height: 400 },
    computedStyles: {}, childCount: 1, textContent: '', hasImages: false, hasButtons: false,
    ...overrides,
  };
}
function snapshot(url: string, sections: DomSection[]): DomSnapshot {
  return { url, sections, globalStyles: {}, viewport: { width: 1440, height: 900 } };
}

describe('computeStructuredDiff', () => {
  it('reports zero issues and a 100 match score for identical snapshots', () => {
    const ref = snapshot('ref', [section('hero', { computedStyles: { color: 'red' } })]);
    const target = snapshot('target', [section('hero', { computedStyles: { color: 'red' } })]);
    const report = computeStructuredDiff(ref, target);
    expect(report.totalIssues).toBe(0);
    expect(report.sectionMatchScore).toBe(100);
  });

  it('flags a section present in reference but missing in target as critical', () => {
    const ref = snapshot('ref', [section('hero'), section('footer')]);
    const target = snapshot('target', [section('hero')]);
    const report = computeStructuredDiff(ref, target);
    expect(report.criticalCount).toBe(1);
    expect(report.issues[0]).toMatchObject({ section: 'footer', category: 'missing', severity: 'critical' });
    expect(report.sectionMatchScore).toBe(50);
  });

  it('flags an extra section in target (not in reference) as minor', () => {
    const ref = snapshot('ref', [section('hero')]);
    const target = snapshot('target', [section('hero'), section('newsletter')]);
    const report = computeStructuredDiff(ref, target);
    const extra = report.issues.find((i) => i.category === 'extra');
    expect(extra).toMatchObject({ section: 'newsletter', severity: 'minor' });
  });

  it('skips style comparison when either side is missing that property (no false positives)', () => {
    const ref = snapshot('ref', [section('hero', { computedStyles: { color: 'red' } })]);
    const target = snapshot('target', [section('hero', { computedStyles: {} })]);
    const report = computeStructuredDiff(ref, target);
    expect(report.issues.filter((i) => i.category !== 'missing')).toEqual([]);
  });

  it('categorizes and severity-tags a font-size mismatch as typography/major', () => {
    const ref = snapshot('ref', [section('hero', { computedStyles: { 'font-size': '40px' } })]);
    const target = snapshot('target', [section('hero', { computedStyles: { 'font-size': '16px' } })]);
    const issue = computeStructuredDiff(ref, target).issues.find((i) => i.description.includes('font-size'))!;
    expect(issue.category).toBe('typography');
    expect(issue.severity).toBe('major');
  });

  it('categorizes a padding mismatch as spacing/minor', () => {
    const ref = snapshot('ref', [section('hero', { computedStyles: { 'padding-top': '40px' } })]);
    const target = snapshot('target', [section('hero', { computedStyles: { 'padding-top': '10px' } })]);
    const issue = computeStructuredDiff(ref, target).issues[0]!;
    expect(issue.category).toBe('spacing');
    expect(issue.severity).toBe('minor');
  });

  it('flags a layout width mismatch, critical only when the difference exceeds 100px', () => {
    const ref = snapshot('ref', [section('hero', { boundingBox: { x: 0, y: 0, width: 1000, height: 400 } })]);

    const minor = computeStructuredDiff(ref, snapshot('t', [section('hero', { boundingBox: { x: 0, y: 0, width: 970, height: 400 } })])); // 30px diff
    expect(minor.issues.find((i) => i.category === 'layout')?.severity).toBe('major');

    const noIssue = computeStructuredDiff(ref, snapshot('t', [section('hero', { boundingBox: { x: 0, y: 0, width: 990, height: 400 } })])); // 10px, within 20px tolerance
    expect(noIssue.issues.filter((i) => i.category === 'layout')).toEqual([]);

    const critical = computeStructuredDiff(ref, snapshot('t', [section('hero', { boundingBox: { x: 0, y: 0, width: 850, height: 400 } })])); // 150px diff
    expect(critical.issues.find((i) => i.category === 'layout')?.severity).toBe('critical');
  });

  it('flags missing images/buttons that are present in the reference', () => {
    const ref = snapshot('ref', [section('hero', { hasImages: true, hasButtons: true })]);
    const target = snapshot('target', [section('hero', { hasImages: false, hasButtons: false })]);
    const report = computeStructuredDiff(ref, target);
    expect(report.issues.some((i) => i.description.includes('Images'))).toBe(true);
    expect(report.issues.some((i) => i.description.includes('Buttons'))).toBe(true);
  });

  it('sectionMatchScore is 100 when the reference has zero sections', () => {
    const report = computeStructuredDiff(snapshot('ref', []), snapshot('target', [section('hero')]));
    expect(report.sectionMatchScore).toBe(100);
  });
});

describe('buildDomSnapshotCall', () => {
  it('builds a novamira/execute-js call with the given URL and default viewport', () => {
    const call = buildDomSnapshotCall('https://x.com');
    expect(call.ability).toBe('novamira/execute-js');
    expect(call.params.url).toBe('https://x.com');
    expect(call.params.viewport).toEqual({ width: 1440, height: 900 });
  });

  it('accepts a custom viewport', () => {
    const call = buildDomSnapshotCall('https://x.com', { width: 375, height: 812 });
    expect(call.params.viewport).toEqual({ width: 375, height: 812 });
  });
});
