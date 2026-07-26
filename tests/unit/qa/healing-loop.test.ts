import { describe, it, expect } from 'vitest';
import { runHealingLoop } from '@elconv/qa';

describe('Healing Loop', () => {
  it('returns immediately if score already meets target', async () => {
    const report = await runHealingLoop({
      referencePath: 'ref.png',
      clonePath: 'clone.png',
      outputDir: '/tmp',
      targetScore: 50,
      diffFn: async () => ({
        viewport: { width: 1440, height: 900, label: 'desktop' },
        totalPixels: 1296000,
        diffPixels: 0,
        diffPercent: 0,
        score: 100,
        regions: [],
      }),
    });
    expect(report.targetReached).toBe(true);
    expect(report.totalIterations).toBe(0);
  });

  it('iterates and improves score', async () => {
    const report = await runHealingLoop({
      referencePath: 'ref.png',
      clonePath: 'clone.png',
      outputDir: '/tmp',
      targetScore: 90,
      maxIterations: 3,
      diffFn: async () => ({
        viewport: { width: 1440, height: 900, label: 'desktop' },
        totalPixels: 1296000,
        diffPixels: 100000,
        diffPercent: 8,
        score: 84,
        regions: [
          {
            id: 'r1',
            semanticRole: 'hero',
            x: 0,
            y: 0,
            width: 1440,
            height: 400,
            diffPixels: 50000,
            diffPercent: 8,
            severity: 'critical' as const,
          },
          {
            id: 'r2',
            semanticRole: 'content',
            x: 0,
            y: 400,
            width: 1440,
            height: 300,
            diffPixels: 30000,
            diffPercent: 5,
            severity: 'warning' as const,
          },
        ],
      }),
      fixFn: async (fixes) => ({ applied: fixes.length, succeeded: fixes.length }),
    });
    expect(report.totalIterations).toBeGreaterThan(0);
    expect(report.finalScore).toBeGreaterThan(report.initialScore);
  });

  it('respects maxIterations', async () => {
    const report = await runHealingLoop({
      referencePath: 'ref.png',
      clonePath: 'clone.png',
      outputDir: '/tmp',
      targetScore: 99,
      maxIterations: 2,
      diffFn: async () => ({
        viewport: { width: 1440, height: 900, label: 'desktop' },
        totalPixels: 1296000,
        diffPixels: 200000,
        diffPercent: 15,
        score: 70,
        regions: [
          {
            id: 'r1',
            semanticRole: 'hero',
            x: 0,
            y: 0,
            width: 1440,
            height: 400,
            diffPixels: 100000,
            diffPercent: 15,
            severity: 'critical' as const,
          },
        ],
      }),
      fixFn: async (fixes) => ({ applied: fixes.length, succeeded: 1 }),
    });
    expect(report.totalIterations).toBeLessThanOrEqual(2);
    expect(report.targetReached).toBe(false);
  });
});
