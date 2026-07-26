/**
 * Phase 10 — MCP Session Handshake + Capability-Exchange + Reconnect.
 *
 * V1 had `src/mcp/mcp-session.ts` with basic session start/close. Phase 10
 * adds capability negotiation (what abilities does the target expose?) plus
 * automatic reconnect on disconnect (exponential backoff, maxAttempts cap,
 * jitter) and a Handshake-Outcome record for downstream consumers.
 */
import { randomUUID } from 'node:crypto';

export interface McpServerCapabilities {
  readonly abilities: readonly string[];
  readonly version: string;
  readonly supportsBatch: boolean;
}

export interface McpHandshakeRequest {
  readonly protocol: string;
  readonly clientId: string;
  readonly requestedAbilities: readonly string[];
}

export interface McpHandshakeResponse {
  readonly sessionId: string;
  readonly serverCapabilities: McpServerCapabilities;
  readonly negotiatedAbilities: readonly string[];
  readonly rejectedAbilities: readonly string[];
  readonly serverVersion: string;
}

export interface McpHandshakeOutcome {
  readonly success: boolean;
  readonly request: McpHandshakeRequest;
  readonly response: McpHandshakeResponse | null;
  readonly error: string | null;
  readonly negotiatedAt: string;
}

export interface ReconnectAttempt {
  readonly attempt: number;
  readonly delayMs: number;
  readonly success: boolean;
  readonly error: string | null;
}

export interface ReconnectResult {
  readonly success: boolean;
  readonly totalAttempts: number;
  readonly attempts: readonly ReconnectAttempt[];
  readonly finalSessionId: string | null;
}

const PROTOCOL_VERSION = 'mcp/v2';
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 2000;

export type HandshakeFn = (
  request: McpHandshakeRequest,
) => Promise<McpHandshakeResponse>;

export type ReconnectHandshakeFn = (
  sessionId: string,
  attempt: number,
) => Promise<McpHandshakeResponse>;

export interface Phase10SessionOptions {
  readonly clientId: string;
  readonly requestedAbilities: readonly string[];
  readonly maxReconnectAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export const DEFAULT_PHASE10_SESSION_OPTIONS: Required<
  Omit<Phase10SessionOptions, 'clientId' | 'requestedAbilities'>
> = {
  maxReconnectAttempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
};

export function buildHandshakeRequest(
  clientId: string,
  requestedAbilities: readonly string[],
  protocol: string = PROTOCOL_VERSION,
): McpHandshakeRequest {
  return { protocol, clientId, requestedAbilities };
}

export function negotiateAbilities(
  requested: readonly string[],
  offered: readonly string[],
): { negotiated: readonly string[]; rejected: readonly string[] } {
  const offeredSet = new Set(offered);
  const negotiated: string[] = [];
  const rejected: string[] = [];
  for (const ability of requested) {
    if (offeredSet.has(ability)) {
      negotiated.push(ability);
    } else {
      rejected.push(ability);
    }
  }
  return { negotiated, rejected };
}

export async function performHandshake(
  handshake: HandshakeFn,
  options: Phase10SessionOptions,
  now: () => Date = () => new Date(),
): Promise<McpHandshakeOutcome> {
  const request = buildHandshakeRequest(
    options.clientId,
    options.requestedAbilities,
  );
  try {
    const response = await handshake(request);
    return {
      success: true,
      request,
      response,
      error: null,
      negotiatedAt: now().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      request,
      response: null,
      error: err instanceof Error ? err.message : String(err),
      negotiatedAt: now().toISOString(),
    };
  }
}

function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const expDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(expDelay, maxDelayMs);
  const jitter = Math.random() * cappedDelay * 0.1;
  return Math.floor(cappedDelay + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function reconnectAfterDisconnect(
  lastSessionId: string,
  reconnect: ReconnectHandshakeFn,
  options: Required<Omit<Phase10SessionOptions, 'clientId' | 'requestedAbilities'>>,
): Promise<ReconnectResult> {
  const attempts: ReconnectAttempt[] = [];
  let lastError: string | null = null;
  let finalSessionId: string | null = null;

  for (let attempt = 1; attempt <= options.maxReconnectAttempts; attempt++) {
    try {
      const response = await reconnect(lastSessionId, attempt);
      attempts.push({
        attempt,
        delayMs: 0,
        success: true,
        error: null,
      });
      finalSessionId = response.sessionId;
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      attempts.push({
        attempt,
        delayMs: 0,
        success: false,
        error: lastError,
      });
      if (attempt < options.maxReconnectAttempts) {
        const delayMs = computeBackoffDelay(
          attempt,
          options.baseDelayMs,
          options.maxDelayMs,
        );
        attempts[attempts.length - 1] = {
          attempt,
          delayMs,
          success: false,
          error: lastError,
        };
        await sleep(delayMs);
      }
    }
  }

  return {
    success: finalSessionId !== null,
    totalAttempts: attempts.length,
    attempts,
    finalSessionId,
  };
}

export function isHandshakeComplete(
  outcome: McpHandshakeOutcome,
): boolean {
  return (
    outcome.success &&
    outcome.response !== null &&
    outcome.response.negotiatedAbilities.length > 0
  );
}

export function capabilitiesAsObject(
  capabilities: McpServerCapabilities,
): Record<string, unknown> {
  return {
    version: capabilities.version,
    abilityCount: capabilities.abilities.length,
    supportsBatch: capabilities.supportsBatch,
  };
}

export function createSessionId(): string {
  return randomUUID();
}