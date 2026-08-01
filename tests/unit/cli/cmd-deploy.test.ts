import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildV3Tree } from '../../../packages/target-v3/src/builder.ts';
import { buildV4Tree } from '../../../packages/target-v4/src/builder.ts';
import { EMPTY_DESIGN_TOKEN_SET, type SourceSpec } from '@elconv/core';
import { cmdDeploy } from '../../../packages/cli/src/cmd-deploy.ts';
import type { PageSnapshot, WpPushResult } from '@elconv/mcp';

const AUTH_ENV = 'ELCONV_DEPLOY_TEST_AUTH';

function makeSpec(): SourceSpec {
  return {
    source: { type: 'url', url: 'https://example.com' },
    tokens: EMPTY_DESIGN_TOKEN_SET,
    sections: [
      {
        id: 'hero',
        semanticRole: 'hero',
        layout: 'single-column',
        widgets: [{ id: 'heading', type: 'heading', text: 'Hello', styles: { 'font-size': '48px' } }],
        styles: {},
      },
    ],
    cssVars: {},
    warnings: [],
  };
}

function writeTree(tree: unknown[]): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'elconv-deploy-'));
  const path = join(dir, 'tree.json');
  writeFileSync(path, JSON.stringify(tree), 'utf8');
  return { dir, path };
}

function snapshot(): PageSnapshot {
  return {
    postId: 42,
    timestamp: '2026-08-01T10:00:00.000Z',
    content: [{ id: 'existing' }],
  };
}

function pushResult(target: 'v3' | 'v4'): WpPushResult {
  return {
    postId: 42,
    permalink: `https://example.com/${target}`,
    created: false,
    dryRun: false,
    target,
  };
}

describe('cmdDeploy real MCP wiring', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    process.env[AUTH_ENV] = 'user:application-password';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[AUTH_ENV];
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('requires auth for a real deploy', async () => {
    delete process.env[AUTH_ENV];
    const { dir, path } = writeTree(buildV3Tree(makeSpec()));
    tempDirs.push(dir);

    const code = await cmdDeploy({
      target: 'v3', tree: path, 'post-id': '42', 'mcp-url': 'https://mcp.test', 'auth-env': AUTH_ENV,
    });

    expect(code).toBe(2);
  });

  it.each([
    ['v3', () => buildV3Tree(makeSpec())],
    ['v4', () => buildV4Tree(makeSpec())],
  ] as const)('captures a snapshot before pushing a %s tree', async (target, buildTree) => {
    const { dir, path } = writeTree(buildTree());
    tempDirs.push(dir);
    const events: string[] = [];
    let pushedTarget: string | undefined;
    let pushedContent: unknown[] | undefined;

    const code = await cmdDeploy(
      { target, tree: path, 'post-id': '42', 'mcp-url': 'https://mcp.test', 'auth-env': AUTH_ENV, strategy: 'direct' },
      {
        createAdapter: () => ({}) as never,
        captureSnapshot: async () => {
          events.push('snapshot');
          return snapshot();
        },
        saveSnapshot: () => {
          events.push('save');
          return join(dir, 'snapshot.json');
        },
        pushPage: async (_adapter, content, options) => {
          events.push('push');
          pushedTarget = options.target;
          pushedContent = content;
          return pushResult(options.target);
        },
      },
    );

    expect(code).toBe(0);
    expect(events).toEqual(['snapshot', 'save', 'push']);
    expect(pushedTarget).toBe(target);
    expect(pushedContent).toHaveLength(1);
    expect(JSON.stringify(pushedContent)).toContain(target === 'v3' ? 'container' : 'e-flexbox');
  });

  it('rejects server conversion on V4 before taking a snapshot', async () => {
    const { dir, path } = writeTree(buildV4Tree(makeSpec()));
    tempDirs.push(dir);
    const captureSnapshot = vi.fn(async () => snapshot());

    const code = await cmdDeploy(
      {
        target: 'v4', tree: path, 'post-id': '42', 'mcp-url': 'https://mcp.test',
        'auth-env': AUTH_ENV, 'server-convert': true,
      },
      { captureSnapshot },
    );

    expect(code).toBe(2);
    expect(captureSnapshot).not.toHaveBeenCalled();
  });

  it('rejects an oversized auto strategy instead of silently forcing direct', async () => {
    const tree = buildV3Tree(makeSpec());
    const root = tree[0] as { settings?: Record<string, unknown> };
    root.settings = { ...(root.settings ?? {}), __testPayload: 'x'.repeat(450_000) };
    const { dir, path } = writeTree(tree);
    tempDirs.push(dir);
    const pushPage = vi.fn(async (_adapter: unknown, _content: unknown[], options: { target: 'v3' | 'v4' }) => pushResult(options.target));

    const code = await cmdDeploy(
      { target: 'v3', tree: path, 'post-id': '42', 'mcp-url': 'https://mcp.test', 'auth-env': AUTH_ENV, strategy: 'auto' },
      {
        createAdapter: () => ({}) as never,
        captureSnapshot: async () => snapshot(),
        saveSnapshot: () => join(dir, 'snapshot.json'),
        pushPage,
      },
    );

    expect(code).toBe(2);
    expect(pushPage).not.toHaveBeenCalled();
    expect(vi.mocked(process.stderr.write)).toHaveBeenCalledWith(expect.stringContaining('not wired to the high-level push path'));
  });

  it('reports a push failure with rollback instructions', async () => {
    const { dir, path } = writeTree(buildV3Tree(makeSpec()));
    tempDirs.push(dir);
    const code = await cmdDeploy(
      { target: 'v3', tree: path, 'post-id': '42', 'mcp-url': 'https://mcp.test', 'auth-env': AUTH_ENV, strategy: 'direct' },
      {
        createAdapter: () => ({}) as never,
        captureSnapshot: async () => snapshot(),
        saveSnapshot: () => join(dir, 'snapshot.json'),
        pushPage: async () => { throw new Error('MCP unavailable'); },
      },
    );

    expect(code).toBe(1);
    expect(vi.mocked(process.stderr.write)).toHaveBeenCalledWith(expect.stringContaining('Rollback is available'));
  });
});
