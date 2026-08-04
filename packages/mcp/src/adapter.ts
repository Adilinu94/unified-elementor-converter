/**
 * MCP JSON-RPC 2.0 Adapter for Novamira Plugin.
 * Ported from site-clone-to-v3/src/mcp/mcp-adapter.ts with enhancements:
 * - Differentiated timeouts per operation type
 * - Response schema validation hook
 * - Circuit breaker integration
 * - Ability-name resolution against the live registry (Phase 100)
 */

import { resolveAbilityName } from './ability-registry.js';

export interface McpAdapterOptions {
  baseUrl: string;
  authHeader: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolContent {
  type: string;
  text: string;
}

/** Differentiated timeouts per operation type (Improvement #7) */
export const OPERATION_TIMEOUTS: Record<string, number> = {
  'list-media': 10_000,
  'list-variables': 10_000,
  'list-global-classes': 10_000,
  'discover-abilities': 10_000,
  'get-ability-info': 10_000,
  'inject-calibrated-page': 60_000,
  'batch-build-page': 120_000,
  'execute-php': 60_000,
  'setup-v4-foundation': 60_000,
  default: 30_000,
};

export class McpAdapter {
  private reqId = 0;
  private sessionId: string | null = null;
  private initializationPromise: Promise<void> | null = null;
  private readonly options: Required<McpAdapterOptions>;

  constructor(opts: McpAdapterOptions) {
    this.options = {
      timeoutMs: 30_000,
      maxRetries: 3,
      backoffMs: 500,
      ...opts,
    };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
    maxAttempts = this.options.maxRetries,
  ): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.reqId,
      method,
      params,
    };

    const timeout = timeoutMs ?? this.options.timeoutMs;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: this.options.authHeader,
        };
        if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

        const res = await fetch(this.options.baseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });

        if (res.status >= 500) {
          lastError = new Error(`HTTP ${res.status}`);
          await this.sleep(this.options.backoffMs * Math.pow(2, attempt));
          continue;
        }

        const text = await res.text();
        let json: JsonRpcResponse<T>;
        try {
          json = JSON.parse(text) as JsonRpcResponse<T>;
        } catch {
          lastError = new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
          continue;
        }

        const sessionHeader = res.headers.get('mcp-session-id');
        if (sessionHeader) this.sessionId = sessionHeader;

        if (json.error && typeof json.error === 'object') {
          // A server-side session can expire between calls. Refresh once per
          // retry attempt and repeat the request with the new session header.
          const isMissingSession = json.error.code === -32600
            && /missing\s+mcp-session-id/i.test(json.error.message);
          if (isMissingSession && method !== 'initialize') {
            this.sessionId = null;
            await this.initialize();
            continue;
          }
          throw new McpRpcError(json.error.code, json.error.message, json.error.data);
        }

        if (res.status === 401 || res.status === 403) {
          throw new Error(`Auth failed: HTTP ${res.status}`);
        }

        if (res.status >= 400) {
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }

        return json.result as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof McpRpcError) throw err;
        if (attempt < maxAttempts - 1) {
          await this.sleep(this.options.backoffMs * Math.pow(2, attempt));
        }
      }
    }
    throw lastError ?? new Error('MCP call failed after retries');
  }

  async initialize(): Promise<void> {
    if (this.sessionId) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
        try {
          await this.call<unknown>(
            'initialize',
            {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'unified-elementor-converter', version: '0.1.0' },
            },
            undefined,
            1,
          );
          if (this.sessionId) return;
          lastError = new Error('MCP initialize succeeded without Mcp-Session-Id header');
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
        if (attempt < this.options.maxRetries - 1) {
          await this.sleep(this.options.backoffMs * Math.pow(2, attempt));
        }
      }
      throw lastError ?? new Error('MCP initialize failed');
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  async callTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    // Streamable HTTP requires a session header on every tools/call request.
    // Ensure the handshake happens even when callers use executeAbility()
    // directly instead of manually calling initialize() first.
    await this.initialize();
    const timeout = timeoutMs ?? OPERATION_TIMEOUTS[toolName] ?? this.options.timeoutMs;
    const result = await this.call<{ content?: McpToolContent[]; isError?: boolean }>(
      'tools/call',
      { name: toolName, arguments: args },
      timeout,
    );
    if (result.isError) {
      const errorText = result.content?.[0]?.text ?? 'Unknown MCP error';
      throw new Error(`MCP tool ${toolName} failed: ${errorText}`);
    }
    return result as T;
  }

  async executeAbility<T = unknown>(abilityName: string, parameters: Record<string, unknown> = {}): Promise<T> {
    // Map any legacy/aliased name onto a live ability; throws for unknown names
    // so namespace drift surfaces immediately instead of failing silently.
    const resolvedName = resolveAbilityName(abilityName);
    const timeoutKey = resolvedName.split('/').pop() ?? 'default';
    const timeout = OPERATION_TIMEOUTS[timeoutKey] ?? OPERATION_TIMEOUTS['default'];
    const result = await this.callTool<{ content?: McpToolContent[] }>(
      'mcp-adapter-execute-ability',
      { ability_name: resolvedName, parameters },
      timeout,
    );
    const text = result.content?.[0]?.text ?? '{}';
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`executeAbility(${resolvedName}) returned non-JSON: ${text.slice(0, 200)}`);
    }
  }

  async listAbilities(): Promise<string[]> {
    const result = await this.callTool<{ content?: McpToolContent[] }>('mcp-adapter-discover-abilities', {});
    const text = result.content?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text) as { abilities: Array<{ name: string }> };
    return (parsed.abilities ?? []).map((a) => a.name);
  }

  /**
   * Fetch the live input-schema description of one ability. A transport meta
   * tool like `discover-abilities` — deliberately not registry-gated: the
   * verification path uses it to check the large-deploy contract against the
   * server before any productive unlock.
   */
  async getAbilityInfo(abilityName: string): Promise<unknown> {
    // Pass the differentiated timeout explicitly: callTool resolves by the full
    // dashed wire name, which never matches the short OPERATION_TIMEOUTS key.
    const result = await this.callTool<{ content?: McpToolContent[] }>(
      'mcp-adapter-get-ability-info',
      { ability_name: abilityName },
      OPERATION_TIMEOUTS['get-ability-info'],
    );
    const text = result.content?.[0]?.text ?? '{}';
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`get-ability-info(${abilityName}) returned non-JSON: ${text.slice(0, 200)}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class McpRpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(`MCP RPC ${code}: ${message}`);
    this.name = 'McpRpcError';
  }
}
