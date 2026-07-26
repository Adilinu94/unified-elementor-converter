/**
 * Phase 7 — Animation Injector tests.
 *
 * Covers:
 *   - sectionClassName normalization
 *   - buildAnimationPlan with no animations (empty plan)
 *   - CSS keyframe bundle
 *   - CSS transition bundle
 *   - GSAP loader + trigger
 *   - Lenis loader
 *   - writeAnimationPlan disk output
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildAnimationPlan,
  sectionClassName,
  writeAnimationPlan,
} from '@elconv/target-v3';
import type { AnimationInfo } from '@elconv/target-v3';
import type { SectionInfo } from '@elconv/core';

const emptyAnimations: AnimationInfo = {
  has_keyframes: false,
  keyframe_names: [],
  has_gsap: false,
  has_scrolltrigger: false,
  has_framer_motion: false,
  has_lenis: false,
};

const fullAnimations: AnimationInfo = {
  has_keyframes: true,
  keyframe_names: ['fadeInUp', 'slideInLeft', 'pulse'],
  has_gsap: true,
  has_scrolltrigger: true,
  has_framer_motion: false,
  has_lenis: true,
  transitions: [
    {
      selector: '#hero',
      property: 'opacity',
      duration: '0.3s',
      easing: 'ease',
      delay: '0s',
    },
    {
      selector: '#cta',
      property: 'transform',
      duration: '0.2s',
      easing: 'ease-out',
      delay: '0s',
    },
  ],
};

const sampleSections: SectionInfo[] = [
  { section_id: 'hero', selector: '#hero', y_range: [0, 800], layout: 'hero', child_count: 4 },
  { section_id: 'features', selector: '#features', y_range: [800, 1600], layout: 'grid', child_count: 6 },
];

describe('sectionClassName', () => {
  it('normalizes section_id to CSS-safe class', () => {
    expect(sectionClassName('hero')).toBe('section-hero');
    expect(sectionClassName('Section_01')).toBe('section-section_01');
  });

  it('replaces unsafe characters with dashes', () => {
    expect(sectionClassName('a b/c?d')).toBe('section-a-b-c-d');
  });

  it('handles missing section_id with "unnamed"', () => {
    expect(sectionClassName(undefined)).toBe('section-unnamed');
    expect(sectionClassName(null)).toBe('section-unnamed');
  });
});

describe('buildAnimationPlan', () => {
  it('returns an empty plan when no animations are detected', () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: emptyAnimations,
      sections: sampleSections,
    });
    expect(plan.snippets).toHaveLength(0);
    expect(plan.hasAnimations).toBe(false);
    expect(plan.sectionTargets).toEqual(['hero', 'features']);
  });

  it('generates a keyframe-bundle snippet when @keyframes are detected', () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: fullAnimations,
      sections: sampleSections,
    });
    const kf = plan.snippets.find((s) => s.id === 'keyframes-bundle');
    expect(kf).toBeDefined();
    expect(kf!.type).toBe('css');
    expect(kf!.code).toContain('@keyframes fadeInUp');
    expect(kf!.code).toContain('@keyframes slideInLeft');
    expect(kf!.code).toContain('.section-hero');
    expect(kf!.code).toContain('.section-features');
    expect(kf!.source).toEqual({ kind: 'keyframes', names: ['fadeInUp', 'slideInLeft', 'pulse'] });
  });

  it('generates a transition-bundle snippet for non-default transitions', () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: fullAnimations,
      sections: sampleSections,
    });
    const tr = plan.snippets.find((s) => s.id === 'transitions-bundle');
    expect(tr).toBeDefined();
    expect(tr!.type).toBe('css');
    expect(tr!.code).toContain('transition: opacity 0.3s');
    expect(tr!.code).toContain('.section-hero');
  });

  it('generates GSAP loader + trigger snippets when has_gsap is true', () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: fullAnimations,
      sections: sampleSections,
    });
    const loader = plan.snippets.find((s) => s.id === 'gsap-loader');
    const trigger = plan.snippets.find((s) => s.id === 'gsap-trigger');
    expect(loader).toBeDefined();
    expect(loader!.type).toBe('js');
    expect(loader!.code).toContain('gsap.min.js');
    expect(loader!.code).toContain('ScrollTrigger.min.js');
    expect(trigger).toBeDefined();
    expect(trigger!.code).toContain('.section-hero, .section-features');
    expect(trigger!.code).toContain('gsap.from');
  });

  it('skips GSAP trigger snippet when no sections are available', () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: fullAnimations,
      sections: [],
    });
    expect(plan.snippets.find((s) => s.id === 'gsap-loader')).toBeDefined();
    expect(plan.snippets.find((s) => s.id === 'gsap-trigger')).toBeUndefined();
  });

  it('generates a Lenis snippet when has_lenis is true', () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: fullAnimations,
      sections: sampleSections,
    });
    const lenis = plan.snippets.find((s) => s.id === 'lenis-loader');
    expect(lenis).toBeDefined();
    expect(lenis!.type).toBe('js');
    expect(lenis!.code).toContain('lenis.min.js');
    expect(lenis!.code).toContain('new window.Lenis()');
  });

  it('respects includeSectionIds filter', () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: fullAnimations,
      sections: sampleSections,
      includeSectionIds: ['hero'],
    });
    expect(plan.sectionTargets).toEqual(['hero']);
    const kf = plan.snippets.find((s) => s.id === 'keyframes-bundle');
    expect(kf!.code).toContain('.section-hero');
    expect(kf!.code).not.toContain('.section-features');
  });

  it('sets the correct WPCode location + priority for each snippet', () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: fullAnimations,
      sections: sampleSections,
    });
    for (const s of plan.snippets) {
      expect(['site-wide-header', 'site-wide-footer', 'frontend-only']).toContain(s.location);
      expect(typeof s.priority).toBe('number');
    }
    // Header snippets (CSS) come before footer snippets (JS).
    const kf = plan.snippets.find((s) => s.id === 'keyframes-bundle')!;
    const gsap = plan.snippets.find((s) => s.id === 'gsap-loader')!;
    expect(kf.location).toBe('site-wide-header');
    expect(gsap.location).toBe('site-wide-footer');
  });
});

describe('writeAnimationPlan', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = path.join(tmpdir(), `animation-injector-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('persists animation-plan.json + wpcode-snippets.json', async () => {
    const plan = buildAnimationPlan({
      url: 'https://example.com',
      animations: fullAnimations,
      sections: sampleSections,
    });
    const { planPath, manifestPath } = await writeAnimationPlan(plan, tmpDir);
    expect(planPath).toBe(path.join(tmpDir, 'animation-plan.json'));
    expect(manifestPath).toBe(path.join(tmpDir, 'wpcode-snippets.json'));

    const planContent = JSON.parse(await fs.readFile(planPath, 'utf-8'));
    expect(planContent.url).toBe('https://example.com');
    expect(planContent.snippets.length).toBeGreaterThan(0);

    const manifestContent = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    expect(Array.isArray(manifestContent)).toBe(true);
    expect(manifestContent.length).toBe(planContent.snippets.length);
  });
});
