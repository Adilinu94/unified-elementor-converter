import { describe, it, expect, beforeEach } from 'vitest';
import {
  guardThresholdForStrictness,
  matchesSectionSelector,
  selectSpecSections,
  EMPTY_DESIGN_TOKEN_SET,
  type SourceSpec,
} from '@elconv/core';
import { buildV3Tree, resetIdCounter } from '@elconv/target-v3';
import { buildV4Tree, resetV4IdCounter } from '@elconv/target-v4';
import { getProfile } from '@elconv/qa';
import { acceptanceScoreForStrictness } from '../../../packages/cli/src/analysis/pipeline.js';

/**
 * O-04 parity preparation — build options.
 *
 * The wizard's strictness/animations/fonts/sections options are now actually
 * forwarded to the build adapters. These tests freeze the parts the adapters
 * genuinely consume today: the strictness→guard-threshold mapping, the section
 * selector matching, and the sections filter inside buildV3Tree/buildV4Tree.
 */

function makeSpec(overrides?: Partial<SourceSpec>): SourceSpec {
  return {
    source: { type: 'url', url: 'https://example.com' },
    tokens: EMPTY_DESIGN_TOKEN_SET,
    sections: [
      {
        id: 'sec-hero',
        semanticRole: 'hero',
        cssClass: 'page-hero',
        layout: 'single-column',
        widgets: [{ id: 'w1', type: 'heading', text: 'Hero', styles: { 'font-size': '48px' } }],
        styles: { 'background-color': '#111111' },
      },
      {
        id: 'sec-stats',
        semanticRole: 'stats',
        cssClass: 'page-stats',
        layout: 'single-column',
        widgets: [{ id: 'w2', type: 'text', text: 'Stats', styles: {} }],
        styles: {},
      },
      {
        id: 'sec-footer',
        semanticRole: 'footer',
        cssClass: 'page-footer',
        layout: 'single-column',
        widgets: [{ id: 'w3', type: 'text', text: 'Footer', styles: {} }],
        styles: {},
      },
    ],
    cssVars: {},
    warnings: [],
    ...overrides,
  };
}

describe('guardThresholdForStrictness', () => {
  it('maps draft to 70, balanced to 85, pixel-perfect to 95', () => {
    expect(guardThresholdForStrictness('draft')).toBe(70);
    expect(guardThresholdForStrictness('balanced')).toBe(85);
    expect(guardThresholdForStrictness('pixel-perfect')).toBe(95);
  });

  it('defaults to 85 (balanced) when strictness is absent', () => {
    expect(guardThresholdForStrictness()).toBe(85);
    expect(guardThresholdForStrictness(undefined)).toBe(85);
  });

  it('mirrors the QA strictness profiles (cross-package drift guard)', () => {
    // core cannot import from @elconv/qa (package cycle), so the threshold map
    // duplicates the profile minMatchPercent values — this test pins both.
    for (const s of ['draft', 'balanced', 'pixel-perfect'] as const) {
      expect(guardThresholdForStrictness(s)).toBe(getProfile(s).minMatchPercent);
    }
  });
});

describe('acceptanceScoreForStrictness (pipeline QA mapping)', () => {
  it('maps draft/balanced/pixel-perfect to 0.70/0.85/0.95', () => {
    expect(acceptanceScoreForStrictness('draft')).toBe(0.7);
    expect(acceptanceScoreForStrictness('balanced')).toBe(0.85);
    expect(acceptanceScoreForStrictness('pixel-perfect')).toBe(0.95);
  });

  it('returns undefined without a strictness so the runner default applies', () => {
    expect(acceptanceScoreForStrictness(undefined)).toBeUndefined();
  });

  it('agrees with the QA strictness profiles', () => {
    for (const s of ['draft', 'balanced', 'pixel-perfect'] as const) {
      expect(acceptanceScoreForStrictness(s)).toBe(getProfile(s).minMatchPercent / 100);
    }
  });
});

describe('matchesSectionSelector', () => {
  it('matches by id, semanticRole and cssClass (case-insensitive)', () => {
    const section = { id: 'sec-hero', semanticRole: 'hero', cssClass: 'page-hero' };
    expect(matchesSectionSelector(section, ['sec-hero'])).toBe(true);
    expect(matchesSectionSelector(section, ['HERO'])).toBe(true);
    expect(matchesSectionSelector(section, ['page-hero'])).toBe(true);
    expect(matchesSectionSelector(section, ['stats'])).toBe(false);
  });

  it('matches by section_id for classified specs (V1 pipeline path)', () => {
    expect(matchesSectionSelector({ section_id: 'sec-1' }, ['sec-1'])).toBe(true);
    expect(matchesSectionSelector({ section_id: 'sec-1' }, ['sec-2'])).toBe(false);
  });

  it('returns true when no selectors are given (or all blank)', () => {
    expect(matchesSectionSelector({ id: 'x' })).toBe(true);
    expect(matchesSectionSelector({ id: 'x' }, [])).toBe(true);
    expect(matchesSectionSelector({ id: 'x' }, [' ', ''])).toBe(true);
  });
});

describe('selectSpecSections', () => {
  it('returns every section without selectors', () => {
    expect(selectSpecSections(makeSpec())).toHaveLength(3);
    expect(selectSpecSections(makeSpec(), [])).toHaveLength(3);
  });

  it('filters by section id / semanticRole / cssClass', () => {
    const spec = makeSpec();
    expect(selectSpecSections(spec, ['sec-hero']).map((s) => s.id)).toEqual(['sec-hero']);
    expect(selectSpecSections(spec, ['stats']).map((s) => s.id)).toEqual(['sec-stats']);
    expect(selectSpecSections(spec, ['page-footer']).map((s) => s.id)).toEqual(['sec-footer']);
    expect(selectSpecSections(spec, ['hero', 'footer']).map((s) => s.id)).toEqual(['sec-hero', 'sec-footer']);
  });

  it('returns an empty list when no selector matches', () => {
    expect(selectSpecSections(makeSpec(), ['does-not-exist'])).toEqual([]);
  });
});

describe('buildV3Tree forwards the sections option', () => {
  beforeEach(() => resetIdCounter());

  it('builds every section without options', () => {
    expect(buildV3Tree(makeSpec())).toHaveLength(3);
  });

  it('builds only matching sections with the sections filter', () => {
    const spec = makeSpec();
    const onlyHero = buildV3Tree(spec, { sections: ['hero'] });
    expect(onlyHero).toHaveLength(1);
    const onlyFooter = buildV3Tree(spec, { sections: ['page-footer'] });
    expect(onlyFooter).toHaveLength(1);
    const none = buildV3Tree(spec, { sections: ['missing'] });
    expect(none).toHaveLength(0);
  });

  it('accepts strictness/animations/fonts without changing the built tree', () => {
    const full = buildV3Tree(makeSpec());
    const withOptions = buildV3Tree(makeSpec(), { strictness: 'pixel-perfect', animations: 'none', fonts: 'system' });
    expect(withOptions).toHaveLength(full.length);
  });
});

describe('buildV4Tree forwards the sections option', () => {
  beforeEach(() => resetV4IdCounter());

  it('builds every section without options', () => {
    expect(buildV4Tree(makeSpec())).toHaveLength(3);
  });

  it('builds only matching sections with the sections filter', () => {
    const spec = makeSpec();
    const onlyStats = buildV4Tree(spec, { sections: ['stats'] });
    expect(onlyStats).toHaveLength(1);
    expect(onlyStats[0]!.type).toBe('e-flexbox');
    const none = buildV4Tree(spec, { sections: ['missing'] });
    expect(none).toHaveLength(0);
  });

  it('accepts strictness/animations/fonts without changing the built tree', () => {
    const full = buildV4Tree(makeSpec());
    const withOptions = buildV4Tree(makeSpec(), { strictness: 'draft', animations: 'auto', fonts: 'all' });
    expect(withOptions).toHaveLength(full.length);
  });
});
