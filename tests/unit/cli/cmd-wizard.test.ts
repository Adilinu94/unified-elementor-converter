import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// Mock the interactive prompt layer so the wizard can be driven headlessly.
// vi.mock is hoisted above the static imports below, so the SUT sees the mock.
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
}));

import { select, input, confirm } from '@inquirer/prompts';
import { cmdWizard, collectWizardOptionsInteractive, createWizardState, saveWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import type { WizardState } from '../../../packages/cli/src/cmd-wizard.js';
import {
  buildWizardContract,
  wizardContractPathFor,
} from '../../../packages/cli/src/wizard-contract.js';
import {
  createMockRemoteStateAdapter,
  createRemoteStateAdapter,
  createUnavailableRemoteStateAdapter,
} from '../../../packages/cli/src/remote-state.js';
import { WIZARD_CONTRACT_SCHEMA_ID } from '@elconv/core';
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

  it('rejects V4-only options for a V3 wizard', async () => {
    const code = await cmdWizard({ target: 'v3', 'no-interactive': true, 'token-strategy': 'global' });
    expect(code).toBe(2);
  });

  it('rejects an invalid bounded wizard flag instead of silently defaulting', async () => {
    const code = await cmdWizard({ target: 'v3', 'no-interactive': true, 'qa-threshold': '101' });
    expect(code).toBe(2);
  });

  it('reports unavailable remote state when no verified adapter is injected', async () => {
    const code = await cmdWizard({ target: 'v3', 'no-interactive': true, 'remote-state-key': 'run-1' });
    expect(code).toBe(2);
  });

  it('keeps an explicit dry-run offline even when a remote key is supplied', async () => {
    const stateFile = join(tmpdir(), `elconv-wizard-dry-remote-${Math.random().toString(36).slice(2)}.json`);
    try {
      const code = await cmdWizard({
        target: 'v3',
        'no-interactive': true,
        html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
        'dry-run': true,
        'remote-state-key': 'run-1',
        'state-file': stateFile,
      });
      expect(code).toBe(0);
    } finally {
      if (existsSync(stateFile)) rmSync(stateFile);
    }
  });

  it('does not load remote state during an explicit dry-run resume', async () => {
    const load = vi.fn(async () => null);
    const code = await cmdWizard(
      { resume: true, 'dry-run': true, 'remote-state-key': 'run-1', 'state-file': join(tmpdir(), `missing-dry-${Math.random().toString(36).slice(2)}.json`) },
      { remoteState: { load, save: vi.fn(async () => undefined) } },
    );
    expect(code).toBe(2);
    expect(load).not.toHaveBeenCalled();
  });

  it('returns a controlled error when remote load fails', async () => {
    const load = vi.fn(async () => { throw new Error('remote unavailable'); });
    const code = await cmdWizard(
      { resume: true, 'state-file': join(tmpdir(), `missing-${Math.random().toString(36).slice(2)}.json`), 'remote-state-key': 'run-1' },
      { remoteState: { load, save: vi.fn(async () => undefined) } },
    );
    expect(code).toBe(2);
  });

  it('forwards the --sections option to the build adapter and scopes the tree', async () => {
    const root = join(tmpdir(), `elconv-wizard-sections-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    const stateFile = join(root, 'state.json');
    const outputPath = join(root, 'tree.json');
    try {
      // Without --sections every extracted section is built → non-empty tree.
      const codeFull = await cmdWizard(
        {
          target: 'v3',
          html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
          out: outputPath,
          'dry-run': true,
          'state-file': stateFile,
        },
        { createAdapter: vi.fn(() => ({}) as never) },
      );
      expect(codeFull).toBe(0);
      const fullTree = JSON.parse(readFileSync(outputPath, 'utf8')) as unknown[];
      expect(fullTree.length).toBeGreaterThan(0);

      // With a --sections selector that matches nothing the build adapter
      // filters the source spec → empty tree (proves the pass-through).
      const stateFileScoped = join(root, 'state-scoped.json');
      const outputScoped = join(root, 'tree-scoped.json');
      const codeScoped = await cmdWizard(
        {
          target: 'v3',
          html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
          out: outputScoped,
          'dry-run': true,
          'state-file': stateFileScoped,
          sections: 'definitely-not-a-section',
        },
        { createAdapter: vi.fn(() => ({}) as never) },
      );
      expect(codeScoped).toBe(0);
      const scopedTree = JSON.parse(readFileSync(outputScoped, 'utf8')) as unknown[];
      expect(scopedTree).toEqual([]);
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists target-relevant options in one unified state shape', () => {
    const state = createWizardState({
      target: 'v4',
      html: './page.html',
      viewports: [1280, 390],
      strictness: 'pixel-perfect',
      animations: 'css',
      fonts: 'system',
      tokenStrategy: 'global',
      responsiveStrategy: 'mobile-first',
      unknownWidgetStrategy: 'error',
      qaReferenceUrl: 'https://source.example.com',
      qaThreshold: 92,
      maxRepairRounds: 3,
      qaAutoFix: true,
      heal: true,
      fullContextRepair: true,
      remoteStateKey: 'run-42',
    });
    expect(state).toMatchObject<Partial<WizardState>>({
      target: 'v4',
      viewports: [1280, 390],
      strictness: 'pixel-perfect',
      animations: 'css',
      fonts: 'system',
      tokenStrategy: 'global',
      responsiveStrategy: 'mobile-first',
      unknownWidgetStrategy: 'error',
      remoteStateKey: 'run-42',
      qa: {
        referenceUrl: 'https://source.example.com',
        threshold: 92,
        maxRepairRounds: 3,
        autoFix: true,
        heal: true,
        fullContextRepair: true,
      },
    });
    const v3State = createWizardState({ target: 'v3', html: './page.html', tokenStrategy: 'global', responsiveStrategy: 'mobile-first', unknownWidgetStrategy: 'error' });
    expect(v3State.tokenStrategy).toBeUndefined();
    expect(v3State.responsiveStrategy).toBeUndefined();
    expect(v3State.unknownWidgetStrategy).toBeUndefined();
  });

  it('rejects a saved state with an invalid target clearly', async () => {
    const stateFile = join(tmpdir(), `elconv-wizard-invalid-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(stateFile, JSON.stringify({ target: 'v5' }));
    try {
      const code = await cmdWizard({ resume: true, 'state-file': stateFile });
      expect(code).toBe(2);
    } finally {
      if (existsSync(stateFile)) rmSync(stateFile);
    }
  });

  it('returns a controlled failure when remote state save fails', async () => {
    const root = join(tmpdir(), `elconv-wizard-save-fail-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    const state = createWizardState({
      target: 'v3',
      html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
      out: join(root, 'tree.json'),
      remoteStateKey: 'run-1',
    });
    saveWizardState(state, stateFile);
    const save = vi.fn(async () => { throw new Error('remote save unavailable'); });
    try {
      const code = await cmdWizard(
        { resume: true, 'state-file': stateFile, 'remote-state-key': 'run-1' },
        { remoteState: { load: vi.fn(async () => null), save } },
      );
      expect(code).toBe(1);
      expect(save).toHaveBeenCalled();
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('loads resume state from an injected remote port without using it during dry-run', async () => {
    const root = join(tmpdir(), `elconv-wizard-remote-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    const remoteState: WizardState = createWizardState({
      target: 'v3',
      html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
      out: join(root, 'tree.json'),
      dryRun: true,
      remoteStateKey: 'remote-run',
    });
    remoteState.currentPhase = 'done';
    const load = vi.fn(async () => remoteState);
    const save = vi.fn(async () => undefined);
    try {
      const code = await cmdWizard(
        { resume: true, 'state-file': stateFile, 'remote-state-key': 'remote-run' },
        { remoteState: { load, save } },
      );
      expect(code).toBe(0);
      expect(load).toHaveBeenCalledWith('remote-run');
      expect(save).not.toHaveBeenCalled();
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('cmdWizard — resume reads, migrates and validates the wizard contract (O-12 productive wiring)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stdoutCalls(): string {
    return vi
      .mocked(process.stdout.write)
      .mock.calls.map((c) => String(c[0]))
      .join('');
  }

  function resumedState(root: string): WizardState {
    const state = createWizardState({
      target: 'v3',
      html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
      out: join(root, 'tree.json'),
      dryRun: true,
    });
    state.currentPhase = 'done'; // resume should not re-run any phase
    return state;
  }

  it('confirms a current-format contract as valid on resume', async () => {
    const root = join(tmpdir(), `elconv-resume-contract-valid-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const state = resumedState(root);
      saveWizardState(state, stateFile);
      // Write the O-12 contract next to the state file (as the wizard does).
      const contract = buildWizardContract(state, {
        phaseStatus: { done: 'ok' },
        exitCode: 0,
        remoteStateConfigured: false,
      });
      writeFileSync(wizardContractPathFor(stateFile), JSON.stringify(contract, null, 2), 'utf8');

      const code = await cmdWizard({ resume: true, 'state-file': stateFile }, { createAdapter: vi.fn(() => ({}) as never) });
      expect(code).toBe(0);
      const out = stdoutCalls();
      expect(out).toContain('wizard-contract');
      expect(out).toContain('valid');
      expect(out).toContain('elconv/wizard-contract/v1');
      expect(out).toContain('schemaVersion 1');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('soft-migrates a pre-O-12 contract (missing $schema) and reports it as migrated', async () => {
    const root = join(tmpdir(), `elconv-resume-contract-migrate-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const state = resumedState(root);
      saveWizardState(state, stateFile);
      // Simulate a pre-O-12 artifact: same shape without the $schema field.
      const contract = buildWizardContract(state, {
        phaseStatus: { done: 'ok' },
        exitCode: 0,
        remoteStateConfigured: false,
      }) as unknown as Record<string, unknown> & { $schema?: string };
      delete contract.$schema;
      writeFileSync(wizardContractPathFor(stateFile), JSON.stringify(contract, null, 2), 'utf8');

      const code = await cmdWizard({ resume: true, 'state-file': stateFile }, { createAdapter: vi.fn(() => ({}) as never) });
      expect(code).toBe(0);
      const out = stdoutCalls();
      expect(out).toContain('migrated from pre-O-12');
      expect(out).toContain('elconv/wizard-contract/v1');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an invalid contract as a warning without blocking the resume', async () => {
    const root = join(tmpdir(), `elconv-resume-contract-invalid-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const state = resumedState(root);
      saveWizardState(state, stateFile);
      writeFileSync(wizardContractPathFor(stateFile), '{ not json', 'utf8');

      const code = await cmdWizard({ resume: true, 'state-file': stateFile }, { createAdapter: vi.fn(() => ({}) as never) });
      expect(code).toBe(0); // the contract is best-effort; the state file decides
      expect(stdoutCalls()).toContain('wizard-contract');
      expect(stdoutCalls()).toContain('invalid');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('stays silent when no contract file exists next to the state file', async () => {
    const root = join(tmpdir(), `elconv-resume-contract-none-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const state = resumedState(root);
      saveWizardState(state, stateFile);

      const code = await cmdWizard({ resume: true, 'state-file': stateFile }, { createAdapter: vi.fn(() => ({}) as never) });
      expect(code).toBe(0);
      expect(stdoutCalls()).not.toContain('wizard-contract');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('cmdWizard — offline remote resume via the bridged mock adapter', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resumes a done run purely from the remote key through the mock adapter (no local state file)', async () => {
    const adapter = createMockRemoteStateAdapter();
    const state = createWizardState({
      target: 'v3',
      html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
      out: join(tmpdir(), `elconv-remote-done-${Math.random().toString(36).slice(2)}/tree.json`),
      dryRun: true,
      remoteStateKey: 'remote-run',
    });
    state.currentPhase = 'done'; // resume should not re-run any phase
    await adapter.save('remote-run', state);
    const loadSpy = vi.spyOn(adapter, 'load');

    const stateFile = join(tmpdir(), `elconv-remote-missing-${Math.random().toString(36).slice(2)}.json`);
    const code = await cmdWizard(
      { resume: true, 'state-file': stateFile, 'remote-state-key': 'remote-run' },
      { remoteState: adapter },
    );

    expect(code).toBe(0);
    expect(loadSpy).toHaveBeenCalledWith('remote-run');
  });

  it('persists phases remotely and resumes from the remote store in a second run (save + envelope + load)', async () => {
    const root = join(tmpdir(), `elconv-remote-e2e-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    const adapter = createMockRemoteStateAdapter();
    try {
      // Run 1: a non-dry-run resume that fails preflight (no source) persists
      // state — including the remote save — before returning 1.
      const failing = createWizardState({
        target: 'v3',
        out: join(root, 'tree.json'),
        dryRun: false,
        remoteStateKey: 'e2e-run',
      });
      failing.currentPhase = 'preflight';
      saveWizardState(failing, stateFile);
      const saveSpy = vi.spyOn(adapter, 'save');
      const code1 = await cmdWizard(
        { resume: true, 'state-file': stateFile, 'remote-state-key': 'e2e-run' },
        { remoteState: adapter },
      );
      expect(code1).toBe(1);
      expect(saveSpy).toHaveBeenCalledWith('e2e-run', expect.objectContaining({ currentPhase: 'preflight' }));
      // The remote payload is the self-describing envelope (adapter contract).
      const resume1 = await adapter.resume('e2e-run');
      expect(resume1.ok).toBe(true);
      if (resume1.ok) expect(resume1.envelope.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);

      // Run 2: no local state file → resume must come from the remote store,
      // through envelope validation inside the adapter's load.
      rmSync(stateFile);
      const loadSpy = vi.spyOn(adapter, 'load');
      const code2 = await cmdWizard(
        { resume: true, 'state-file': stateFile, 'remote-state-key': 'e2e-run' },
        { remoteState: adapter },
      );
      expect(loadSpy).toHaveBeenCalledWith('e2e-run');
      expect(code2).toBe(1); // the resumed run fails preflight again — proves the remote state loaded
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an invalid remote envelope as unavailable instead of coercing it', async () => {
    const adapter = createRemoteStateAdapter({
      name: 'novamira-mcp',
      status: { verified: true, verifiedAt: '2026-08-04T00:00:00.000Z', ability: 'novamira-adrianv2/pipeline-state' },
      // Offline fake executor: no MCP client is ever touched.
      executePipelineState: async () => ({
        success: true,
        pipelineId: 'run-1',
        state: { schemaVersion: 1, state: {} }, // missing $schema → invalid envelope
      }),
    });
    const stateFile = join(tmpdir(), `elconv-remote-invalid-${Math.random().toString(36).slice(2)}.json`);
    const code = await cmdWizard(
      { resume: true, 'state-file': stateFile, 'remote-state-key': 'run-1' },
      { remoteState: adapter },
    );

    expect(code).toBe(2);
    const stderr = vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toContain('invalid remote state envelope');
  });

  it('records an injected-but-unverified adapter as not configured in the contract', async () => {
    const root = join(tmpdir(), `elconv-remote-unverified-${Math.random().toString(36).slice(2)}`);
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const failing = createWizardState({
        target: 'v3',
        out: join(root, 'tree.json'),
        dryRun: false,
        remoteStateKey: 'run-1',
      });
      failing.currentPhase = 'preflight';
      saveWizardState(failing, stateFile);
      const adapter = createUnavailableRemoteStateAdapter({
        name: 'novamira-mcp',
        reason: 'pipeline-state schema not verified against a live target',
      });

      const code = await cmdWizard(
        { resume: true, 'state-file': stateFile, 'remote-state-key': 'run-1' },
        { remoteState: adapter },
      );
      expect(code).toBe(1);

      const contract = JSON.parse(
        readFileSync(wizardContractPathFor(stateFile), 'utf8'),
      ) as { remoteState?: { configured?: boolean; reason?: string } };
      expect(contract.remoteState?.configured).toBe(false);
      expect(contract.remoteState?.reason).toContain('not verified');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });
});
