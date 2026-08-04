import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { cmdDoctor } from '../../../packages/cli/src/cmd-doctor.js';
import { createWizardState, saveWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import {
  buildWizardContract,
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
