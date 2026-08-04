import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WIZARD_CONTRACT_SCHEMA_ID,
  buildWizardRemoteStateEnvelope,
  validateWizardRemoteStateEnvelope,
} from '@elconv/core';
import {
  bridgeRemoteStateAdapter,
  createMockRemoteStateAdapter,
  createRemoteStateAdapter,
  createUnavailableRemoteStateAdapter,
  type PipelineStateExecutor,
} from '../../../packages/cli/src/remote-state.js';
import { createWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import type { WizardState } from '../../../packages/cli/src/cmd-wizard.js';

/**
 * O-04/O-12 remote pipeline-state mock contract.
 *
 * The wizard's optional remote-state adapter persists a run's state on the
 * server (novamira-adrianv2/pipeline-state). The server-side schema is NOT
 * verified against a real test target yet, so the productive gate must stay
 * closed: unless an adapter is created `verified` with an injected executor,
 * every operation reports `unavailable` and the executor is never invoked.
 * These tests freeze that contract, the save/load/resume interface, the
 * self-describing state envelope ($schema → wizard-contract.schema.json) and
 * the error paths — all fully offline.
 */

function sampleState(): WizardState {
  return createWizardState({
    target: 'v3',
    html: './page.html',
    viewports: [1280, 390],
    strictness: 'pixel-perfect',
    animations: 'gsap',
    fonts: 'system',
    remoteStateKey: 'run-1',
  });
}

describe('unavailable gate — no remote write before schema verification', () => {
  it('a not-verified adapter reports unavailable on every operation', async () => {
    const adapter = createRemoteStateAdapter({
      name: 'novamira-mcp',
      status: { verified: false, reason: 'pipeline-state schema not verified against a live target' },
    });
    expect(adapter.status).toEqual({
      verified: false,
      reason: 'pipeline-state schema not verified against a live target',
    });

    const save = await adapter.save('run-1', sampleState());
    expect(save).toMatchObject({ ok: false, unavailable: true });
    if (!save.ok) expect(save.error).toContain('not verified');

    const load = await adapter.load('run-1');
    expect(load).toMatchObject({ ok: false, unavailable: true });

    const resume = await adapter.resume('run-1');
    expect(resume).toMatchObject({ ok: false, unavailable: true });
  });

  it('never invokes the executor while the gate is closed', async () => {
    const executePipelineState = vi.fn<PipelineStateExecutor>();
    const adapter = createRemoteStateAdapter({
      name: 'novamira-mcp',
      status: { verified: false, reason: 'schema not verified' },
      executePipelineState,
    });
    await adapter.save('run-1', sampleState());
    await adapter.load('run-1');
    await adapter.resume('run-1');
    expect(executePipelineState).not.toHaveBeenCalled();
  });

  it('a verified status without an injected executor is still unavailable', async () => {
    const adapter = createRemoteStateAdapter({
      name: 'novamira-mcp',
      status: { verified: true, verifiedAt: '2026-08-04T00:00:00.000Z', ability: 'novamira-adrianv2/pipeline-state' },
    });
    const save = await adapter.save('run-1', sampleState());
    expect(save).toMatchObject({ ok: false, unavailable: true });
    if (!save.ok) expect(save.error).toContain('executor is not injected');
  });

  it('createUnavailableRemoteStateAdapter exposes the closed gate directly', async () => {
    const adapter = createUnavailableRemoteStateAdapter({
      name: 'novamira-mcp',
      reason: 'no verified remote-state adapter is configured',
    });
    expect(adapter.status.verified).toBe(false);
    const resume = await adapter.resume('run-1');
    expect(resume).toMatchObject({ ok: false, unavailable: true });
  });
});

describe('mock adapter — offline contract harness', () => {
  it('save → load roundtrip preserves the state and pipeline key', async () => {
    const adapter = createMockRemoteStateAdapter();
    const state = sampleState();
    const save = await adapter.save('run-42', state);
    expect(save.ok).toBe(true);
    if (!save.ok) return;

    const load = await adapter.load('run-42');
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.pipelineId).toBe('run-42');
    expect(load.state.target).toBe('v3');
    expect(load.state.strictness).toBe('pixel-perfect');
  });

  it('resume returns the state ready to run with a valid envelope', async () => {
    const adapter = createMockRemoteStateAdapter();
    await adapter.save('run-1', sampleState());
    const resume = await adapter.resume('run-1');
    expect(resume.ok).toBe(true);
    if (!resume.ok) return;
    expect(resume.state.target).toBe('v3');
    expect(resume.envelope.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);
    expect(resume.envelope.schemaVersion).toBe(1);
  });

  it('reports notFound for an unknown key', async () => {
    const adapter = createMockRemoteStateAdapter();
    const load = await adapter.load('missing');
    expect(load).toMatchObject({ ok: false, notFound: true });
  });

  it('is marked verified because it is the offline harness', () => {
    const adapter = createMockRemoteStateAdapter();
    expect(adapter.status.verified).toBe(true);
    expect(adapter.status.ability).toContain('pipeline-state');
  });
});

describe('MCP-backed adapter — verified path with injected executor', () => {
  function verifiedAdapter(executePipelineState: PipelineStateExecutor) {
    return createRemoteStateAdapter({
      name: 'novamira-mcp',
      status: { verified: true, verifiedAt: '2026-08-04T00:00:00.000Z', ability: 'novamira-adrianv2/pipeline-state' },
      executePipelineState,
    });
  }

  it('save wraps the state in the envelope and sends action save', async () => {
    const executePipelineState = vi.fn<PipelineStateExecutor>(async (action, options) => {
      expect(action).toBe('save');
      expect(options.pipelineId).toBe('run-1');
      const envelope = options.state as { $schema?: string; schemaVersion?: number; state?: unknown };
      expect(envelope.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);
      expect(envelope.schemaVersion).toBe(1);
      expect((envelope.state as WizardState).target).toBe('v3');
      return { success: true, pipelineId: 'run-1', timestamp: 't0' };
    });
    const adapter = verifiedAdapter(executePipelineState);

    const save = await adapter.save('run-1', sampleState());
    expect(save.ok).toBe(true);
    if (!save.ok) return;
    expect(save.pipelineId).toBe('run-1');
    expect(executePipelineState).toHaveBeenCalledTimes(1);
  });

  it('load maps the server state and validates the envelope', async () => {
    const state = sampleState();
    const envelope = buildWizardRemoteStateEnvelope({ pipelineId: 'run-1', state });
    const executePipelineState = vi.fn<PipelineStateExecutor>(async (action) => {
      expect(action).toBe('load');
      return { success: true, pipelineId: 'run-1', state: envelope };
    });
    const adapter = verifiedAdapter(executePipelineState);

    const load = await adapter.load('run-1');
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.state.target).toBe('v3');
    expect(load.state.strictness).toBe('pixel-perfect');
  });

  it('resume loads and returns the ready-to-run state', async () => {
    const state = sampleState();
    const envelope = buildWizardRemoteStateEnvelope({ pipelineId: 'run-1', state });
    const adapter = verifiedAdapter(async () => ({ success: true, pipelineId: 'run-1', state: envelope }));

    const resume = await adapter.resume('run-1');
    expect(resume.ok).toBe(true);
    if (!resume.ok) return;
    expect(resume.state.currentPhase).toBe('preflight');
    expect(resume.envelope.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);
  });

  it('reports notFound when the server returns success without state', async () => {
    const adapter = verifiedAdapter(async () => ({ success: true }));
    const load = await adapter.load('run-1');
    expect(load).toMatchObject({ ok: false, notFound: true });
  });

  it('propagates a server-side failure honestly', async () => {
    const adapter = verifiedAdapter(async () => ({ success: false, error: 'store exploded' }));
    const load = await adapter.load('run-1');
    expect(load).toMatchObject({ ok: false });
    if (!load.ok) expect(load.error).toContain('store exploded');
    const save = await adapter.save('run-1', sampleState());
    expect(save).toMatchObject({ ok: false });
  });

  it('rejects an invalid envelope on load (never silently coerces)', async () => {
    const adapter = verifiedAdapter(async () => ({
      success: true,
      pipelineId: 'run-1',
      state: { schemaVersion: 1, state: {} }, // missing $schema
    }));
    const load = await adapter.load('run-1');
    expect(load).toMatchObject({ ok: false });
    if (!load.ok) expect(load.error).toContain('invalid remote state envelope');
  });
});

describe('bridgeRemoteStateAdapter — adapter onto the wizard port contract', () => {
  it('maps adapter results onto the throwing/null port contract', async () => {
    const adapter = createMockRemoteStateAdapter();
    const port = bridgeRemoteStateAdapter(adapter);
    const state = sampleState();

    await port.save('bridge-run', state);
    const loaded = await port.load('bridge-run');
    expect(loaded).not.toBeNull();
    expect(loaded?.target).toBe('v3');
    expect(loaded?.strictness).toBe('pixel-perfect');
  });

  it('maps notFound to null (start fresh) and other failures to thrown errors', async () => {
    const adapter = createMockRemoteStateAdapter();
    const port = bridgeRemoteStateAdapter(adapter);
    expect(await port.load('missing')).toBeNull();

    const unavailable = bridgeRemoteStateAdapter(
      createUnavailableRemoteStateAdapter({ name: 'novamira-mcp', reason: 'pipeline-state schema not verified' }),
    );
    await expect(unavailable.load('k')).rejects.toThrow(/not verified/);
    await expect(unavailable.save('k', sampleState())).rejects.toThrow(/not verified/);
  });
});

describe('remote-state envelope contract', () => {
  it('buildWizardRemoteStateEnvelope references the consolidated schema', () => {
    const envelope = buildWizardRemoteStateEnvelope({
      pipelineId: 'run-1',
      state: { step: 3 },
      savedAt: '2026-08-04T00:00:00.000Z',
    });
    expect(envelope.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.pipelineId).toBe('run-1');
    expect(envelope.state).toEqual({ step: 3 });
  });

  it('defaults savedAt to now when not provided', () => {
    const envelope = buildWizardRemoteStateEnvelope({ pipelineId: 'run-1', state: {} });
    expect(typeof envelope.savedAt).toBe('string');
    expect(Number.isNaN(Date.parse(envelope.savedAt))).toBe(false);
  });

  it('validateWizardRemoteStateEnvelope accepts a conforming payload', () => {
    const envelope = buildWizardRemoteStateEnvelope({ pipelineId: 'run-1', state: { a: 1 } });
    const result = validateWizardRemoteStateEnvelope(envelope);
    expect(result.ok).toBe(true);
  });

  it('rejects a wrong $schema reference and wrong machine gate', () => {
    const badSchema = validateWizardRemoteStateEnvelope({
      ...buildWizardRemoteStateEnvelope({ pipelineId: 'run-1', state: {} }),
      $schema: 'elconv/wizard-contract/v9',
    });
    expect(badSchema.ok).toBe(false);
    if (!badSchema.ok) expect(badSchema.errors.join(' ')).toContain('$schema');

    const badVersion = validateWizardRemoteStateEnvelope({
      ...buildWizardRemoteStateEnvelope({ pipelineId: 'run-1', state: {} }),
      schemaVersion: 2,
    });
    expect(badVersion.ok).toBe(false);
    if (!badVersion.ok) expect(badVersion.errors.join(' ')).toContain('schemaVersion');
  });

  it('rejects a missing pipelineId, savedAt or state', () => {
    const envelope = buildWizardRemoteStateEnvelope({ pipelineId: 'run-1', state: {} }) as Record<string, unknown>;
    for (const key of ['pipelineId', 'savedAt', 'state']) {
      const copy = { ...envelope };
      delete copy[key];
      const result = validateWizardRemoteStateEnvelope(copy);
      expect(result.ok, `missing ${key}`).toBe(false);
    }
  });

  it('the envelope schema reference matches the committed wizard-contract schema (drift guard)', () => {
    const committed = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../../schemas/wizard-contract.schema.json'), 'utf8'),
    ) as { $id?: string };
    expect(WIZARD_CONTRACT_SCHEMA_ID).toBe(committed.$id);
    expect(buildWizardRemoteStateEnvelope({ pipelineId: 'x', state: {} }).$schema).toBe(committed.$id);
  });
});
