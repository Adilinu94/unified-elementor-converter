/**
 * E2E Golden Path — V4 (Phase 74).
 *
 * Deterministic offline test for V4 Atomic pipeline.
 * No network required. Uses fixture trees.
 *
 * Scorecard: validation score ≥ 85, no V3 containers, $$type present.
 */

import { describe, it, expect } from 'vitest';
import { validateV4Tree, bridgeUpgradeToV4, buildV4UnifiedQAReport } from '../../packages/target-v4/src/pipeline-hardening.js';
import type { V4TreeNode } from '../../packages/target-v4/src/types.js';

// ============================================================================
// Golden Path Fixture (V4 Atomic)
// ============================================================================

const GOLDEN_V4_TREE: V4TreeNode[] = [
  {
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: 'v4_hero',
    settings: {
      'flex-direction': { '$$type': 'text', value: 'column' },
      'align-items': { '$$type': 'text', value: 'center' },
      'padding': { '$$type': 'dimensions', value: { top: 120, right: 0, bottom: 120, left: 0, unit: 'px' } },
      'background-color': { '$$type': 'color', value: '#0a0a0a' },
    },
    styles: {
      style_hero: {
        id: 'style_hero',
        label: 'Hero Section',
        type: 'class',
        variants: [{ meta: { breakpoint: null, state: null }, props: {}, custom_css: null }],
      },
    },
    elements: [
      {
        type: 'e-heading',
        elType: 'e-heading',
        widgetType: 'e-heading',
        id: 'v4_hero_title',
        settings: {
          'text': 'Welcome to OralCare',
          'font-size': { '$$type': 'size', value: { size: 56, unit: 'px' } },
          'font-weight': { '$$type': 'text', value: '700' },
          'color': { '$$type': 'color', value: '#ffffff' },
        },
        styles: {
          style_hero_title: {
            id: 'style_hero_title',
            label: 'Hero Title',
            type: 'class',
            variants: [{ meta: { breakpoint: null, state: null }, props: {}, custom_css: null }],
          },
        },
      },
      {
        type: 'e-button',
        elType: 'e-button',
        widgetType: 'e-button',
        id: 'v4_hero_btn',
        settings: {
          'text': 'Book Now',
          'background-color': { '$$type': 'color', value: '#3b82f6' },
          'border-radius': { '$$type': 'border-radius', value: { top_left: 8, top_right: 8, bottom_right: 8, bottom_left: 8, unit: 'px' } },
        },
        styles: {
          style_hero_btn: {
            id: 'style_hero_btn',
            label: 'Hero Button',
            type: 'class',
            variants: [{ meta: { breakpoint: null, state: null }, props: {}, custom_css: null }],
          },
        },
      },
    ],
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('E2E V4 Golden Path', () => {
  it('validateV4Tree: score ≥ 85 on well-formed atomic tree', () => {
    const result = validateV4Tree(GOLDEN_V4_TREE);
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.passed).toBe(true);
  });

  it('validateV4Tree: no V3 containers detected', () => {
    const result = validateV4Tree(GOLDEN_V4_TREE);
    const v3Check = result.checks.find((c) => c.id === 'V4_NO_V3_CONTAINER');
    expect(v3Check?.passed).toBe(true);
  });

  it('validateV4Tree: $$type envelopes present', () => {
    const result = validateV4Tree(GOLDEN_V4_TREE);
    const typeCheck = result.checks.find((c) => c.id === 'V4_TYPE_ENVELOPES');
    expect(typeCheck?.passed).toBe(true);
  });

  it('validateV4Tree: valid atomic types only', () => {
    const result = validateV4Tree(GOLDEN_V4_TREE);
    const atomicCheck = result.checks.find((c) => c.id === 'V4_ATOMIC_TYPES');
    expect(atomicCheck?.passed).toBe(true);
  });

  it('validateV4Tree: fails on V3 container contamination', () => {
    const badTree: V4TreeNode[] = [{
      type: 'e-flexbox',
      elType: 'container', // V3 contamination!
      widgetType: 'e-flexbox',
      id: 'bad_1',
      settings: {},
      styles: {},
    }];
    const result = validateV4Tree(badTree);
    const v3Check = result.checks.find((c) => c.id === 'V4_NO_V3_CONTAINER');
    expect(v3Check?.passed).toBe(false);
  });

  it('bridgeUpgradeToV4: upgrades V3 JSON to V4 atomic', () => {
    const v3Json = [
      {
        id: 'sec1',
        elType: 'section',
        settings: { background_color: '#ffffff' },
        elements: [
          {
            id: 'w1',
            elType: 'widget',
            widgetType: 'heading',
            settings: { title: 'Hello', typography_font_size: { size: 32, unit: 'px' } },
          },
        ],
      },
    ];
    const result = bridgeUpgradeToV4(v3Json);
    expect(result.tree[0]?.type).toBe('e-flexbox');
    expect(result.tree[0]?.elements?.[0]?.type).toBe('e-heading');
    expect(result.upgradedCount).toBeGreaterThan(0);
  });

  it('bridgeUpgradeToV4: adds $$type envelopes to settings', () => {
    const v3Json = [{
      id: 'w1',
      elType: 'widget',
      widgetType: 'heading',
      settings: { title_color: '#ff0000' },
    }];
    const result = bridgeUpgradeToV4(v3Json);
    const settings = result.tree[0]?.settings;
    expect(settings?.['title_color']).toHaveProperty('$$type', 'color');
  });

  it('buildV4UnifiedQAReport: passes on golden tree', () => {
    const validation = validateV4Tree(GOLDEN_V4_TREE);
    const report = buildV4UnifiedQAReport('https://example.com', GOLDEN_V4_TREE, validation);
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(85);
  });

  it('buildV4UnifiedQAReport: structural probes all pass', () => {
    const validation = validateV4Tree(GOLDEN_V4_TREE);
    const report = buildV4UnifiedQAReport('https://example.com', GOLDEN_V4_TREE, validation);
    const criticalProbes = report.structuralProbes.filter((p) => p.severity === 'critical');
    expect(criticalProbes.every((p) => p.passed)).toBe(true);
  });
});
