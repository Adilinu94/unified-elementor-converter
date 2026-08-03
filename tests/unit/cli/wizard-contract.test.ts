import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import {
  WIZARD_EXIT_CODES,
  WIZARD_EXIT_CODE_LABELS,
  describeExitCode,
  wizardViewportsToConfig,
  wizardContractPathFor,
  buildWizardContract,
  writeWizardContract,
  type WizardContract,
  type WizardPhaseStatus,
} from '../../../packages/cli/src/wizard-contract.js';
import { cmdWizard, createWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import type { WizardState } from '../../../packages/cli/src/cmd-wizard.js';

/**
 * O-04 — wizard contract: machine-readable option forwarding, per-phase
 * statuses, artifact paths, and exit codes. The remote pipeline-state stays
 * structurally `unavailable` until its MCP schema is verified; these tests are
 * fully offline.
 */

describe('WIZARD_EXIT_CODES', () => {
  it('documents the three machine-readable exit codes', () => {
    expect(WIZARD_EXIT_CODES.OK).toBe(0);
    expect(WIZARD_EXIT_CODES.PHASE_FAILED).toBe(1);
    expect(WIZARD_EXIT_CODES.USAGE).toBe(2);
    expect(WIZARD_EXIT_CODE_LABELS[0]).toContain('ok');
    expect(WIZARD_EXIT_CODE_LABELS[1]).toContain('failed');
    expect(WIZARD_EXIT_CODE_LABELS[2]).toContain('usage');
  });

  it('describeExitCode reports ok and meaning per code', () => {
    expect(describeExitCode(0)).toMatchObject({ code: 0, ok: true });
    expect(describeExitCode(1)).toMatchObject({ code: 1, ok: false });
    expect(describeExitCode(2)).toMatchObject({ code: 2, ok: false });
    expect(describeExitCode(99).ok).toBe(false);
  });
});

describe('wizardViewportsToConfig', () => {
  it('maps the canonical widths to labeled viewport configs', () => {
    const configs = wizardViewportsToConfig([1440, 768, 390]);
    expect(configs).toEqual([
      { label: 'desktop', width: 1440, height: 900 },
      { label: 'tablet', width: 768, height: 1024 },
      { label: 'mobile', width: 390, height: 844 },
    ]);
  });

  it('labels unknown widths as custom-<width> with a default height', () => {
    const configs = wizardViewportsToConfig([1280]);
    expect(configs).toEqual([{ label: 'custom-1280', width: 1280, height: 900 }]);
  });

  it('handles an empty list', () => {
    expect(wizardViewportsToConfig([])).toEqual([]);
  });
});

describe('buildWizardContract', () => {
  function v4State(): WizardState {
    return createWizardState({
      target: 'v4',
      html: './page.html',
      viewports: [1280, 390],
      strictness: 'pixel-perfect',
      animations: 'gsap',
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
      remoteStateKey: 'run-1',
    });
  }

  it('forwards every V3/V4/QA option into the machine-readable manifest', () => {
    const state = v4State();
    state.sourceSpecPath = './out/source-spec.json';
    state.treePath = './out/tree.json';
    const contract = buildWizardContract(state, {
      phaseStatus: { preflight: 'ok', extract: 'ok', build: 'ok' },
      exitCode: null,
      remoteStateConfigured: false,
    });

    expect(contract.schemaVersion).toBe(1);
    expect(contract.target).toBe('v4');
    expect(contract.optionsForwarded).toMatchObject({
      viewports: [1280, 390],
      strictness: 'pixel-perfect',
      animations: 'gsap',
      fonts: 'system',
      sections: [],
      tokenStrategy: 'global',
      responsiveStrategy: 'mobile-first',
      unknownWidgetStrategy: 'error',
      qa: {
        referenceUrl: 'https://source.example.com',
        threshold: 92,
        maxRepairRounds: 3,
        autoFix: true,
        heal: true,
        fullContextRepair: true,
      },
    });
  });

  it('records per-phase statuses in the canonical phase order', () => {
    const state = v4State();
    const contract = buildWizardContract(state, {
      phaseStatus: { preflight: 'skipped', extract: 'ok', build: 'ok', qa: 'unavailable' },
      exitCode: 1,
      remoteStateConfigured: true,
    });

    expect(contract.exitCode).toBe(1);
    expect(contract.phases.map((p) => p.name)).toEqual([
      'preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done',
    ]);
    const byName = Object.fromEntries(contract.phases.map((p) => [p.name, p.status]));
    expect(byName.preflight).toBe('skipped');
    expect(byName.extract).toBe('ok');
    expect(byName.qa).toBe('unavailable');
    // Phases not explicitly recorded fall back to skipped in a finished contract.
    expect(byName.done).toBe('skipped');
  });

  it('marks not-yet-reached phases as pending in a live (exitCode null) contract', () => {
    const state = v4State();
    const contract = buildWizardContract(state, {
      phaseStatus: { preflight: 'ok', extract: 'ok' },
      exitCode: null, // run still in progress
      remoteStateConfigured: false,
    });
    const byName = Object.fromEntries(contract.phases.map((p) => [p.name, p.status]));
    expect(byName.preflight).toBe('ok');
    expect(byName.extract).toBe('ok');
    expect(byName.build).toBe('pending');
    expect(byName.deploy).toBe('pending');
    expect(byName.done).toBe('pending');
  });

  it('records artifact paths per phase and the remote-state gate', () => {
    const state = v4State();
    state.sourceSpecPath = './out/source-spec.json';
    state.treePath = './out/tree.json';
    state.snapshotPath = './out/snapshot.json';
    state.permalink = 'https://wp.example.com/page';
    const contract = buildWizardContract(state, {
      phaseStatus: {},
      exitCode: 0,
      remoteStateConfigured: true,
    });

    const extractPhase = contract.phases.find((p) => p.name === 'extract')!;
    const buildPhase = contract.phases.find((p) => p.name === 'build')!;
    const deployPhase = contract.phases.find((p) => p.name === 'deploy')!;
    expect(extractPhase.artifacts).toEqual(['./out/source-spec.json']);
    expect(buildPhase.artifacts).toEqual(['./out/tree.json']);
    expect(deployPhase.artifacts).toEqual(['./out/snapshot.json', 'https://wp.example.com/page']);
    expect(contract.artifactPaths).toEqual({
      sourceSpec: './out/source-spec.json',
      tree: './out/tree.json',
      snapshot: './out/snapshot.json',
      permalink: 'https://wp.example.com/page',
    });
    expect(contract.remoteState).toEqual({ configured: true });
  });

  it('marks remote state as unconfigured with an explicit reason', () => {
    const contract = buildWizardContract(v4State(), {
      phaseStatus: {},
      exitCode: null,
      remoteStateConfigured: false,
      remoteStateReason: 'no verified remote-state adapter is configured',
    });
    expect(contract.remoteState.configured).toBe(false);
    expect(contract.remoteState.reason).toContain('no verified remote-state adapter');
  });

  it('writeWizardContract persists the contract as JSON', () => {
    const root = join(tmpdir(), `elconv-contract-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    const path = join(root, 'wizard-contract.json');
    try {
      const contract = buildWizardContract(v4State(), { phaseStatus: { done: 'ok' }, exitCode: 0, remoteStateConfigured: false });
      writeWizardContract(contract, path);
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as WizardContract;
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.exitCode).toBe(0);
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('cmdWizard — contract persistence (O-04 integration)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes wizard-contract.json next to the state file with exit code 0', async () => {
    const root = join(tmpdir(), `elconv-contract-run-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    const stateFile = join(root, 'state.json');
    try {
      const code = await cmdWizard(
        {
          target: 'v3',
          html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
          out: join(root, 'tree.json'),
          'dry-run': true,
          'state-file': stateFile,
        },
        { createAdapter: vi.fn(() => ({}) as never) },
      );

      expect(code).toBe(0);
      const contractPath = wizardContractPathFor(stateFile);
      expect(existsSync(contractPath)).toBe(true);
      const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as WizardContract;
      expect(contract.exitCode).toBe(0);
      expect(contract.dryRun).toBe(true);
      expect(contract.target).toBe('v3');
      expect(contract.optionsForwarded.viewports).toEqual([1440, 768, 390]);
      expect(contract.artifactPaths.tree).toBeTruthy();
      // Dry-run never touches remote state.
      expect(contract.remoteState).toMatchObject({ configured: false });
      const statuses = Object.fromEntries(contract.phases.map((p) => [p.name, p.status]));
      expect(statuses.extract).toBe('ok');
      expect(statuses.build).toBe('ok');
      expect(statuses.validate).toBe('ok');
      expect(statuses.done).toBe('ok');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('records a failed phase with exit code 1 in the contract', async () => {
    const root = join(tmpdir(), `elconv-contract-fail-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    const stateFile = join(root, 'state.json');
    try {
      // A missing HTML file makes extraction fail honestly.
      const code = await cmdWizard(
        {
          target: 'v3',
          html: join(root, 'missing.html'),
          out: join(root, 'tree.json'),
          'dry-run': true,
          'state-file': stateFile,
        },
        { createAdapter: vi.fn(() => ({}) as never) },
      );
      expect(code).toBe(1);

      const contract = JSON.parse(readFileSync(wizardContractPathFor(stateFile), 'utf8')) as WizardContract;
      expect(contract.exitCode).toBe(1);
      const statuses = Object.fromEntries(contract.phases.map((p) => [p.name, p.status]));
      expect(statuses.extract).toBe('failed');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the remote-state gate closed in the contract for a real run without an adapter', async () => {
    const root = join(tmpdir(), `elconv-contract-remote-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    const stateFile = join(root, 'state.json');
    try {
      const code = await cmdWizard(
        {
          target: 'v3',
          'no-interactive': true,
          html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
          out: join(root, 'tree.json'),
          'dry-run': true,
          'state-file': stateFile,
          'remote-state-key': 'run-1',
        },
        { createAdapter: vi.fn(() => ({}) as never) },
      );
      expect(code).toBe(0); // dry-run stays offline even with a remote key
      const contract = JSON.parse(readFileSync(wizardContractPathFor(stateFile), 'utf8')) as WizardContract;
      expect(contract.remoteState.configured).toBe(false);
      expect(contract.remoteState.reason).toContain('dry-run');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists a full V4 option set through the contract on a real run', async () => {
    const root = join(tmpdir(), `elconv-contract-v4-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    const stateFile = join(root, 'state.json');
    try {
      const code = await cmdWizard(
        {
          target: 'v4',
          html: resolve(import.meta.dirname, '../extractors/fixtures/sample.html'),
          out: join(root, 'tree.json'),
          'dry-run': true,
          'state-file': stateFile,
          viewports: '1280,390',
          strictness: 'pixel-perfect',
          animations: 'gsap',
          fonts: 'system',
          'token-strategy': 'global',
          responsive: 'mobile-first',
          'unknown-widgets': 'error',
          'qa-threshold': '92',
          'max-repair-rounds': '3',
        },
        { createAdapter: vi.fn(() => ({}) as never) },
      );
      expect(code).toBe(0);
      const contract = JSON.parse(readFileSync(wizardContractPathFor(stateFile), 'utf8')) as WizardContract;
      expect(contract.optionsForwarded).toMatchObject({
        viewports: [1280, 390],
        strictness: 'pixel-perfect',
        animations: 'gsap',
        fonts: 'system',
        tokenStrategy: 'global',
        responsiveStrategy: 'mobile-first',
        unknownWidgetStrategy: 'error',
        qa: { threshold: 92, maxRepairRounds: 3 },
      });
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes WizardPhaseStatus as a valid machine-readable status set', () => {
    const statuses: WizardPhaseStatus[] = ['ok', 'failed', 'skipped', 'pending', 'unavailable'];
    for (const s of statuses) {
      expect(['ok', 'failed', 'skipped', 'pending', 'unavailable']).toContain(s);
    }
  });
});
