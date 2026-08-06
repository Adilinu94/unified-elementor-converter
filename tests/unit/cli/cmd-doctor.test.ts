import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import {
  cmdDoctor,
  syncAbilities,
  buildAbilitySyncReport,
  verifyLargeDeploy,
} from '../../../packages/cli/src/cmd-doctor.js';
import { createWizardState, saveWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import { KNOWN_ABILITIES } from '@elconv/mcp';
import {
  buildWizardContract,
  stateFileForContractPath,
  wizardContractPathFor,
} from '../../../packages/cli/src/wizard-contract.js';

/**
 * elconv doctor --wizard-contract <state-file> — standalone check of the
 * machine-readable wizard contract next to a state file, without resuming the
 * wizard. Mirrors the resume-path wiring (`reportWizardContractOnResume`) but
 * as a doctor check with exit codes: 0 valid/migrated, 1 invalid/missing,
 * 2 usage. `--json` emits the machine-readable report.
 */

function tmpRoot(): string {
  return join(tmpdir(), `elconv-doctor-contract-${Math.random().toString(36).slice(2)}`);
}

function contractState(target: 'v3' | 'v4' = 'v3', root: string) {
  const state = createWizardState({
    target,
    html: './page.html',
    out: join(root, 'tree.json'),
    strictness: 'pixel-perfect',
    animations: 'css',
    fonts: 'system',
  });
  state.currentPhase = 'done';
  state.completedPhases = ['preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done'];
  return state;
}

function writeContractFor(stateFile: string, contract: unknown): void {
  writeFileSync(wizardContractPathFor(stateFile), JSON.stringify(contract, null, 2), 'utf8');
}

function finishedContract(root: string, target: 'v3' | 'v4' = 'v3') {
  return buildWizardContract(contractState(target, root), {
    phaseStatus: { done: 'ok' },
    exitCode: 0,
    remoteStateConfigured: false,
  });
}

function writeStateFile(stateFile: string, state: Record<string, unknown>): void {
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function finishedStateFields(): Record<string, unknown> {
  return {
    target: 'v3',
    currentPhase: 'done',
    completedPhases: ['preflight', 'extract', 'build', 'validate', 'deploy', 'qa'],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('cmdDoctor — --wizard-contract check', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stdoutCalls(): string {
    return vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
  }

  it('confirms a current-format contract as valid with exit code 0', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const contract = buildWizardContract(contractState('v3', root), {
        phaseStatus: { done: 'ok' },
        exitCode: 0,
        remoteStateConfigured: false,
      });
      writeContractFor(stateFile, contract);

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(0);
      const out = stdoutCalls();
      expect(out).toContain('valid');
      expect(out).toContain('elconv/wizard-contract/v1');
      expect(out).toContain('schemaVersion 1');
      expect(out).toContain('Target: V3');
      expect(out).toContain('Phases:');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('soft-migrates a pre-O-12 contract (missing $schema) and reports it as migrated', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const contract = buildWizardContract(contractState('v4', root), {
        phaseStatus: { done: 'ok' },
        exitCode: 0,
        remoteStateConfigured: false,
      }) as unknown as Record<string, unknown> & { $schema?: string };
      delete contract.$schema;
      writeContractFor(stateFile, contract);

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(0);
      const out = stdoutCalls();
      expect(out).toContain('migrated from pre-O-12');
      expect(out).toContain('change(s) applied');
      expect(out).toContain('Target: V4');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an invalid contract with exit code 1', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      writeContractFor(stateFile, { schemaVersion: 9 }); // unsupported machine gate
      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain('invalid');
      expect(stdoutCalls()).toContain('Result: FAIL');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a missing contract with exit code 1', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain('invalid');
      expect(stdoutCalls()).toContain('Cannot read');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns exit code 2 when --wizard-contract is passed without a value', async () => {
    const code = await cmdDoctor({ 'wizard-contract': true });
    expect(code).toBe(2);
    expect(vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join('')).toContain(
      'requires a wizard state-file path',
    );
  });

  it('emits a machine-readable JSON report with --json', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const contract = buildWizardContract(contractState('v3', root), {
        phaseStatus: { done: 'ok' },
        exitCode: 0,
        remoteStateConfigured: true,
        remoteStateReason: 'verified mock adapter (offline)',
      });
      (contract.phases[0] as { error?: string }).error = 'preflight failed'; // diagnostic passthrough
      writeContractFor(stateFile, contract);

      const code = await cmdDoctor({ 'wizard-contract': stateFile, json: true });
      expect(code).toBe(0);
      const parsed = JSON.parse(stdoutCalls()) as {
        ok: boolean;
        contractPath: string;
        migrated: boolean;
        errors: string[];
        contractSummary?: {
          exitCode: number | null;
          remoteState: { configured: boolean };
          phases: { name: string; status: string; error?: string }[];
        };
        stateCheck?: { stateFileReadable: boolean; consistent: boolean };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.migrated).toBe(false);
      expect(parsed.errors).toEqual([]);
      expect(parsed.contractPath.endsWith('state.json.contract.json')).toBe(true);
      expect(parsed.contractSummary?.exitCode).toBe(0);
      expect(parsed.contractSummary?.remoteState.configured).toBe(true);
      expect(parsed.contractSummary?.phases[0].error).toBe('preflight failed');
      // No state file was written → the consistency check is omitted, not failed.
      expect(parsed.stateCheck).toBeUndefined();
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('cmdDoctor — --wizard-contract state/contract consistency', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stdoutCalls(): string {
    return vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
  }

  it('reports a finished state/contract pair as consistent (exit 0)', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const state = contractState('v3', root);
      state.currentPhase = 'done';
      state.completedPhases = ['preflight', 'extract', 'build', 'validate', 'deploy', 'qa'];
      saveWizardState(state, stateFile); // state first, contract after (wizard order)
      writeContractFor(stateFile, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(0);
      const out = stdoutCalls();
      expect(out).toContain('consistent with contract');
      expect(out).toContain('Result: PASS');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags a state still in progress against a finished contract (exit 1)', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const state = contractState('v3', root);
      state.currentPhase = 'build';
      saveWizardState(state, stateFile);
      writeContractFor(stateFile, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain("still at phase 'build'");
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags a contract that is older than the state file (stale contract, exit 1)', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      // The state claims an update 60s in the future of the contract write.
      writeStateFile(stateFile, {
        ...finishedStateFields(),
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      });
      writeContractFor(stateFile, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain('was updated');
      expect(stdoutCalls()).toContain('after the contract was written');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags a contract marking a phase ok that the state has not completed (exit 1)', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      writeStateFile(stateFile, {
        ...finishedStateFields(),
        completedPhases: ['preflight', 'extract', 'validate', 'deploy', 'qa'], // 'build' missing
      });
      writeContractFor(stateFile, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain('not in the state');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags a state target that disagrees with the contract (exit 1)', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      writeStateFile(stateFile, { ...finishedStateFields(), target: 'v4' });
      writeContractFor(stateFile, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain("does not match contract target 'v3'");
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('discovers and checks all state/contract pairs in a directory (auto mode)', async () => {
    const root = tmpRoot();
    const pairA = join(root, 'run-a', 'state.json');
    const pairB = join(root, 'run-b', 'state.json');
    mkdirSync(join(root, 'run-a'), { recursive: true });
    mkdirSync(join(root, 'run-b'), { recursive: true });
    try {
      // Pair A: consistent finished run.
      writeStateFile(pairA, finishedStateFields());
      writeContractFor(pairA, finishedContract(root, 'v3'));
      // Pair B: state still in progress against a finished contract.
      writeStateFile(pairB, { ...finishedStateFields(), currentPhase: 'build' });
      writeContractFor(pairB, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contracts': root, json: true });
      expect(code).toBe(1);
      const parsed = JSON.parse(stdoutCalls()) as {
        dir: string;
        errors: string[];
        summary: { total: number; ok: number; failed: number };
        checks: { ok: boolean; stateCheck?: { consistent: boolean } }[];
      };
      expect(parsed.errors).toEqual([]);
      expect(parsed.summary).toEqual({ total: 2, ok: 1, failed: 1 });
      expect(parsed.checks).toHaveLength(2);
      expect(parsed.checks.filter((c) => c.ok)).toHaveLength(1);
      expect(parsed.checks.find((c) => !c.ok)?.stateCheck?.consistent).toBe(false);
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns exit 0 when every discovered pair is consistent', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      writeStateFile(stateFile, finishedStateFields());
      writeContractFor(stateFile, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contracts': root });
      expect(code).toBe(0);
      const out = stdoutCalls();
      expect(out).toContain('1 pair(s)');
      expect(out).toContain('1 PASS');
      expect(out).toContain('state consistent');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('recursively discovers pairs in nested directories', async () => {
    const root = tmpRoot();
    const nested = join(root, 'deep', 'deeper');
    const stateFile = join(nested, 'state.json');
    mkdirSync(nested, { recursive: true });
    try {
      writeStateFile(stateFile, finishedStateFields());
      writeContractFor(stateFile, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contracts': root, json: true });
      expect(code).toBe(0);
      const parsed = JSON.parse(stdoutCalls()) as { summary: { total: number; ok: number; failed: number } };
      expect(parsed.summary).toEqual({ total: 1, ok: 1, failed: 0 });
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails an empty directory scan (no pairs found)', async () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    try {
      const code = await cmdDoctor({ 'wizard-contracts': root });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain('no wizard contract pairs found');
      expect(stdoutCalls()).toContain('0 pair(s)');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a missing directory in the JSON report with exit 1', async () => {
    const missing = join(tmpRoot(), 'does-not-exist');
    const code = await cmdDoctor({ 'wizard-contracts': missing, json: true });
    expect(code).toBe(1);
    const parsed = JSON.parse(stdoutCalls()) as { errors: string[]; summary: { total: number } };
    expect(parsed.errors[0]).toContain('Directory not found');
    expect(parsed.summary.total).toBe(0);
  });

  it('finds an orphan default state file without a contract and reports its missing contract', async () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    try {
      writeStateFile(join(root, '.elconv-wizard-state.json'), finishedStateFields());

      const code = await cmdDoctor({ 'wizard-contracts': root, json: true });
      expect(code).toBe(1);
      const parsed = JSON.parse(stdoutCalls()) as {
        summary: { total: number; ok: number; failed: number };
        checks: { ok: boolean; errors: string[] }[];
      };
      expect(parsed.summary).toEqual({ total: 1, ok: 0, failed: 1 });
      expect(parsed.checks[0].ok).toBe(false);
      expect(parsed.checks[0].errors[0]).toContain('Cannot read wizard contract');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the contract naming scheme in one place (wizardContractPathFor inverse)', () => {
    const state = 'some/run/state.json';
    const contract = wizardContractPathFor(state);
    expect(stateFileForContractPath(contract)).toBe(state);
    expect(contract.endsWith('.contract.json')).toBe(true);
  });

  it('returns exit 2 when --wizard-contracts is passed without a value', async () => {
    const code = await cmdDoctor({ 'wizard-contracts': true });
    expect(code).toBe(2);
    expect(vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join('')).toContain(
      'requires a directory path',
    );
  });

  it('emits the consistency result in the JSON report', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      writeStateFile(stateFile, finishedStateFields());
      writeContractFor(stateFile, finishedContract(root, 'v3'));

      const code = await cmdDoctor({ 'wizard-contract': stateFile, json: true });
      expect(code).toBe(0);
      const parsed = JSON.parse(stdoutCalls()) as {
        ok: boolean;
        stateCheck?: {
          stateFileReadable: boolean;
          stateValidJson: boolean;
          consistent: boolean;
          issues: string[];
          state?: { currentPhase?: string };
          stateContractDeltaSeconds?: number;
        };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.stateCheck?.stateFileReadable).toBe(true);
      expect(parsed.stateCheck?.stateValidJson).toBe(true);
      expect(parsed.stateCheck?.consistent).toBe(true);
      expect(parsed.stateCheck?.issues).toEqual([]);
      expect(parsed.stateCheck?.state?.currentPhase).toBe('done');
      expect(typeof parsed.stateCheck?.stateContractDeltaSeconds).toBe('number');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('cmdDoctor — --sync-abilities --json (machine-readable drift)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ELCONV_SYNC_AUTH;
  });

  function stdoutJson(): unknown {
    const out = vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
    return JSON.parse(out);
  }

  async function syncWith(live: string[]) {
    const listAbilities = vi.fn(async () => live);
    process.env.ELCONV_SYNC_AUTH = 'user:application-password';
    const code = await syncAbilities(
      {
        'sync-abilities': true,
        json: true,
        'mcp-url': 'https://mcp.test',
        'auth-env': 'ELCONV_SYNC_AUTH',
      },
      { listAbilities },
    );
    expect(listAbilities).toHaveBeenCalledTimes(1);
    return code;
  }

  it('returns exit 2 without credentials (no network)', async () => {
    const code = await syncAbilities({ 'sync-abilities': true, json: true });
    expect(code).toBe(2);
    expect(vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join('')).toContain(
      '--sync-abilities needs either',
    );
  });

  it('emits an in-sync report with exit 0 when the live list matches the registry', async () => {
    const code = await syncWith([...KNOWN_ABILITIES]);
    expect(code).toBe(0);
    const parsed = stdoutJson() as {
      ok: boolean;
      inSync: boolean;
      liveCount: number;
      snapshotCount: number;
      addedOnServer: string[];
      removedFromServer: string[];
      nowAvailable: string[];
      authMode: string;
      targetName?: string;
      timestamp: string;
      exitCode: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.inSync).toBe(true);
    expect(parsed.liveCount).toBe(KNOWN_ABILITIES.length);
    expect(parsed.snapshotCount).toBe(KNOWN_ABILITIES.length);
    expect(parsed.addedOnServer).toEqual([]);
    expect(parsed.removedFromServer).toEqual([]);
    expect(parsed.nowAvailable).toEqual([]);
    expect(parsed.authMode).toBe('mcp-url-auth-env');
    expect(parsed.targetName).toBeUndefined();
    expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false);
    expect(parsed.exitCode).toBe(0);
  });

  it('reports added abilities as drift with exit 1', async () => {
    const code = await syncWith([...KNOWN_ABILITIES, 'novamira-adrianv2/brand-new-thing']);
    expect(code).toBe(1);
    const parsed = stdoutJson() as { ok: boolean; inSync: boolean; addedOnServer: string[]; exitCode: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.inSync).toBe(false);
    expect(parsed.addedOnServer).toContain('novamira-adrianv2/brand-new-thing');
    expect(parsed.exitCode).toBe(1);
  });

  it('reports removed abilities as drift with exit 1', async () => {
    const reduced = KNOWN_ABILITIES.filter((n) => n !== 'novamira/execute-php');
    const code = await syncWith(reduced);
    expect(code).toBe(1);
    const parsed = stdoutJson() as { ok: boolean; removedFromServer: string[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.removedFromServer).toContain('novamira/execute-php');
  });

  it('reports a previously-unavailable ability that is now live', async () => {
    const code = await syncWith([...KNOWN_ABILITIES, 'novamira/version']);
    expect(code).toBe(1);
    const parsed = stdoutJson() as { ok: boolean; nowAvailable: string[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.nowAvailable).toContain('novamira/version');
  });

  it('emits an error report with exit 1 when the live discovery fails', async () => {
    process.env.ELCONV_SYNC_AUTH = 'user:application-password';
    const code = await syncAbilities(
      { 'sync-abilities': true, json: true, 'mcp-url': 'https://mcp.test', 'auth-env': 'ELCONV_SYNC_AUTH' },
      { listAbilities: async () => { throw new Error('connection refused'); } },
    );
    expect(code).toBe(1);
    const parsed = stdoutJson() as { ok: boolean; error: string; exitCode: number };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('discover-abilities failed');
    expect(parsed.error).toContain('connection refused');
    expect(parsed.exitCode).toBe(1);
  });

  it('keeps the human sync output readable from the report (regression)', async () => {
    process.env.ELCONV_SYNC_AUTH = 'user:application-password';
    const code = await syncAbilities(
      {
        'sync-abilities': true,
        'mcp-url': 'https://mcp.test',
        'auth-env': 'ELCONV_SYNC_AUTH',
      },
      { listAbilities: async () => [...KNOWN_ABILITIES, 'novamira-adrianv2/brand-new-thing'] },
    );
    expect(code).toBe(1);
    const out = vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('New on server (add to KNOWN_ABILITIES)');
    expect(out).toContain('novamira-adrianv2/brand-new-thing');
    expect(out).not.toContain('{'); // no JSON in human mode
  });

  it('buildAbilitySyncReport carries target-name metadata (pure, offline)', () => {
    const report = buildAbilitySyncReport([...KNOWN_ABILITIES], {
      authMode: 'target-name',
      targetName: 'prod',
      timestamp: '2026-08-04T00:00:00.000Z',
    });
    expect(report.ok).toBe(true);
    expect(report.inSync).toBe(true);
    expect(report.authMode).toBe('target-name');
    expect(report.targetName).toBe('prod');
    expect(report.timestamp).toBe('2026-08-04T00:00:00.000Z');
    expect(report.exitCode).toBe(0);
  });
});

describe('cmdDoctor — --verify-large-deploy (offline schema verification)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ELCONV_SYNC_AUTH;
  });

  function stdoutCalls(): string {
    return vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
  }

  /** Live-schema fixtures matching the frozen contract (mode replace/append + tree-chunk). */
  function matchingPayloads(): Map<string, unknown> {
    return new Map([
      [
        'novamira-adrianv2/elementor-inject-calibrated-page',
        {
          input_schema: {
            properties: {
              post_id: { type: 'integer' },
              _elementor_data: { type: 'array' },
              elementor_version: { type: 'string' },
              wp_page_template: { type: 'string' },
              transaction_id: { type: 'string' },
              mode: { type: 'string', enum: ['replace', 'append'] },
            },
          },
        },
      ],
      [
        'novamira-adrianv2/batch-build-page',
        {
          input_schema: {
            properties: {
              post_id: { type: 'integer' },
              elements: { type: 'array' },
              transaction_id: { type: 'string' },
              mode: { type: 'string', enum: ['replace', 'append'] },
            },
          },
        },
      ],
      [
        'novamira/elementor-get-content',
        { input_schema: { properties: { post_id: { type: 'integer' }, full_dump: { type: 'boolean' } } } },
      ],
      [
        'novamira/elementor-clear-document-cache',
        { input_schema: { properties: { post_ids: { type: 'array' } } } },
      ],
      [
        'novamira-adrianv2/elementor-tree-chunk-start',
        {
          input_schema: {
            properties: {
              post_id: { type: 'integer' },
              mode: { type: 'string', enum: ['overwrite', 'merge_by_id'] },
              wp_page_template: { type: 'string' },
              elementor_version: { type: 'string' },
            },
          },
        },
      ],
      [
        'novamira-adrianv2/elementor-tree-chunk-append',
        { input_schema: { properties: { session_id: { type: 'string' }, chunk_index: { type: 'integer' }, chunk_data: { type: 'string' } } } },
      ],
      [
        'novamira-adrianv2/elementor-tree-chunk-commit',
        { input_schema: { properties: { session_id: { type: 'string' }, post_id: { type: 'integer' } } } },
      ],
    ]);
  }

  async function verifyWith(payloads: Map<string, unknown>, failingAbility?: string): Promise<number> {
    process.env.ELCONV_SYNC_AUTH = 'user:application-password';
    return verifyLargeDeploy(
      {
        'verify-large-deploy': true,
        json: true,
        'mcp-url': 'https://mcp.test',
        'auth-env': 'ELCONV_SYNC_AUTH',
      },
      {
        getAbilityInfo: async (_adapter, abilityName) => {
          if (failingAbility && abilityName === failingAbility) {
            throw new Error('connection refused');
          }
          const payload = payloads.get(abilityName);
          if (payload === undefined) throw new Error(`no fixture for ${abilityName}`);
          return payload;
        },
      },
    );
  }

  it('returns exit 2 without credentials (no network)', async () => {
    const code = await verifyLargeDeploy({ 'verify-large-deploy': true, json: true });
    expect(code).toBe(2);
    expect(vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join('')).toContain(
      '--verify-large-deploy needs either',
    );
  });

  it('emits a verified JSON report with exit 0 when all four live schemas match', async () => {
    const code = await verifyWith(matchingPayloads());
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutCalls()) as {
      ok: boolean;
      requiresLiveRoundtrip: boolean;
      strategies: string[];
      exitCode: number;
      authMode: string;
      targetName?: string;
      checks: { ability: string; matches: boolean; status: string }[];
      issues: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.requiresLiveRoundtrip).toBe(true);
    expect(parsed.strategies).toEqual(['upload-php', 'split']);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.authMode).toBe('mcp-url-auth-env');
    expect(parsed.targetName).toBeUndefined();
    expect(parsed.checks).toHaveLength(7);
    expect(parsed.checks.every((c) => c.matches && c.status === 'checked')).toBe(true);
    expect(parsed.issues).toEqual([]);
  });

  it('reports an unavailable ability with exit 1 while the rest stay checked', async () => {
    const code = await verifyWith(matchingPayloads(), 'novamira/elementor-get-content');
    expect(code).toBe(1);
    const parsed = JSON.parse(stdoutCalls()) as {
      ok: boolean;
      exitCode: number;
      checks: { ability: string; status: string; error?: string }[];
      issues: string[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.exitCode).toBe(1);
    const unavailable = parsed.checks.find((c) => c.ability === 'novamira/elementor-get-content');
    expect(unavailable?.status).toBe('unavailable');
    expect(unavailable?.error).toContain('connection refused');
    expect(parsed.checks.filter((c) => c.status === 'checked')).toHaveLength(6);
    expect(parsed.issues.some((i) => i.includes('get-ability-info'))).toBe(true);
  });

  it('keeps the human output readable and JSON-free (regression)', async () => {
    process.env.ELCONV_SYNC_AUTH = 'user:application-password';
    const payloads = matchingPayloads();
    payloads.set('novamira-adrianv2/batch-build-page', {
      input_schema: {
        properties: {
          post_id: { type: 'integer' },
          elements: { type: 'array' },
          transaction_id: { type: 'string' },
          mode: { type: 'string', enum: ['replace'] },
        },
      },
    });
    const code = await verifyLargeDeploy(
      {
        'verify-large-deploy': true,
        'mcp-url': 'https://mcp.test',
        'auth-env': 'ELCONV_SYNC_AUTH',
      },
      {
        getAbilityInfo: async (_adapter, abilityName) => {
          const payload = payloads.get(abilityName);
          if (payload === undefined) throw new Error(`no fixture for ${abilityName}`);
          return payload;
        },
      },
    );
    expect(code).toBe(1);
    const out = stdoutCalls();
    expect(out).toContain('large-deploy schema verification');
    expect(out).toContain('contract not verified');
    expect(out).toContain("lacks 'replace' or 'append'");
    expect(out).toContain('Productive gate: CLOSED');
    expect(out).toContain('Result: NOT VERIFIED');
    expect(out).not.toContain('{'); // no JSON in human mode
  });
});
