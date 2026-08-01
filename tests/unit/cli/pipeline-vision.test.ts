import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runPipeline, type PipelineOptions } from '../../../packages/cli/src/analysis/pipeline.js';
import type { ExtractionResult } from '@elconv/extractors';
import type { AIRouter } from '@elconv/core';

function fixtureExtraction(): ExtractionResult {
  return {
    url: 'https://original.example',
    hostname: 'original.example',
    extracted_at: '2026-08-01T00:00:00.000Z',
    viewports: [{
      config: { label: 'desktop', width: 800, height: 600 },
      screenshotPath: resolve('tests/visual/baseline/fixture-800x600.png'),
    }],
    fontsIntercepted: [],
    cssVariables: {},
    sections: [{
      section_id: 'ambiguous',
      selector: '#ambiguous',
      y_range: [0, 600],
      layout: 'content',
      child_count: 1,
      tag: 'div',
    }],
    computedStyles: {
      desktop: [{
        selector: '#ambiguous',
        tag: 'div',
        styles: {},
      }],
    },
    animations: {
      has_keyframes: false,
      keyframe_names: [],
      has_gsap: false,
      has_scrolltrigger: false,
      has_framer_motion: false,
      has_lenis: false,
    },
    images: [],
    svgs: [],
    favicons: [],
  };
}

describe('runPipeline vision enhancement', () => {
  it('uses the injected router for ambiguous sections without constructing a provider or making network calls', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'elconv-pipeline-vision-'));
    const calls: string[] = [];
    const visionRouter: AIRouter = {
      execute: async (task) => {
        calls.push(task.name);
        return {
          text: JSON.stringify({
            type: 'hero',
            confidence: 0.91,
            layoutDescription: 'Visual hero section',
            primaryContentType: 'headline',
          }),
          cost: 0,
          provider: 'test-router',
          durationMs: 0,
        };
      },
    };

    const options: PipelineOptions = {
      outputDir,
      visionEnhance: true,
      visionRouter,
      preloadedExtraction: fixtureExtraction(),
      skipStages: [1, 3, 4, 5, 6, 7],
    };

    try {
      const result = await runPipeline(options.url ?? 'https://original.example', options);
      expect(calls).toEqual(['section-classify']);
      expect(result.classification?.specs[0]).toMatchObject({
        semanticType: 'hero',
        layoutDescription: 'Visual hero section',
        visionConfidence: 0.91,
      });
      expect(result.stages.find((stage) => stage.name === 'classify')?.status).toBe('ok');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
