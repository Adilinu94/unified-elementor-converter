import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline, type PipelineOptions } from '../../../packages/cli/src/analysis/pipeline.js';
import type { AcceptanceReport } from '@elconv/qa';

function acceptanceReport(outputDir: string): AcceptanceReport {
  return {
    verdict: 'pass',
    score: 0.99,
    matchPercent: 99,
    originalCapture: {
      url: 'https://original.example',
      outputPath: join(outputDir, 'original.png'),
      width: 2,
      height: 2,
      bytes: 0,
      capturedAt: new Date().toISOString(),
    },
    cloneCapture: {
      url: 'https://clone.example',
      outputPath: join(outputDir, 'clone.png'),
      width: 2,
      height: 2,
      bytes: 0,
      capturedAt: new Date().toISOString(),
    },
    diffResult: {
      originalPath: join(outputDir, 'original.png'),
      clonePath: join(outputDir, 'clone.png'),
      width: 2,
      height: 2,
      totalPixels: 4,
      diffPixels: 0,
      diffPercent: 0,
      matchPercent: 100,
      computedAt: new Date().toISOString(),
    },
    recommendations: [],
    generatedAt: new Date().toISOString(),
  };
}

describe('runPipeline legacy repair integration', () => {
  it('marks requested repair paths unavailable and exposes their artifacts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'elconv-pipeline-repair-'));
    try {
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('OPENAI_API_KEY', '');
      let acceptanceCalls = 0;
      const options: PipelineOptions = {
        url: 'https://original.example',
        outputDir,
        cloneUrl: 'https://clone.example',
        qaAutoFix: true,
        heal: true,
        fullContextRepair: true,
        skipStages: [1, 2, 3, 4, 5, 6],
        acceptanceRunner: async (acceptanceOptions) => {
          acceptanceCalls += 1;
          return acceptanceReport(acceptanceOptions.outputDir);
        },
      };

      const result = await runPipeline(options.url, options);
      const qaStage = result.stages.find((stage) => stage.name === 'qa');

      expect(acceptanceCalls).toBe(1);
      expect(qaStage?.status).toBe('failed');
      expect(qaStage?.summary.repairs).toEqual({
        autoFix: 'unavailable',
        healing: 'unavailable',
        fullContextRepair: 'unavailable',
      });
      expect(result.repairs?.autoFix?.status).toBe('unavailable');
      expect(result.repairs?.healing?.status).toBe('unavailable');
      expect(result.repairs?.fullContextRepair?.status).toBe('unavailable');
      expect(result.artifacts['qa-auto-fix']).toMatch(/auto-fix-report\.json$/);
      expect(result.artifacts.healing).toMatch(/healing-report\.json$/);
      expect(result.artifacts['full-context-repair']).toMatch(/repair-report\.json$/);
    } finally {
      vi.unstubAllEnvs();
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
