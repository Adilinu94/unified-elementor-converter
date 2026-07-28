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
import { runV4Guards, V4_GUARDS } from '../../packages/target-v4/src/guards.js';
import { runGuards } from '../../packages/core/src/guards.js';
import { autoScaleTree, applyAutoScaleToTree } from '../../packages/target-v4/src/auto-scale.js';
import { generateGlobalClasses, type TreeElement } from '../../packages/target-v4/src/global-classes.js';
import { selectTemplate, resetV4SectionTemplateIds } from '../../packages/target-v4/src/section-templates/index.js';
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

// ============================================================================
// Extended coverage: guards.ts, auto-scale.ts, global-classes.ts and
// section-templates working together on a realistically-built tree
// (pipeline-hardening.ts above only exercises its own module).
// ============================================================================

describe('E2E V4 Golden Path — Guards/Auto-Scale/Global-Classes', () => {
  resetV4SectionTemplateIds();
  const TEMPLATE_TREE: V4TreeNode[] = [
    ...selectTemplate('hero').generate({ heading: 'Welcome', subheading: 'A V4 golden path' }),
    ...selectTemplate('stats').generate({
      items: [
        { title: '100+', description: 'Projects' },
        { title: '50+', description: 'Clients' },
      ],
    }),
    ...selectTemplate('services').generate({
      items: [
        { title: 'Design', description: 'We design.' },
        { title: 'Build', description: 'We build.' },
        { title: 'Ship', description: 'We ship.' },
      ],
    }),
  ];

  it('has all 12 V4 guards registered', () => {
    expect(V4_GUARDS.length).toBeGreaterThanOrEqual(12);
  });

  it('runV4Guards: a section-templates-built tree scores >= 85', () => {
    const report = runV4Guards(TEMPLATE_TREE);
    expect(report.score).toBeGreaterThanOrEqual(85);
  });

  it('runGuards (shared core runner) agrees with runV4Guards', () => {
    const direct = runGuards(TEMPLATE_TREE, V4_GUARDS);
    expect(direct.score).toBe(runV4Guards(TEMPLATE_TREE).score);
  });

  it('every style ID in the template tree is hyphen-free (G7)', () => {
    const walk = (nodes: V4TreeNode[]): string[] =>
      nodes.flatMap((n) => [...Object.keys(n.styles), ...(n.elements ? walk(n.elements) : [])]);
    for (const id of walk(TEMPLATE_TREE)) expect(id).not.toMatch(/-/);
  });

  it('auto-scale: runs without throwing and applying the report preserves element count', () => {
    const report = autoScaleTree(TEMPLATE_TREE);
    expect(report.meta.totalElements).toBeGreaterThan(0);
    const scaled = applyAutoScaleToTree(TEMPLATE_TREE, report);
    const countIds = (nodes: V4TreeNode[]): number =>
      nodes.reduce((sum, n) => sum + 1 + (n.elements ? countIds(n.elements) : 0), 0);
    expect(countIds(scaled)).toBe(countIds(TEMPLATE_TREE));
  });

  it('global-classes: detects structurally-identical service cards as a duplicate group', () => {
    // section-templates gives each card its own style ID (no shared class
    // yet) — this is exactly the case generateGlobalClasses exists to
    // catch: identical prop signatures that should become one Global Class.
    const cardElements: TreeElement[] = [
      { id: 'card1', widget: 'e-flexbox', props: { display: 'flex', flex_direction: 'column', padding: '32px' } },
      { id: 'card2', widget: 'e-flexbox', props: { display: 'flex', flex_direction: 'column', padding: '32px' } },
      { id: 'card3', widget: 'e-flexbox', props: { display: 'flex', flex_direction: 'column', padding: '32px' } },
    ];
    const plan = generateGlobalClasses(cardElements);
    const dupGroup = plan.suggested_classes.find((c) => c.element_ids.length === 3);
    expect(dupGroup).toBeDefined();
    expect(dupGroup!.reason).toContain('identical structure');
  });
});
