import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdConvert, type ConvertDependencies } from '../../../packages/cli/src/cmd-convert.js';
import type { PipelineResult } from '../../../packages/cli/src/analysis/pipeline.js';

function pipelineResult(artifactPath: string, target: 'v3' | 'v4' = 'v3'): PipelineResult {
  return {
    url: 'https://source.example/page',
    startedAt: '2026-08-03T00:00:00.000Z',
    finishedAt: '2026-08-03T00:00:01.000Z',
    dryRun: true,
    stages: [
      {
        name: 'extract',
        status: 'ok',
        durationMs: 10,
        outputPaths: [],
        summary: { sectionCount: 1 },
      },
      {
        name: 'build',
        status: 'ok',
        durationMs: 10,
        outputPaths: [artifactPath],
        summary: { target: 'v3' },
      },
    ],
    artifacts: target === 'v3' ? { 'v3-build': artifactPath } : { 'v4-build': artifactPath },
  };
}

function validV3Artifact(): { content: unknown[] } {
  return {
    content: [{
      id: 'section-1',
      elType: 'section',
      settings: {},
      elements: [{
        id: 'column-1',
        elType: 'column',
        settings: {},
        elements: [{
          id: 'heading-1',
          elType: 'widget',
          widgetType: 'heading',
          settings: { title: 'Hello' },
        }],
      }],
    }],
  };
}

describe('cmdConvert URL path', () => {
  it('runs the URL pipeline in dry-run mode, writes the tree and report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'elconv-convert-url-'));
    const artifactPath = join(root, 'page-v3.json');
    const outputPath = join(root, 'converted.json');
    const reportPath = join(root, 'report.json');
    await writeFile(artifactPath, JSON.stringify(validV3Artifact()), 'utf8');
    const runUrlPipeline = vi.fn(async (_url: string, options: {
      url: string;
      outputDir: string;
      dryRun: true;
      skipStages: number[];
      skipRobotsCheck?: boolean;
    }) => {
      expect(options.dryRun).toBe(true);
      expect(options.skipStages).toEqual([7]);
      expect(options.skipRobotsCheck).toBe(true);
      return pipelineResult(artifactPath);
    });

    try {
      const dependencies: ConvertDependencies = {
        runUrlPipeline,
        checkRobots: vi.fn(async () => true),
      };
      const code = await cmdConvert({
        target: 'v3',
        url: 'https://source.example/page',
        out: outputPath,
        report: reportPath,
      }, dependencies);

      expect(code).toBe(0);
      expect(runUrlPipeline).toHaveBeenCalledOnce();
      expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject(validV3Artifact().content);
      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
        status: 'ok',
        target: 'v3',
        sourceUrl: 'https://source.example/page',
        outputPath,
        reportPath,
        treeBytes: expect.any(Number),
        guardScore: 100,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects non-http URL input before starting the browser pipeline', async () => {
    const runUrlPipeline = vi.fn();
    const code = await cmdConvert({ target: 'v3', url: 'file:///tmp/page.html' }, { runUrlPipeline });
    expect(code).toBe(2);
    expect(runUrlPipeline).not.toHaveBeenCalled();
  });

  it('writes a failed report when browser extraction fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'elconv-convert-url-failure-'));
    const reportPath = join(root, 'failure.json');
    const runUrlPipeline = vi.fn(async () => {
      throw new Error('robots.txt disallows crawling https://blocked.example');
    });

    try {
      const code = await cmdConvert({
        target: 'v4',
        url: 'https://blocked.example',
        report: reportPath,
      }, { runUrlPipeline, checkRobots: vi.fn(async () => true) });
      expect(code).toBe(1);
      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
        status: 'failed',
        target: 'v4',
        error: 'robots check failed: robots.txt disallows crawling https://blocked.example',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports the V4 artifact shape and guard report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'elconv-convert-url-v4-'));
    const artifactPath = join(root, 'page-v4.json');
    const outputPath = join(root, 'converted-v4.json');
    const reportPath = join(root, 'report-v4.json');
    const tree = [{
      type: 'e-flexbox', elType: 'e-flexbox', widgetType: 'e-flexbox', id: 'root',
      settings: {}, styles: {}, elements: [],
    }];
    await writeFile(artifactPath, JSON.stringify({ tree }), 'utf8');
    try {
      const code = await cmdConvert({
        target: 'v4', url: 'https://source.example/v4', out: outputPath, report: reportPath,
      }, {
        runUrlPipeline: vi.fn(async () => pipelineResult(artifactPath, 'v4')),
        checkRobots: vi.fn(async () => true),
      });
      expect(code).toBe(0);
      expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(tree);
      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({ status: 'ok', target: 'v4', guardScore: 100 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects multiple source flags', async () => {
    const code = await cmdConvert({
      target: 'v3',
      url: 'https://source.example',
      html: 'page.html',
    });
    expect(code).toBe(2);
  });

  it('rejects an output/report path collision before starting the pipeline', async () => {
    const runUrlPipeline = vi.fn();
    const code = await cmdConvert({
      target: 'v3',
      url: 'https://source.example',
      out: './artifacts/tree.json',
      report: 'artifacts/tree.json',
    }, { runUrlPipeline });
    expect(code).toBe(2);
    expect(runUrlPipeline).not.toHaveBeenCalled();
  });

  it('applies timeout-ms as a total URL conversion budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'elconv-convert-url-timeout-'));
    const reportPath = join(root, 'timeout.json');
    try {
      const code = await cmdConvert({
        target: 'v3',
        url: 'https://slow.example',
        report: reportPath,
        'timeout-ms': '10',
      }, {
        checkRobots: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return true;
        }),
        runUrlPipeline: vi.fn(),
      });
      expect(code).toBe(1);
      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
        status: 'failed',
        error: 'robots check timed out: URL conversion timed out during robots check',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
