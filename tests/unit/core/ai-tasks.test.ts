import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  AIRouter,
  runVisionQA,
  parseVisionQAResponse,
  ratingFromScore,
  runSectionClassification,
  runComponentDetectVision,
  runTokenSemantics,
  buildRepairBlockPrompt,
  repairBlockViaAI,
  type AITask,
  type AIResponse,
  type VisionProvider,
  type RepairBlockInput,
} from '@elconv/core';

// Uses the real AIRouter class with a single mock VisionProvider (the monorepo
// pattern, cf. ai-engine.test.ts) — the AIRouter *interface* isn't exported from
// the @elconv/core barrel (the class shadows the name), so a bare `{ execute }`
// object literal can't be typed as it. The task under test hands its task object
// to provider.execute, which taskSpy captures.
function fakeRouter(text: string, taskSpy?: (task: AITask) => void): AIRouter {
  const provider: VisionProvider = {
    name: 'claude-sonnet-4-6',
    costPerImage: 0.004,
    available: async () => true,
    execute: async (task: AITask): Promise<AIResponse> => {
      taskSpy?.(task);
      return { text, cost: 0.004, provider: 'claude-sonnet-4-6', durationMs: 10 };
    },
  };
  return new AIRouter([provider]);
}

async function makeTempPng(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-task-test-'));
  const file = path.join(dir, 'shot.png');
  await fs.writeFile(file, Buffer.from([1, 2, 3, 4]));
  return file;
}

describe('vision-qa.task', () => {
  it('ratingFromScore maps score ranges to labels', () => {
    expect(ratingFromScore(100)).toBe('excellent');
    expect(ratingFromScore(90)).toBe('good');
    expect(ratingFromScore(75)).toBe('fair');
    expect(ratingFromScore(10)).toBe('poor');
  });

  it('parseVisionQAResponse parses valid JSON and clamps/validates fields', () => {
    const { score, issues, feedback } = parseVisionQAResponse(JSON.stringify({
      overallScore: 150,
      issues: [{ type: 'color-mismatch', severity: 'high', location: 'hero', description: 'd', suggestedFix: 'f' }],
      semanticFeedback: 'looks close',
    }));
    expect(score).toBe(100); // clamped
    expect(issues).toHaveLength(1);
    expect(feedback).toBe('looks close');
  });

  it('parseVisionQAResponse falls back gracefully on non-JSON text', () => {
    const { score, issues } = parseVisionQAResponse('not json at all');
    expect(score).toBe(0);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('high');
  });

  it('runVisionQA sends both screenshots as images and returns a parsed result', async () => {
    const [originalPath, clonePath] = await Promise.all([makeTempPng(), makeTempPng()]);
    let sentTask: AITask | undefined;
    const router = fakeRouter(
      JSON.stringify({ overallScore: 92, issues: [], semanticFeedback: 'good match' }),
      (task) => { sentTask = task; },
    );

    const result = await runVisionQA(router, { originalPath, clonePath });

    expect(result.overallScore).toBe(92);
    expect(result.matchRating).toBe('good');
    expect(sentTask?.name).toBe('vision-qa');
    expect(sentTask?.images).toHaveLength(2);
    expect(sentTask?.images?.[0].path).toBe(originalPath);
  });
});

describe('section-classify.task', () => {
  it('runSectionClassification returns value + confidence from a valid response', async () => {
    const shot = await makeTempPng();
    const router = fakeRouter(JSON.stringify({
      type: 'hero',
      confidence: 0.87,
      layoutDescription: 'big image, headline, CTA',
      primaryContentType: 'headline',
    }));

    const result = await runSectionClassification(router, shot);
    expect(result.value.type).toBe('hero');
    expect(result.confidence).toBeCloseTo(0.87);
  });

  it('runSectionClassification returns unknown/0 confidence on unparsable response', async () => {
    const shot = await makeTempPng();
    const router = fakeRouter('garbage, not json');
    const result = await runSectionClassification(router, shot);
    expect(result.value.type).toBe('unknown');
    expect(result.confidence).toBe(0);
  });
});

describe('component-detect.task', () => {
  it('runComponentDetectVision maps section classification into ComponentDetectionResult shape', async () => {
    const shot = await makeTempPng();
    const router = fakeRouter(JSON.stringify({
      type: 'features',
      confidence: 0.7,
      layoutDescription: '3 cards with icons',
      primaryContentType: 'icon+text',
    }));

    const result = await runComponentDetectVision(router, shot);
    expect(result.type).toBe('features');
    expect(result.confidence).toBeCloseTo(0.7);
    expect(result.evidence).toBe('3 cards with icons');
    expect(result.layer).toBe('vision');
  });
});

describe('token-semantics.task', () => {
  it('runTokenSemantics parses a valid role response', async () => {
    const router = fakeRouter(JSON.stringify({ role: 'accent', confidence: 0.6, reasoning: 'high saturation, used on CTAs' }));
    const result = await runTokenSemantics(router, { hex: '#ff6600' });
    expect(result.value.role).toBe('accent');
    expect(result.confidence).toBeCloseTo(0.6);
  });

  it('runTokenSemantics falls back to unknown/0 on unparsable response', async () => {
    const router = fakeRouter('nope');
    const result = await runTokenSemantics(router, { hex: '#000000' });
    expect(result.value.role).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('runTokenSemantics rejects an invalid role value from the model', async () => {
    const router = fakeRouter(JSON.stringify({ role: 'totally-made-up', confidence: 0.9, reasoning: 'x' }));
    const result = await runTokenSemantics(router, { hex: '#123456' });
    expect(result.value.role).toBe('unknown');
  });
});

describe('repair-block.task', () => {
  function makeRepairInput(overrides: Partial<RepairBlockInput> = {}): RepairBlockInput {
    return {
      originalScreenshotPath: '/tmp/original-crop.png',
      cloneScreenshotPath: '/tmp/clone-crop.png',
      html: '<div class="card"><h3>Title</h3></div>',
      computedCss: { color: '#333333' },
      elementType: 'e-flexbox',
      ...overrides,
    };
  }

  it('buildRepairBlockPrompt interpolates element info, hotspot, and token constraints', () => {
    const prompt = buildRepairBlockPrompt(makeRepairInput({
      diffHotspot: { x: 10, y: 20, width: 100, height: 50 },
      parentHtml: '<section>...</section>',
      siblingHtml: ['<div>sib1</div>'],
      tokenConstraints: { colors: [{ hex: '#ff0000' }, { hex: '#00ff00' }], spacing: [] },
      existingClasses: ['gc-primary-button'],
    }));

    expect(prompt).toContain('e-flexbox');
    expect(prompt).toContain('"x":10');
    expect(prompt).toContain('#ff0000');
    expect(prompt).toContain('gc-primary-button');
    expect(prompt).toContain('<div>sib1</div>');
  });

  it('buildRepairBlockPrompt handles missing optional fields gracefully', () => {
    const prompt = buildRepairBlockPrompt(makeRepairInput());
    expect(prompt).toContain('(kein)');
    expect(prompt).toContain('(keine)');
    expect(prompt).not.toContain('Diff-Hotspot');
  });

  it('repairBlockViaAI sends both screenshots and returns a parsed RepairResult on success', async () => {
    let sentTask: AITask | undefined;
    const router = fakeRouter(
      JSON.stringify({
        settings: { title_color: '#ff0000' },
        styles: {},
        classes: ['gc-fixed'],
        explanation: 'Fixed the title color to match the original.',
      }),
      (task) => { sentTask = task; },
    );

    const result = await repairBlockViaAI(router, makeRepairInput());

    expect(result.success).toBe(true);
    expect(result.settings).toEqual({ title_color: '#ff0000' });
    expect(result.classes).toEqual(['gc-fixed']);
    expect(result.attemptsUsed).toBe(1);
    expect(sentTask?.name).toBe('repair-block');
    expect(sentTask?.images).toHaveLength(2);
  });

  it('repairBlockViaAI reports failure on unparsable AI response', async () => {
    const router = fakeRouter('not json at all');
    const result = await repairBlockViaAI(router, makeRepairInput());
    expect(result.success).toBe(false);
    expect(result.explanation).toContain('kein gültiges JSON');
  });
});
