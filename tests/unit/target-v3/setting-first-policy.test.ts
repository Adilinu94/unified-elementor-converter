import { describe, it, expect } from 'vitest';
import { applySettingFirstPolicy, runWidgetFirstGuards, type V3Element } from '@elconv/target-v3';

describe('applySettingFirstPolicy', () => {
  it('records a setting-driven decision for a recognized element setting', () => {
    const elements: V3Element[] = [{ id: 'e1', elType: 'widget', settings: { typography_font_size: '16px' } }];
    const report = applySettingFirstPolicy(elements, [], 1);
    expect(report.settingDriven).toBe(1);
    expect(report.decisions[0]).toMatchObject({ attribute: 'font-size', method: 'setting' });
  });

  it('ignores empty/undefined/null setting values', () => {
    const elements: V3Element[] = [{ id: 'e1', elType: 'widget', settings: { typography_font_size: '', margin: null, padding: undefined } }];
    const report = applySettingFirstPolicy(elements, [], 1);
    expect(report.settingDriven).toBe(0);
  });

  it('marks a CSS rule as UNJUSTIFIED when a reliable setting exists for that property', () => {
    const report = applySettingFirstPolicy([], [{ selector: '.a', property: 'font-size', value: '16px' }], 1);
    expect(report.cssBudget.unjustifiedRules).toBe(1);
    expect(report.cssBudget.justifiedRules).toBe(0);
    expect(report.decisions[0]!.justification).toContain('WARNING');
  });

  it('marks a CSS rule as JUSTIFIED when the mapped setting is known-unreliable (e.g. background-image)', () => {
    const report = applySettingFirstPolicy([], [{ selector: '.a', property: 'background-image', value: 'url(x)' }], 1);
    expect(report.cssBudget.justifiedRules).toBe(1);
    expect(report.cssBudget.entries[0]!.settingFailedBecause).not.toBeNull();
  });

  it('marks a CSS rule as JUSTIFIED when no Elementor setting exists at all for that property', () => {
    const report = applySettingFirstPolicy([], [{ selector: '.a', property: 'mix-blend-mode', value: 'multiply' }], 1);
    expect(report.cssBudget.justifiedRules).toBe(1);
    expect(report.cssBudget.entries[0]!.settingAttempted).toBe(false);
  });

  it('editabilityScore is 100 when there are zero decisions at all', () => {
    const report = applySettingFirstPolicy([], [], 1);
    expect(report.editabilityScore).toBe(100);
    expect(report.totalAttributes).toBe(0);
  });

  it('editabilityScore reflects the setting-vs-css ratio across both elements and CSS rules', () => {
    const elements: V3Element[] = [{ id: 'e1', elType: 'widget', settings: { title_color: '#fff' } }];
    const cssRules = [{ selector: '.a', property: 'font-size', value: '16px' }]; // unjustified -> css-fallback
    const report = applySettingFirstPolicy(elements, cssRules, 1);
    expect(report.settingDriven).toBe(1);
    expect(report.cssFallback).toBe(1);
    expect(report.editabilityScore).toBe(50);
  });

  it('recurses into nested child elements', () => {
    const elements: V3Element[] = [
      { id: 'parent', elType: 'container', settings: {}, elements: [
        { id: 'child', elType: 'widget', settings: { align: 'center' } },
      ] },
    ];
    const report = applySettingFirstPolicy(elements, [], 1);
    expect(report.settingDriven).toBe(1);
    expect(report.decisions[0]!.elementId).toBe('child');
  });

  it('editabilityImpact is 0 when every CSS rule is justified', () => {
    const report = applySettingFirstPolicy([], [{ selector: '.a', property: 'mix-blend-mode', value: 'x' }], 1);
    expect(report.cssBudget.editabilityImpact).toBe(0);
  });
});

describe('runWidgetFirstGuards', () => {
  function widget(id: string, widgetType: string, settings: Record<string, unknown> = {}): V3Element {
    return { id, elType: 'widget', widgetType, settings };
  }

  it('G_HTML_BUDGET passes when html widgets are within 15% of total', () => {
    const elements = [widget('a', 'heading'), widget('b', 'text-editor'), widget('c', 'html')];
    const [budget] = runWidgetFirstGuards(elements);
    expect(budget!.passed).toBe(false); // 1/3 = 33% > 15%
  });

  it('G_HTML_BUDGET passes for a tree with no html widgets at all', () => {
    const elements = [widget('a', 'heading'), widget('b', 'text-editor')];
    const [budget] = runWidgetFirstGuards(elements);
    expect(budget!.passed).toBe(true);
    expect(budget!.value).toBe(0);
  });

  it('G_HTML_BUDGET does not divide by zero for an empty tree', () => {
    const [budget] = runWidgetFirstGuards([]);
    expect(budget!.value).toBe(0);
    expect(budget!.passed).toBe(true);
  });

  it('G_HTML_HAS_IMG fails when an html widget contains an <img> tag', () => {
    const elements = [widget('a', 'html', { html: '<div><img src="x.png"></div>' })];
    const [, imgGuard] = runWidgetFirstGuards(elements);
    expect(imgGuard!.passed).toBe(false);
    expect(imgGuard!.value).toBe(1);
  });

  it('G_HTML_HAS_IMG passes when html widgets contain no <img> tags', () => {
    const elements = [widget('a', 'html', { html: '<div>text only</div>' })];
    const [, imgGuard] = runWidgetFirstGuards(elements);
    expect(imgGuard!.passed).toBe(true);
  });

  it('recurses into nested containers when counting widgets', () => {
    const elements: V3Element[] = [
      { id: 'p', elType: 'container', settings: {}, elements: [widget('a', 'html')] },
    ];
    const [budget] = runWidgetFirstGuards(elements);
    expect(budget!.value).toBe(1); // 1/1 html widget found through nesting
  });
});
