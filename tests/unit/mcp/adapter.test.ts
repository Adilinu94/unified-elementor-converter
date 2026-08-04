import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpAdapter } from '../../../packages/mcp/src/adapter.ts';

interface RecordedRequest {
  body: { method?: string };
  headers: Headers;
}

describe('McpAdapter session transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the ability-specific timeout through to tools/call', async () => {
    const timeouts: number[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    });
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-timeout' },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const adapter = new McpAdapter({ baseUrl: 'https://mcp.test', authHeader: 'Basic test' });
    await expect(adapter.executeAbility('novamira-adrianv2/batch-build-page', {})).resolves.toEqual({ success: true });
    expect(timeouts).toEqual([30_000, 120_000]);
    timeoutSpy.mockRestore();
  });

  it('initializes before the first tools/call when executeAbility is used directly', async () => {
    const requests: RecordedRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      const headers = new Headers(init?.headers);
      requests.push({ body, headers });

      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const adapter = new McpAdapter({ baseUrl: 'https://mcp.test', authHeader: 'Basic test' });
    await expect(adapter.executeAbility('novamira/elementor-check-setup', {})).resolves.toEqual({ success: true });

    expect(requests.map((request) => request.body.method)).toEqual(['initialize', 'tools/call']);
    expect(requests[1]?.headers.get('Mcp-Session-Id')).toBe('session-1');
  });

  it('rejects an initialize response without a session header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const adapter = new McpAdapter({ baseUrl: 'https://mcp.test', authHeader: 'Basic test' });
    await expect(adapter.executeAbility('novamira/elementor-check-setup', {}))
      .rejects.toThrow('without Mcp-Session-Id header');
  });

  it('does not refresh the session for unrelated invalid-request errors', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      methods.push(body.method ?? '');
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32600, message: 'Invalid request shape' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const adapter = new McpAdapter({ baseUrl: 'https://mcp.test', authHeader: 'Basic test' });
    await expect(adapter.executeAbility('novamira/elementor-check-setup', {}))
      .rejects.toThrow('Invalid request shape');
    expect(methods).toEqual(['initialize', 'tools/call']);
  });

  it('refreshes the session and retries after a missing-session RPC error', async () => {
    const requests: RecordedRequest[] = [];
    let initializeCount = 0;
    let toolCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      const headers = new Headers(init?.headers);
      requests.push({ body, headers });

      if (body.method === 'initialize') {
        initializeCount++;
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: initializeCount, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': `session-${initializeCount}` },
        });
      }

      toolCount++;
      if (toolCount === 1) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: toolCount,
          error: { code: -32600, message: 'Missing Mcp-Session-Id header' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: toolCount,
        result: { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const adapter = new McpAdapter({ baseUrl: 'https://mcp.test', authHeader: 'Basic test' });
    await expect(adapter.executeAbility('novamira/elementor-check-setup', {})).resolves.toEqual({ success: true });

    expect(requests.map((request) => request.body.method)).toEqual([
      'initialize',
      'tools/call',
      'initialize',
      'tools/call',
    ]);
    expect(requests[1]?.headers.get('Mcp-Session-Id')).toBe('session-1');
    expect(requests[3]?.headers.get('Mcp-Session-Id')).toBe('session-2');
  });

  it('retries initialization after a failed handshake', async () => {
    let initializeCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      if (body.method === 'initialize') {
        initializeCount++;
        if (initializeCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-recovered' },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        result: { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const adapter = new McpAdapter({ baseUrl: 'https://mcp.test', authHeader: 'Basic test', maxRetries: 2 });
    await expect(adapter.executeAbility('novamira/elementor-check-setup', {})).resolves.toEqual({ success: true });
    expect(initializeCount).toBe(2);
  });

  it('fetches the live ability-info schema via the meta tool (not registry-gated)', async () => {
    const requests: RecordedRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; params?: unknown };
      const headers = new Headers(init?.headers);
      requests.push({ body, headers });

      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: { content: [{ type: 'text', text: JSON.stringify({ input_schema: { properties: { mode: { enum: ['replace', 'append'] } } } }) }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const adapter = new McpAdapter({ baseUrl: 'https://mcp.test', authHeader: 'Basic test' });
    const info = await adapter.getAbilityInfo('novamira-adrianv2/batch-build-page');

    expect(info).toEqual({ input_schema: { properties: { mode: { enum: ['replace', 'append'] } } } });
    // The tool arguments carry the requested ability name.
    const toolCall = requests.find((r) => r.body.method === 'tools/call');
    const args = (toolCall?.body as { params?: { arguments?: Record<string, unknown> } }).params?.arguments;
    expect(args).toEqual({ ability_name: 'novamira-adrianv2/batch-build-page' });
  });

  it('shares one initialization request between concurrent first calls', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      methods.push(body.method ?? '');
      if (body.method === 'initialize') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-shared' },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const adapter = new McpAdapter({ baseUrl: 'https://mcp.test', authHeader: 'Basic test' });
    await Promise.all([
      adapter.executeAbility('novamira/elementor-check-setup', {}),
      adapter.executeAbility('novamira/elementor-check-setup', {}),
    ]);

    expect(methods.filter((method) => method === 'initialize')).toHaveLength(1);
    expect(methods.filter((method) => method === 'tools/call')).toHaveLength(2);
  });
});
