/**
 * E2E Golden Path — V3 (Phase 74).
 *
 * Deterministic offline test: Build → Guards → Score → Assert.
 * No network required. Uses fixture trees + mock MCP.
 *
 * Scorecard Hard-Floors: E ≥ 70, critical probes = 0
 */

import { describe, it, expect } from 'vitest';
import { validateTree, applyAutoCompanions } from '../../packages/target-v3/src/setting-validator.js';
import { flattenTree, auditNesting } from '../../packages/target-v3/src/flatten-tree.js';
import { applySettingFirstPolicy, runWidgetFirstGuards } from '../../packages/target-v3/src/setting-first-policy.js';
import { computeEditabilityScore } from '../../packages/qa/src/editability-score.js';
import { runAllL1Rules } from '../../packages/qa/src/design-critic/rules.js';
import type { V3Element } from '../../packages/target-v3/src/types.js';

// ============================================================================
// Golden Path Fixture (V3)
// ============================================================================

const GOLDEN_V3_TREE: V3Element[] = [
  {
    id: 'sec_hero',
    elType: 'section',
    settings: {
      content_width: 'boxed',
      background_color: '#0a0a0a',
      padding: { top: 120, bottom: 120, unit: 'px', isLinked: false },
      _element_id: 'hero',
    },
    elements: [{
      id: 'col_hero',
      elType: 'column',
      settings: { _column_size: 100 },
      elements: [
        {
          id: 'w_hero_title',
          elType: 'widget',
          widgetType: 'heading',
          settings: {
            title: 'Welcome to OralCare',
            typography_typography: 'custom',
            typography_font_size: { size: 56, unit: 'px' },
            typography_font_weight: '700',
            title_color: '#ffffff',
            align: 'center',
          },
        },
        {
          id: 'w_hero_sub',
          elType: 'widget',
          widgetType: 'text-editor',
          settings: {
            editor: '<p>Professional dental care</p>',
            typography_typography: 'custom',
            typography_font_size: { size: 20, unit: 'px' },
            text_color: '#cccccc',
          },
        },
        {
          id: 'w_hero_btn',
          elType: 'widget',
          widgetType: 'button',
          settings: {
            text: 'Book Now',
            background_color: '#3b82f6',
            border_radius: { top: '8', right: '8', bottom: '8', left: '8', unit: 'px', isLinked: true },
          },
        },
      ],
    }],
  },
  {
    id: 'sec_stats',
    elType: 'section',
    settings: {
      content_width: 'boxed',
      background_color: '#1a1a2e',
      padding: { top: 80, bottom: 80, unit: 'px', isLinked: false },
      _element_id: 'stats',
    },
    elements: [{
      id: 'col_stats',
      elType: 'column',
      settings: { _column_size: 100 },
      elements: [
        {
          id: 'w_stat_1',
          elType: 'widget',
          widgetType: 'heading',
          settings: {
            title: '500+',
            typography_typography: 'custom',
            typography_font_size: { size: 48, unit: 'px' },
            title_color: '#ffffff',
            align: 'center',
          },
        },
        {
          id: 'w_stat_2',
          elType: 'widget',
          widgetType: 'heading',
          settings: {
            title: '98%',
            typography_typography: 'custom',
            typography_font_size: { size: 48, unit: 'px' },
            title_color: '#ffffff',
            align: 'center',
          },
        },
      ],
    }],
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('E2E V3 Golden Path', () => {
  it('setting-validator: score ≥ 85 on well-formed tree', () => {
    const report = validateTree(GOLDEN_V3_TREE);
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.criticalCount).toBe(0);
  });

  it('setting-validator: auto-companions applied correctly', () => {
    // Tree with missing typography_typography companion
    const badTree: V3Element[] = [{
      id: 'w1',
      elType: 'widget',
      widgetType: 'heading',
      settings: { typography_font_size: { size: 24, unit: 'px' } },
    }];
    const { tree, applied } = applyAutoCompanions(badTree);
    expect(applied.length).toBeGreaterThan(0);
    expect(tree[0]?.settings?.['typography_typography']).toBe('custom');
  });

  it('flatten-tree: reduces nesting to max depth 3', () => {
    const deepTree: V3Element[] = [{
      id: 's1', elType: 'section', settings: {},
      elements: [{
        id: 'c1', elType: 'container', settings: {},
        elements: [{
          id: 'c2', elType: 'container', settings: {},
          elements: [{
            id: 'c3', elType: 'container', settings: {},
            elements: [{
              id: 'c4', elType: 'container', settings: {},
              elements: [{ id: 'w1', elType: 'widget', widgetType: 'heading', settings: { title: 'Deep' } }],
            }],
          }],
        }],
      }],
    }];
    const result = flattenTree(deepTree);
    expect(result.flattenedMaxDepth).toBeLessThanOrEqual(3);
  });

  it('nesting-audit: passes on golden tree', () => {
    const audit = auditNesting(GOLDEN_V3_TREE);
    expect(audit.passed).toBe(true);
    expect(audit.maxDepth).toBeLessThanOrEqual(3);
  });

  it('widget-first guards: pass on golden tree', () => {
    const guards = runWidgetFirstGuards(GOLDEN_V3_TREE);
    expect(guards.every((g) => g.passed)).toBe(true);
  });

  it('setting-first policy: editability ≥ 70%', () => {
    const report = applySettingFirstPolicy(GOLDEN_V3_TREE, [], 42);
    expect(report.editabilityScore).toBeGreaterThanOrEqual(70);
  });

  it('editability-score: computes correctly', () => {
    const report = computeEditabilityScore({
      totalVisualAttributes: 100,
      settingDrivenAttributes: 80,
      cssDrivenAttributes: 15,
      inlineStyleAttributes: 5,
      htmlLayoutWidgets: 0,
      totalWidgets: 10,
    });
    expect(report.score).toBe(80);
    expect(report.passed).toBe(true);
    expect(report.grade).toBe('B');
  });

  it('design-critic L1: no critical findings on good styles', () => {
    const findings = runAllL1Rules([
      {
        selector: 'body',
        styles: { 'font-size': '16px', 'line-height': '24px', 'color': 'rgb(0, 0, 0)', 'background-color': 'rgb(255, 255, 255)' },
        boundingBox: { x: 0, y: 0, width: 1440, height: 900 },
      },
      {
        selector: '.elementor-section',
        styles: { 'padding-top': '80px', 'padding-bottom': '80px' },
        boundingBox: { x: 0, y: 0, width: 1440, height: 600 },
      },
    ]);
    const critical = findings.filter((f) => f.severity === 'critical');
    expect(critical).toHaveLength(0);
  });
});
