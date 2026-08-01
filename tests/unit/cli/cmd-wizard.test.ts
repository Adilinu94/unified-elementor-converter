import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

// Mock the interactive prompt layer so the wizard can be driven headlessly.
// vi.mock is hoisted above the static imports below, so the SUT sees the mock.
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
}));

import { select, input, confirm } from '@inquirer/prompts';
import { cmdWizard, collectWizardOptionsInteractive, createWizardState, saveWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import type { PageSnapshot, WpPushResult } from '@elconv/mcp';

describe('collectWizardOptionsInteractive', () => {
  it('collects a V4 + live-URL + dry-run build from the prompts', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('v4' as never) // target
      .mockResolvedValueOnce('url' as never); // source type
    vi.mocked(input).mockResolvedValueOnce('https://example.com' as never); // url
    vi.mocked(input).mockResolvedValueOnce('./out/v4-tree.json' as never); // output
    vi.mocked(confirm)
      .mockResolvedValueOnce(false as never) // deploy now?
      .mockResolvedValueOnce(true as never); // dry run?

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const opts = await collectWizardOptionsInteractive();

    expect(opts.target).toBe('v4');
    expect(opts.url).toBe('https://example.com');
    expect(opts.xml).toBeUndefined();
    expect(opts.html).toBeUndefined();
    expect(opts.out).toBe('./out/v4-tree.json');
    expect(opts.postId).toBeUndefined();
    expect(opts.dryRun).toBe(true);
  });
});

describe('cmdWizard — mode branching', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 2 for --no-interactive without a target', async () => {
    const code = await cmdWizard({ 'no-interactive': true });
    expect(code).toBe(2);
  });

  it('returns 2 when interactive mode is requested without a TTY', async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const code = await cmdWizard({}); // no target, no --no-interactive → interactive path
      expect(code).toBe(2);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
    }
  });

  it('runs the flag-mode state machine end-to-end in dry-run and returns 0', async () => {
    const stateFile = join(tmpdir(), `elconv-wizard-${Math.random().toString(36).slice(2)}.json`);
    try {
      const createAdapter = vi.fn(() => ({}) as never);
      const runLivePreflight = vi.fn(async () => ({ passed: true, message: 'should not run' }));
      const code = await cmdWizard(
        {
          target: 'v3',
          html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
          'dry-run': true,
          'state-file': stateFile,
        },
        { createAdapter, runLivePreflight },
      );
      expect(code).toBe(0);
      // State was persisted so --resume can pick up, and the dry-run created
      // the same local source/tree artifacts as a real build.
      expect(existsSync(stateFile)).toBe(true);
      const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
        treePath?: string;
        dryRun?: boolean;
      };
      expect(state.treePath).toBeTruthy();
      expect(existsSync(state.treePath!)).toBe(true);
      expect(state.dryRun).toBe(true);
      expect(createAdapter).not.toHaveBeenCalled();
      expect(runLivePreflight).not.toHaveBeenCalled();
    } finally {
      if (existsSync(stateFile)) rmSync(stateFile);
    }
  });

  it('preserves a saved dry-run mode when resuming without an explicit mode flag', async () => {
    const root = join(tmpdir(), `elconv-wizard-resume-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    const outputPath = join(root, 'tree.json');
    mkdirSync(root, { recursive: true });
    const state = createWizardState({
      target: 'v3',
      html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
      out: outputPath,
      dryRun: true,
    });
    saveWizardState(state, stateFile);
    const createAdapter = vi.fn(() => ({}) as never);
    try {
      const code = await cmdWizard({ resume: true, 'state-file': stateFile }, { createAdapter });
      const resumed = JSON.parse(readFileSync(stateFile, 'utf8')) as { dryRun?: boolean };
      expect(code).toBe(0);
      expect(resumed.dryRun).toBe(true);
      expect(createAdapter).not.toHaveBeenCalled();
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks a real deploy when live preflight fails and persists the preflight phase', async () => {
    const stateFile = join(tmpdir(), `elconv-wizard-preflight-${Math.random().toString(36).slice(2)}.json`);
    const preflight = vi.fn(async () => ({ passed: false, message: 'Atomic runtime unavailable' }));
    const createAdapter = vi.fn(() => ({}) as never);
    process.env.ELCONV_WIZARD_AUTH = 'user:application-password';
    try {
      const code = await cmdWizard(
        {
          target: 'v4',
          html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
          'post-id': '42',
          'mcp-url': 'https://mcp.test',
          'auth-env': 'ELCONV_WIZARD_AUTH',
          'state-file': stateFile,
        },
        { createAdapter, runLivePreflight: preflight },
      );

      expect(code).toBe(1);
      expect(createAdapter).toHaveBeenCalledOnce();
      expect(preflight).toHaveBeenCalledOnce();
      const state = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(stateFile, 'utf8'))) as {
        currentPhase: string;
        treePath?: string;
      };
      expect(state.currentPhase).toBe('preflight');
      expect(state.treePath).toBeUndefined();
    } finally {
      delete process.env.ELCONV_WIZARD_AUTH;
      if (existsSync(stateFile)) rmSync(stateFile);
    }
  });

  it('uses injected snapshot and push dependencies in a real deploy', async () => {
    const root = join(tmpdir(), `elconv-wizard-deploy-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    const outputPath = join(root, 'tree.json');
    const events: string[] = [];
    const snapshot: PageSnapshot = {
      postId: 42,
      timestamp: '2026-08-01T10:00:00.000Z',
      content: [{ id: 'existing' }],
    };
    const pushResult: WpPushResult = {
      postId: 42,
      permalink: 'https://example.com/converted',
      created: false,
      dryRun: false,
      target: 'v3',
    };
    process.env.ELCONV_WIZARD_DEPLOY_AUTH = 'user:application-password';
    try {
      const code = await cmdWizard(
        {
          target: 'v3',
          html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
          out: outputPath,
          'post-id': '42',
          'mcp-url': 'https://mcp.test',
          'auth-env': 'ELCONV_WIZARD_DEPLOY_AUTH',
          'state-file': stateFile,
        },
        {
          createAdapter: () => ({}) as never,
          runLivePreflight: async () => ({ passed: true, message: 'live preflight passed' }),
          captureSnapshot: async () => {
            events.push('snapshot');
            return snapshot;
          },
          saveSnapshot: () => {
            events.push('save');
            return join(root, 'snapshot.json');
          },
          pushPage: async () => {
            events.push('push');
            return pushResult;
          },
        },
      );

      expect(code).toBe(0);
      expect(events).toEqual(['snapshot', 'save', 'push']);
    } finally {
      delete process.env.ELCONV_WIZARD_DEPLOY_AUTH;
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an invalid --target in flag mode with exit code 2', async () => {
    const code = await cmdWizard({ target: 'v5', 'no-interactive': true });
    expect(code).toBe(2);
  });
});
