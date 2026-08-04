/**
 * Remote pipeline-state adapter contract (O-04/O-12 preparation).
 *
 * The wizard can persist its run state on the server (via the
 * `novamira-adrianv2/pipeline-state` MCP ability) so a run can be resumed from
 * any machine. This module defines the adapter contract the wizard will consume
 * and a mock implementation for offline use:
 *
 *  - `WizardRemoteStateAdapter` — the interface: `save` / `load` / `resume`
 *    plus an explicit `status` gate that tells tooling whether the adapter is
 *    verified against a real target.
 *  - `createRemoteStateAdapter()` — the single factory. It enforces the honest
 *    gate structurally: unless `status.verified` is true AND a pipeline-state
 *    executor is injected, every operation reports `unavailable` and the MCP
 *    client is never touched. No code path can execute a remote write before
 *    the server-side pipeline-state schema is verified against a real test
 *    target.
 *  - `createMockRemoteStateAdapter()` — an in-memory store implementing the
 *    exact same contract (envelope-shaped, `$schema`-referenced), so wizard
 *    flows can be exercised offline.
 *
 * State schema reference: every persisted payload is wrapped in
 * `WizardRemoteStateEnvelope` from @elconv/core, which self-describes via
 * `$schema: elconv/wizard-contract/v1` — i.e. it references the consolidated,
 * versioned `schemas/wizard-contract.schema.json` and shares its machine gate
 * (`schemaVersion: 1`). Loading validates the envelope against that contract,
 * so a remote state and the wizard contract live in one versioned family.
 */

import {
  buildWizardRemoteStateEnvelope,
  validateWizardRemoteStateEnvelope,
  type WizardRemoteStateEnvelope,
} from '@elconv/core';
import type { WizardState, WizardRemoteStatePort } from './cmd-wizard.js';

// ============================================================================
// Status gate
// ============================================================================

/**
 * The adapter's verification state. `verified: false` (the current production
 * reality) makes every operation report `unavailable`; the MCP client is only
 * reachable after the pipeline-state schema is verified against a live target.
 */
export type RemoteStateAdapterStatus =
  | { verified: true; verifiedAt: string; ability: string }
  | { verified: false; reason: string };

// ============================================================================
// Operation results
// ============================================================================

export type RemoteStateSaveResult =
  | { ok: true; pipelineId: string; savedAt: string }
  | { ok: false; error: string; unavailable?: boolean };

export type RemoteStateLoadResult =
  | { ok: true; pipelineId: string; state: WizardState }
  | { ok: false; error: string; unavailable?: boolean; notFound?: boolean };

export type RemoteStateResumeResult =
  | { ok: true; state: WizardState; envelope: WizardRemoteStateEnvelope<WizardState> }
  | { ok: false; error: string; unavailable?: boolean; notFound?: boolean };

/**
 * Executor signature compatible with `@elconv/mcp` `pipelineState()` (server-
 * critic.ts): action + pipeline key (+ state for save) → server result. The
 * adapter takes it injected so the contract is testable offline with a fake —
 * exactly like the wizard's `createAdapter` port.
 */
export type PipelineStateExecutor = (
  action: 'save' | 'load',
  options: { pipelineId: string; state?: unknown },
) => Promise<{
  success: boolean;
  pipelineId?: string;
  state?: unknown;
  timestamp?: string;
  error?: string;
}>;

// ============================================================================
// Adapter contract
// ============================================================================

export interface WizardRemoteStateAdapter {
  /** Stable name, e.g. 'novamira-mcp' or 'mock'. */
  readonly name: string;
  /** Explicit verification gate — tooling can read it without probing. */
  readonly status: RemoteStateAdapterStatus;
  /** Persist the run state wrapped in the self-describing envelope. */
  save(key: string, state: WizardState): Promise<RemoteStateSaveResult>;
  /** Load the raw persisted state (envelope validated; not normalized). */
  load(key: string): Promise<RemoteStateLoadResult>;
  /**
   * Load + validate the envelope against the versioned schema and return the
   * state ready to resume. `notFound` distinguishes a missing key from an
   * invalid payload.
   */
  resume(key: string): Promise<RemoteStateResumeResult>;
}

// ============================================================================
// Factory (single entry point — enforces the honest gate)
// ============================================================================

/**
 * Create a remote-state adapter. Unless `status.verified` is true AND an
 * executor is provided, the result is the unavailable adapter: every operation
 * returns `{ ok: false, unavailable: true }` with the reason and the executor
 * is never invoked. This is the structural guarantee that no code path can
 * perform a remote pipeline-state write before the MCP schema is verified
 * against a real test target.
 */
export function createRemoteStateAdapter(options: {
  name: string;
  status: RemoteStateAdapterStatus;
  executePipelineState?: PipelineStateExecutor;
}): WizardRemoteStateAdapter {
  const unavailableReason =
    options.status.verified === false
      ? options.status.reason
      : options.executePipelineState
        ? undefined
        : 'remote pipeline-state executor is not injected';

  if (unavailableReason !== undefined) {
    return createUnavailableRemoteStateAdapter({
      name: options.name,
      reason: unavailableReason,
    });
  }

  // Verified + executor present → real MCP-backed adapter.
  const execute = options.executePipelineState as PipelineStateExecutor;
  const status = options.status as { verified: true; verifiedAt: string; ability: string };

  return {
    name: options.name,
    status,
    async save(key, state): Promise<RemoteStateSaveResult> {
      const envelope = buildWizardRemoteStateEnvelope({ pipelineId: key, state });
      const res = await execute('save', { pipelineId: key, state: envelope });
      if (!res.success) {
        return { ok: false, error: res.error ?? `remote pipeline-state save failed for ${key}` };
      }
      return { ok: true, pipelineId: res.pipelineId ?? key, savedAt: envelope.savedAt };
    },
    async load(key): Promise<RemoteStateLoadResult> {
      const res = await execute('load', { pipelineId: key });
      if (!res.success) {
        return { ok: false, error: res.error ?? `remote pipeline-state load failed for ${key}` };
      }
      if (res.state === undefined) {
        return { ok: false, error: `no remote pipeline state for ${key}`, notFound: true };
      }
      const envelope = validateWizardRemoteStateEnvelope(res.state);
      if (!envelope.ok) {
        return {
          ok: false,
          error: `invalid remote state envelope for ${key}: ${envelope.errors.join('; ')}`,
        };
      }
      return {
        ok: true,
        pipelineId: envelope.value.pipelineId,
        state: envelope.value.state as unknown as WizardState,
      };
    },
    async resume(key): Promise<RemoteStateResumeResult> {
      // load() already validated the envelope against the versioned schema.
      const loaded = await this.load(key);
      if (!loaded.ok) return loaded;
      return {
        ok: true,
        state: loaded.state,
        envelope: buildWizardRemoteStateEnvelope({
          pipelineId: loaded.pipelineId,
          state: loaded.state,
        }) as WizardRemoteStateEnvelope<WizardState>,
      };
    },
    // NOTE: the `WizardState` casts above are envelope-level guarantees only —
    // the envelope validator checks `state` is a JSON object, not the full
    // wizard shape. The consuming wizard runs `normalizeWizardState` (cmd-wizard)
    // on resume; that is what actually guarantees WizardState conformance.
  };
}

/**
 * The unavailable adapter: `status.verified === false` and every operation
 * reports `{ ok: false, unavailable: true }` with the reason. Exported so
 * callers that already know the gate is closed (e.g. the wizard's dependency
 * injection) can construct it directly.
 */
export function createUnavailableRemoteStateAdapter(options: {
  name: string;
  reason: string;
}): WizardRemoteStateAdapter {
  const unavailable = (operation: string) => ({
    ok: false as const,
    error: `${options.reason} (remote pipeline-state ${operation} unavailable)`,
    unavailable: true as const,
  });
  return {
    name: options.name,
    status: { verified: false, reason: options.reason },
    save: async (key, _state) => unavailable(`save ${key}`),
    load: async (key) => unavailable(`load ${key}`),
    resume: async (key) => unavailable(`resume ${key}`),
  };
}

// ============================================================================
// Mock adapter (offline harness)
// ============================================================================

/**
 * In-memory implementation of the full adapter contract for offline tests and
 * wizard injection: envelope-shaped payloads (with the `$schema` reference) and
 * the same result semantics (notFound / invalid-envelope / roundtrip). Marked
 * `verified` because it is the offline contract harness — it never touches the
 * network. A real target verification is a separate, deliberate step.
 */
export function createMockRemoteStateAdapter(): WizardRemoteStateAdapter {
  const store = new Map<string, unknown>();
  const name = 'mock';
  const status: RemoteStateAdapterStatus = {
    verified: true,
    verifiedAt: new Date().toISOString(),
    ability: 'novamira-adrianv2/pipeline-state (mock, offline)',
  };

  return {
    name,
    status,
    async save(key, state): Promise<RemoteStateSaveResult> {
      const envelope = buildWizardRemoteStateEnvelope({ pipelineId: key, state });
      store.set(key, envelope);
      return { ok: true, pipelineId: key, savedAt: envelope.savedAt };
    },
    async load(key): Promise<RemoteStateLoadResult> {
      const raw = store.get(key);
      if (raw === undefined) {
        return { ok: false, error: `no remote pipeline state for ${key}`, notFound: true };
      }
      const envelope = validateWizardRemoteStateEnvelope(raw);
      if (!envelope.ok) {
        return {
          ok: false,
          error: `invalid remote state envelope for ${key}: ${envelope.errors.join('; ')}`,
        };
      }
      return {
        ok: true,
        pipelineId: envelope.value.pipelineId,
        state: envelope.value.state as unknown as WizardState,
      };
    },
    async resume(key): Promise<RemoteStateResumeResult> {
      const loaded = await this.load(key);
      if (!loaded.ok) return loaded;
      return {
        ok: true,
        state: loaded.state,
        envelope: buildWizardRemoteStateEnvelope({
          pipelineId: loaded.pipelineId,
          state: loaded.state,
        }) as WizardRemoteStateEnvelope<WizardState>,
      };
    },
  };
}

// ============================================================================
// Wizard bridge
// ============================================================================

/**
 * Bridge a full `WizardRemoteStateAdapter` onto the wizard's minimal
 * `WizardRemoteStatePort` contract. The port is throwing/`null` shaped (`load`
 * → `WizardState | null`, `save` → `void`, failures thrown), while the adapter
 * is result-shaped. The mapping is honest and lossless:
 *
 *  - adapter `{ ok: true }` → state / success
 *  - adapter `{ ok: false, notFound: true }` → `null` (a missing key is a
 *    normal "start fresh" condition, never an error)
 *  - adapter `{ ok: false, unavailable | error }` → thrown `Error` (the wizard
 *    reports it as remote pipeline state unavailable, exit 2 / 1)
 *
 * Envelope validation happens inside the adapter's `load`/`resume`, so a
 * remote state that does not conform to `wizard-contract.schema.json` surfaces
 * here as a thrown error — never a silent coercion.
 */
export function bridgeRemoteStateAdapter(adapter: WizardRemoteStateAdapter): WizardRemoteStatePort {
  return {
    async load(key: string): Promise<WizardState | null> {
      const result = await adapter.load(key);
      if (result.ok) return result.state;
      if (result.notFound) return null;
      throw new Error(result.error);
    },
    async save(key: string, state: WizardState): Promise<void> {
      const result = await adapter.save(key, state);
      if (!result.ok) throw new Error(result.error);
    },
  };
}
