import { describe, it, expect } from 'vitest';
import { computeEditabilityScore, analyzeHtmlEditability, type EditabilityInput } from '@elconv/qa';

describe('computeEditabilityScore', () => {
  const base: EditabilityInput = {
    totalVisualAttributes: 100,
    settingDrivenAttributes: 80,
    cssDrivenAttributes: 15,
    inlineStyleAttributes: 5,
    htmlLayoutWidgets: 0,
    totalWidgets: 10,
  };

  it('computes score as the setting-driven percentage of total', () => {
    const report = computeEditabilityScore(base);
    expect(report.score).toBe(80);
    expect(report.passed).toBe(true); // >= 70 threshold
  });

  it('fails when score is below the 70% threshold', () => {
    const report = computeEditabilityScore({ ...base, settingDrivenAttributes: 60 });
    expect(report.score).toBe(60);
    expect(report.passed).toBe(false);
  });

  it('does not divide by zero when totalVisualAttributes is 0', () => {
    const report = computeEditabilityScore({ ...base, totalVisualAttributes: 0, settingDrivenAttributes: 0 });
    expect(Number.isFinite(report.score)).toBe(true);
    expect(report.score).toBe(0);
  });

  it.each([
    [95, 'A'], [90, 'A'],
    [89, 'B'], [70, 'B'],
    [69, 'C'], [50, 'C'],
    [49, 'D'], [30, 'D'],
    [29, 'F'], [0, 'F'],
  ])('grades a score of %i as %s', (score, grade) => {
    const report = computeEditabilityScore({ ...base, totalVisualAttributes: 100, settingDrivenAttributes: score });
    expect(report.grade).toBe(grade);
  });

  it('recommends migrating CSS to settings when CSS-driven exceeds setting-driven', () => {
    const report = computeEditabilityScore({ ...base, settingDrivenAttributes: 20, cssDrivenAttributes: 50 });
    expect(report.recommendations.some((r) => r.includes('Migrate CSS'))).toBe(true);
  });

  it('recommends converting HTML layout widgets when present', () => {
    const report = computeEditabilityScore({ ...base, htmlLayoutWidgets: 3 });
    expect(report.recommendations.some((r) => r.includes('3 HTML widget'))).toBe(true);
  });

  it('flags high inline-style usage (>10% of total)', () => {
    const report = computeEditabilityScore({ ...base, totalVisualAttributes: 100, inlineStyleAttributes: 15 });
    expect(report.recommendations.some((r) => r.includes('inline-style'))).toBe(true);
  });

  it('does not flag inline styles at exactly the 10% boundary', () => {
    const report = computeEditabilityScore({ ...base, totalVisualAttributes: 100, inlineStyleAttributes: 10 });
    expect(report.recommendations.some((r) => r.includes('inline-style'))).toBe(false);
  });

  it('breakdown percentages are rounded and marked editable only for Elementor Settings', () => {
    const report = computeEditabilityScore(base);
    const settings = report.breakdown.find((b) => b.category === 'Elementor Settings')!;
    const css = report.breakdown.find((b) => b.category === 'External CSS (WPCode)')!;
    expect(settings.editable).toBe(true);
    expect(css.editable).toBe(false);
    expect(settings.percentage).toBe(80);
  });
});

describe('analyzeHtmlEditability', () => {
  it('counts inline style, data-settings, custom-class, and widget markers from HTML', () => {
    const html = `
      <div class="elementor-widget-heading" data-settings="{&quot;a&quot;:1}">
        <span style="color:red">Hi</span>
      </div>
      <div class="elementor-widget-html custom-fancy"></div>
    `;
    const input = analyzeHtmlEditability(html);
    expect(input.htmlLayoutWidgets).toBe(1);
    expect(input.totalWidgets).toBe(2);
    expect(input.settingDrivenAttributes).toBe(3); // 1 data-settings * 3
    expect(input.inlineStyleAttributes).toBe(1); // the span's style="..."
  });

  it('counts a double-quoted inline style attribute', () => {
    const html = `<div style="color:red"></div>`;
    expect(analyzeHtmlEditability(html).inlineStyleAttributes).toBe(1);
  });

  it('never returns totalVisualAttributes of 0, even for empty HTML', () => {
    const input = analyzeHtmlEditability('');
    expect(input.totalVisualAttributes).toBeGreaterThanOrEqual(1);
  });

  it('the output feeds directly into computeEditabilityScore without error', () => {
    const html = '<div class="elementor-widget-heading" data-settings="{}" style="color:red"></div>';
    const report = computeEditabilityScore(analyzeHtmlEditability(html));
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });
});
