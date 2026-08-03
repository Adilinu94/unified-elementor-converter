import { describe, expect, it } from 'vitest';
import {
  canContinueWithFidelityDecisions,
  validateFidelityDecisions,
  validateSiteDeploymentManifest,
  validateVisualPageIR,
  type FidelityDecisionRecord,
  type SiteDeploymentManifest,
  type VisualPageIR,
} from '../../../packages/core/src/index.ts';

function validIr(): VisualPageIR {
  return {
    schemaVersion: '1.0',
    source: {
      route: '/',
      extractionMode: 'hybrid',
      capturedAt: new Date(0).toISOString(),
      pageId: 'home',
    },
    viewportProfiles: [{ label: 'desktop', width: 1440, height: 900 }],
    tokens: { colors: {}, fonts: [], textStyles: {}, spacing: {} },
    sections: [{
      sourceId: 'hero',
      role: 'hero',
      layoutArchetype: 'split-hero',
      bboxByViewport: { desktop: { x: 0, y: 0, width: 1440, height: 700 } },
      nodes: [{
        sourceId: 'hero-title',
        role: 'heading',
        text: 'Hello',
        children: [],
        evidence: {
          sourceIds: ['hero-title'],
          methods: ['dom'],
          confidence: 0.95,
          warnings: [],
        },
      }],
      evidence: {
        sourceIds: ['hero'],
        methods: ['dom', 'screenshot'],
        confidence: 0.9,
        warnings: [],
      },
    }],
    assets: [],
    animations: [],
    warnings: [],
  };
}

function validSite(): SiteDeploymentManifest {
  return {
    schemaVersion: '1.0',
    sourceOrigin: 'https://example.test',
    deployment: {
      targetProfileId: 'test-target',
      transactionMode: 'partial-with-explicit-scope',
      rollbackGroupId: 'run-1',
      status: 'verified',
    },
    pages: [{
      sourceRoute: '/',
      targetSlug: 'home',
      targetPostId: 42,
      kind: 'static',
      sharedComponentIds: ['header'],
      requiredAssetIds: [],
      status: 'verified',
      snapshotId: 'snapshot-42',
      rollbackStatus: 'available',
    }],
    sharedComponents: [{
      sourceComponentId: 'header',
      kind: 'header',
      targetTemplateId: 7,
      version: '1',
      status: 'verified',
      snapshotId: 'snapshot-header',
      rollbackStatus: 'available',
    }],
    unresolvedRoutes: [],
  };
}

describe('generic platform contracts', () => {
  it('accepts a valid VisualPageIR', () => {
    const result = validateVisualPageIR(validIr());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an IR without viewports, sections, or source identity', () => {
    const invalid = { ...validIr(), viewportProfiles: [], sections: [], source: { route: '/' } };
    const result = validateVisualPageIR(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'source.pageId is required',
      'source.capturedAt is required',
      'at least one viewport profile is required',
    ]));
  });

  it('surfaces low-confidence nodes as warnings without silently rejecting them', () => {
    const ir = validIr();
    ir.sections[0]!.nodes[0]!.evidence.confidence = 0.4;
    const result = validateVisualPageIR(ir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('sections[0].nodes[0].evidence has low evidence confidence (0.4)');
  });

  it('requires explicit approval for blocking fidelity decisions', () => {
    const decision: FidelityDecisionRecord = {
      sourceId: 'chart',
      code: 'CODE_COMPONENT_UNSUPPORTED',
      scope: 'section',
      decision: 'unsupported',
      capability: 'canvas-chart',
      evidenceIds: ['evidence-1'],
      confidence: 0.95,
      severity: 'critical',
      approval: 'pending',
      blocking: true,
      qaChecks: ['section-visual-diff'],
    };
    const result = validateFidelityDecisions([decision]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('decisions[0] blocks automatic continuation pending approval');
    expect(canContinueWithFidelityDecisions([decision])).toBe(false);
    expect(canContinueWithFidelityDecisions([{ ...decision, approval: 'approved' }])).toBe(true);
  });

  it('rejects built site pages without target and rollback metadata', () => {
    const site = validSite();
    delete site.pages[0]!.targetPostId;
    delete site.pages[0]!.snapshotId;
    const result = validateSiteDeploymentManifest(site);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'pages[0].targetPostId is required after build',
      'pages[0].snapshotId is required after build',
    ]));
  });

  it('rejects normalized duplicate target slugs and invalid fidelity enums', () => {
    const site = validSite();
    site.pages.push({ ...site.pages[0]!, sourceRoute: '/about', targetSlug: '/HOME/' });
    const result = validateSiteDeploymentManifest(site);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('duplicate targetSlug: home');
    expect(site.sharedComponents[0]!.targetTemplateId).toBe(7);

    const invalidDecision = validateFidelityDecisions([{
      sourceId: 'x', code: 'BAD', scope: 'unknown', decision: 'bad', capability: 'x',
      evidenceIds: [], confidence: 1, severity: 'bad', approval: 'bad', blocking: false, qaChecks: [],
    }]);
    expect(invalidDecision.valid).toBe(false);
    expect(invalidDecision.errors).toEqual(expect.arrayContaining([
      'decisions[0].scope is invalid',
      'decisions[0].decision is invalid',
      'decisions[0].severity is invalid',
      'decisions[0].approval is invalid',
    ]));
  });

  it('rejects duplicate asset IDs before emission can select the wrong asset', () => {
    const ir = validIr();
    const asset = {
      id: 'hero-image',
      kind: 'image' as const,
      sourceUrl: 'https://cdn.test/one.jpg',
      evidence: { sourceIds: ['asset'], methods: ['dom'] as const, confidence: 1, warnings: [] },
    };
    ir.assets = [asset, { ...asset, sourceUrl: 'https://cdn.test/two.jpg' }];
    const result = validateVisualPageIR(ir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('assets[1].id duplicates another asset');
  });

  it('rejects non-finite IDs and malformed nested evidence', () => {
    const site = validSite();
    site.pages[0]!.targetPostId = Number.NaN;
    const siteResult = validateSiteDeploymentManifest(site);
    expect(siteResult.valid).toBe(false);
    expect(siteResult.errors).toContain('pages[0].targetPostId is required after build');

    const ir = validIr();
    ir.animations.push({
      id: 'fade', kind: 'load', targetSourceId: 'hero', intent: 'fade',
      evidence: { sourceIds: ['a'], methods: ['dom'], confidence: 1, warnings: [] },
      durationMs: 100,
    });
    ir.animations[0]!.evidence = { sourceIds: ['a'], methods: ['invalid' as never], confidence: 1, warnings: [] };
    const irResult = validateVisualPageIR(ir);
    expect(irResult.valid).toBe(false);
    expect(irResult.errors).toContain('animations[0].evidence.methods is invalid');
  });
});
