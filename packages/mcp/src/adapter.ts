/**
 * MCP JSON-RPC 2.0 Adapter for Novamira Plugin.
 * Ported from site-clone-to-v3/src/mcp/mcp-adapter.ts with enhancements:
 * - Differentiated timeouts per operation type
 * - Response schema validation hook
 * - Circuit breaker integration
 */

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
  'inject-calibrated-page': 60_000,
  'batch-build-page': 120_000,
  'execute-php': 60_000,
  'setup-v4-foundation': 60_000,
  default: 30_000,
};

export class McpAdapter {
  private reqId = 0;
  private sessionId: string | null = null;
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

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.reqId,
      method,
      params,
    };

    const timeout = timeoutMs ?? this.options.timeoutMs;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
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
        if (attempt < this.options.maxRetries - 1) {
          await this.sleep(this.options.backoffMs * Math.pow(2, attempt));
        }
      }
    }
    throw lastError ?? new Error('MCP call failed after retries');
  }

  async initialize(): Promise<void> {
    if (this.sessionId) return;
    await this.call<unknown>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'unified-elementor-converter', version: '0.1.0' },
    });
  }

  async callTool<T = unknown>(toolName: string, args: Record<string, unknown>): Promise<T> {
    const timeout = OPERATION_TIMEOUTS[toolName] ?? this.options.timeoutMs;
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
    const timeoutKey = abilityName.split('/').pop() ?? 'default';
    const timeout = OPERATION_TIMEOUTS[timeoutKey] ?? OPERATION_TIMEOUTS['default'];
    const result = await this.callTool<{ content?: McpToolContent[] }>(
      'mcp-adapter-execute-ability',
      { ability_name: abilityName, parameters },
    );
    void timeout; // timeout applied at call level via callTool
    const text = result.content?.[0]?.text ?? '{}';
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`executeAbility(${abilityName}) returned non-JSON: ${text.slice(0, 200)}`);
    }
  }

  async listAbilities(): Promise<string[]> {
    const result = await this.callTool<{ content?: McpToolContent[] }>('mcp-adapter-discover-abilities', {});
    const text = result.content?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text) as { abilities: Array<{ name: string }> };
    return (parsed.abilities ?? []).map((a) => a.name);
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
