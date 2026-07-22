import { describe, it, expect, beforeEach } from 'vitest';
import {
  VIEWPORTS,
  calculateDiffScore,
  classifySeverity,
  mapToSemanticRegion,
  generateDiffMessage,
  aggregateRegions,
  createMockDiffResult,
  compareDiffResults,
  resetFixIds,
  FIX_CONFIGS,
  calculateFixPriority,
  createFixAction,
  createPriorityQueue,
  getNextBatch,
  markFixApplied,
  markFixVerified,
  isQueueComplete,
  getRemainingCount,
  inferFixType,
  resetProbeIds,
  probeSharedIds,
  probeElementCount,
  probeNestingDepth,
  probeWidgetTypes,
  runStructuralProbes,
  createViewportRegion,
  detectResponsiveIssues,
  aggregateViewportMatrix,
  createMockViewportMatrix,
  getViewportRecommendations,
  RESPONSIVE_THRESHOLDS,
  type DiffRegion,
  type ElementNode,
} from '@elconv/qa';

function makeRegion(overrides: Partial<DiffRegion> = {}): DiffRegion {
  return {
    id: 'r1',
    semanticRole: 'hero',
    x: 0,
    y: 100,
    width: 1440,
    height: 400,
    diffPixels: 5000,
    diffPercent: 8.7,
    severity: 'warning',
    ...overrides,
  };
}

describe('QA Types', () => {
  it('defines 3 viewports', () => {
    expect(VIEWPORTS).toHaveLength(3);
    expect(VIEWPORTS.map((v) => v.label)).toEqual(['desktop', 'tablet', 'mobile']);
  });

  it('viewport widths are 1440/768/390', () => {
    expect(VIEWPORTS[0].width).toBe(1440);
    expect(VIEWPORTS[1].width).toBe(768);
    expect(VIEWPORTS[2].width).toBe(390);
  });
});

describe('Visual Diff', () => {
  it('calculates diff score: 0% diff = 100', () => {
    expect(calculateDiffScore(0)).toBe(100);
  });

  it('calculates diff score: 5% diff = 90', () => {
    expect(calculateDiffScore(5)).toBe(90);
  });

  it('calculates diff score: 50% diff = 0 (floor)', () => {
    expect(calculateDiffScore(50)).toBe(0);
  });

  it('classifies critical severity for hero >5%', () => {
    expect(classifySeverity(6, 'hero')).toBe('critical');
  });

  it('classifies warning for content >3%', () => {
    expect(classifySeverity(4, 'content')).toBe('warning');
  });

  it('classifies info for small diff', () => {
    expect(classifySeverity(1, 'footer')).toBe('info');
  });

  it('maps coordinates to header region', () => {
    expect(mapToSemanticRegion(720, 45, 1440, 900)).toBe('header');
  });

  it('maps coordinates to hero region', () => {
    expect(mapToSemanticRegion(720, 300, 1440, 900)).toBe('hero');
  });

  it('maps coordinates to footer region', () => {
    expect(mapToSemanticRegion(720, 850, 1440, 900)).toBe('footer');
  });

  it('generates human-readable diff message', () => {
    const msg = generateDiffMessage(makeRegion({ diffPercent: 12, severity: 'critical' }));
    expect(msg).toContain('Hero');
    expect(msg).toContain('12.0%');
    expect(msg).toContain('🔴');
  });

  it('aggregates regions correctly', () => {
    const regions = [
      makeRegion({ id: 'r1', diffPixels: 100, severity: 'critical', diffPercent: 12 }),
      makeRegion({ id: 'r2', diffPixels: 50, severity: 'warning', diffPercent: 5 }),
    ];
    const agg = aggregateRegions(regions);
    expect(agg.totalDiffPixels).toBe(150);
    expect(agg.criticalCount).toBe(1);
    expect(agg.warningCount).toBe(1);
    expect(agg.worstRegion?.id).toBe('r1');
  });

  it('creates mock diff result', () => {
    const result = createMockDiffResult(VIEWPORTS[0], 3.5);
    expect(result.viewport.label).toBe('desktop');
    expect(result.diffPercent).toBe(3.5);
    expect(result.score).toBe(93);
  });

  it('compares diff results', () => {
    const before = createMockDiffResult(VIEWPORTS[0], 10);
    const after = createMockDiffResult(VIEWPORTS[0], 5);
    const cmp = compareDiffResults(before, after);
    expect(cmp.improved).toBe(true);
    expect(cmp.scoreDelta).toBeGreaterThan(0);
  });
});

describe('Auto-Fix & Priority Queue', () => {
  beforeEach(() => resetFixIds());

  it('has fix configs for all 6 types', () => {
    expect(Object.keys(FIX_CONFIGS)).toHaveLength(6);
  });

  it('calculates priority with severity and area', () => {
    const region = makeRegion({ severity: 'critical', width: 1440, height: 400 });
    const priority = calculateFixPriority('layout-shift', region);
    expect(priority).toBeGreaterThan(20);
  });

  it('creates fix action with correct fields', () => {
    const region = makeRegion();
    const fix = createFixAction('color-mismatch', region, '#fff', '#000');
    expect(fix.id).toBe('fix_1');
    expect(fix.type).toBe('color-mismatch');
    expect(fix.cssProperty).toBe('_color');
    expect(fix.oldValue).toBe('#fff');
    expect(fix.newValue).toBe('#000');
    expect(fix.applied).toBe(false);
  });

  it('creates priority queue sorted descending', () => {
    const region = makeRegion();
    const fixes = [
      createFixAction('font-mismatch', region),
      createFixAction('missing-element', region),
      createFixAction('color-mismatch', region),
    ];
    const queue = createPriorityQueue(fixes);
    expect(queue.fixes[0].type).toBe('missing-element');
    expect(queue.maxPerRound).toBe(3);
  });

  it('gets next batch limited to maxPerRound', () => {
    const region = makeRegion();
    const fixes = Array.from({ length: 5 }, () => createFixAction('spacing-mismatch', region));
    const queue = createPriorityQueue(fixes, 3);
    const batch = getNextBatch(queue);
    expect(batch).toHaveLength(3);
  });

  it('marks fix applied and verified', () => {
    const region = makeRegion();
    const fix = createFixAction('size-mismatch', region);
    const queue = createPriorityQueue([fix]);
    markFixApplied(queue, fix.id);
    expect(queue.fixes[0].applied).toBe(true);
    markFixVerified(queue, fix.id);
    expect(queue.fixes[0].verified).toBe(true);
    expect(isQueueComplete(queue)).toBe(true);
  });

  it('tracks remaining count', () => {
    const region = makeRegion();
    const fixes = [createFixAction('color-mismatch', region), createFixAction('layout-shift', region)];
    const queue = createPriorityQueue(fixes);
    expect(getRemainingCount(queue)).toBe(2);
    markFixApplied(queue, fixes[0].id);
    markFixVerified(queue, fixes[0].id);
    expect(getRemainingCount(queue)).toBe(1);
  });

  it('infers fix type from diff details', () => {
    const region = makeRegion();
    expect(inferFixType(region, { colorDiff: true })).toBe('color-mismatch');
    expect(inferFixType(region, { sizeDiff: true })).toBe('size-mismatch');
    expect(inferFixType(region, { positionDiff: true })).toBe('layout-shift');
    expect(inferFixType(makeRegion({ semanticRole: 'hero' }))).toBe('layout-shift');
    expect(inferFixType(makeRegion({ semanticRole: 'content' }))).toBe('spacing-mismatch');
  });
});

describe('Structural Probes', () => {
  beforeEach(() => resetProbeIds());

  const tree: ElementNode[] = [
    { id: 'a', type: 'container', children: [{ id: 'b', type: 'heading' }] },
    { id: 'c', type: 'button' },
  ];

  it('passes shared-id probe for unique IDs', () => {
    const probe = probeSharedIds(tree);
    expect(probe.passed).toBe(true);
    expect(probe.type).toBe('shared-id');
  });

  it('fails shared-id probe for duplicates', () => {
    const dupes: ElementNode[] = [
      { id: 'x', type: 'container' },
      { id: 'x', type: 'heading' },
    ];
    const probe = probeSharedIds(dupes);
    expect(probe.passed).toBe(false);
    expect(probe.message).toContain('x');
  });

  it('passes element-count probe', () => {
    const probe = probeElementCount(tree, 3);
    expect(probe.passed).toBe(true);
  });

  it('fails element-count probe', () => {
    const probe = probeElementCount(tree, 5);
    expect(probe.passed).toBe(false);
    expect(probe.actual).toBe(3);
  });

  it('passes nesting-depth probe', () => {
    const probe = probeNestingDepth(tree, 3);
    expect(probe.passed).toBe(true);
  });

  it('fails nesting-depth probe', () => {
    const deep: ElementNode[] = [
      { type: 'a', children: [{ type: 'b', children: [{ type: 'c', children: [{ type: 'd' }] }] }] },
    ];
    const probe = probeNestingDepth(deep, 2);
    expect(probe.passed).toBe(false);
  });

  it('passes widget-type probe', () => {
    const probe = probeWidgetTypes(tree, ['container', 'heading', 'button']);
    expect(probe.passed).toBe(true);
  });

  it('fails widget-type probe for invalid types', () => {
    const probe = probeWidgetTypes(tree, ['container', 'heading']);
    expect(probe.passed).toBe(false);
    expect(probe.message).toContain('button');
  });

  it('runs all probes with options', () => {
    const probes = runStructuralProbes(tree, {
      expectedCount: 3,
      maxDepth: 5,
      allowedTypes: ['container', 'heading', 'button'],
    });
    expect(probes).toHaveLength(4);
    expect(probes.every((p) => p.passed)).toBe(true);
  });
});

describe('Viewport Matrix', () => {
  it('creates viewport region with severity', () => {
    const region = createViewportRegion('r1', 'hero', 0, 0, 1440, 400, 12);
    expect(region.severity).toBe('critical');
    expect(region.diffPixels).toBeGreaterThan(0);
  });

  it('detects responsive issues above threshold', () => {
    const results = [
      createMockDiffResult(VIEWPORTS[0], 2, [makeRegion({ diffPercent: 2 })]),
      createMockDiffResult(VIEWPORTS[2], 15, [makeRegion({ diffPercent: 15 })]),
    ];
    const issues = detectResponsiveIssues(results);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('aggregates viewport matrix', () => {
    const results = VIEWPORTS.map((vp) => createMockDiffResult(vp, 3));
    const matrix = aggregateViewportMatrix(results);
    expect(matrix.viewports).toHaveLength(3);
    expect(matrix.overallScore).toBe(94);
    expect(matrix.passed).toBe(true);
  });

  it('creates mock viewport matrix', () => {
    const matrix = createMockViewportMatrix({ desktop: 2, tablet: 4, mobile: 8 });
    expect(matrix.viewports).toHaveLength(3);
    expect(matrix.worstViewport).toBe('mobile');
  });

  it('fails when viewport below threshold', () => {
    const matrix = createMockViewportMatrix({ desktop: 2, tablet: 4, mobile: 25 });
    expect(matrix.passed).toBe(false);
  });

  it('generates recommendations for issues', () => {
    const matrix = createMockViewportMatrix(
      { desktop: 1, tablet: 2, mobile: 20 },
      [makeRegion({ diffPercent: 20, severity: 'critical' })],
    );
    const recs = getViewportRecommendations(matrix);
    expect(recs.length).toBeGreaterThan(0);
  });

  it('has responsive thresholds defined', () => {
    expect(RESPONSIVE_THRESHOLDS.maxDiffPercent.desktop).toBe(5);
    expect(RESPONSIVE_THRESHOLDS.minScore.mobile).toBe(80);
  });
});
