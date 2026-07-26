#!/usr/bin/env node
/**
 * scripts/lib/mcp-bridge.ts  —  v4.0.0 (JSON-RPC 2.0)
 *
 * ARCHITEKTUR (Fix A — 2026-06-11):
 *   Direkte HTTP-Calls von Node.js zu yoursite.local via JSON-RPC 2.0
 *   mit Session-Handshake und Adapter-Wrapper für alle Novamira-Abilities.
 *
 *   Protokoll:
 *     POST http://yoursite.local/wp-json/mcp/novamira
 *     1. initialize → Session-Handshake (Mcp-Session-Id)
 *     2. tools/call  → { name: "mcp-adapter-execute-ability",
 *                        arguments: { ability_name: "...", parameters: {...} } }
 *
 *   Alle Novamira-Abilities laufen DURCH den Adapter:
 *     ❌ Direkt:   novamira/adrians-export-design-system {}
 *     ✅ Korrekt:  mcp-adapter-execute-ability {
 *                    ability_name: "novamira/adrians-export-design-system",
 *                    parameters: {}
 *                  }
 *
 * SELF-TEST:
 *   node --import tsx scripts/lib/mcp-bridge.ts --self-test
 *   Sendet einen echten greet-Call wenn Konfiguration gefunden wird.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import { CircuitBreaker, type CircuitBreakerCallbacks } from '../lib/circuit-breaker.js';
import { Idempotency } from '../lib/idempotency.js';
import { BatchScheduler, type ScheduleOptions } from '../lib/batch-scheduler.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────────────────────────────────────

interface McpConfigResult {
  mcpUrl: string;
  authHeader: string | null;
  wpUrl: string;
  serverKey: string;
}

interface McpBridgeOptions {
  mcpUrl?: string;
  authHeader?: string | null;
  wpUrl?: string;
  timeout?: number;
  concurrency?: number;
  verbose?: boolean;
  /** Optionaler CircuitBreaker fuer Fail-Fast-Schutz */
  circuitBreaker?: CircuitBreaker;
  /** CircuitBreaker-Callbacks (nur wenn kein Breaker uebergeben wird) */
  circuitBreakerCallbacks?: CircuitBreakerCallbacks;
  /** Optionaler Idempotency-Modul fuer Call-Dedup (UMBAUPLAN Phase 7b) */
  idempotency?: Idempotency;
  /** Optionaler BatchScheduler fuer priorisierte Ausfuehrung (UMBAUPLAN Phase 7c) */
  batchScheduler?: BatchScheduler;
}

interface CallOptions {
  cache?: boolean;
  maxRetries?: number;
}

interface CallItem {
  ability: string;
  params?: Record<string, unknown>;
  /** Prioritaet fuer BatchScheduler (0=hoechste, 10=niedrigste, default=5) */
  priority?: number;
}

interface ParallelResult {
  status: 'fulfilled' | 'rejected';
  value?: unknown;
  reason?: unknown;
  ability: string;
}

interface CacheEntry {
  data: unknown;
  expiry: number;
}

interface RestEndpoint {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

// ── Config Discovery ──────────────────────────────────────────────────────────

function findMcpConfig(): string | null {
  const projectRoot = join(__dirname, '..', '..');

  const candidates = [
    process.env.MCP_CONFIG_PATH || null,
    join(projectRoot, '.mcp.json'),
    join(projectRoot, 'mcp-server-config.json'),
    join(projectRoot, '..', 'novamira-adrianv2', 'mcp-server-config.json'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function parseMcpConfig(configPath: string): McpConfigResult {
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  const servers = (raw.mcpServers || raw.servers || {}) as Record<string, Record<string, unknown>>;

  if (Object.keys(servers).length === 0) {
    throw new Error(`Keine mcpServers in ${configPath} gefunden.`);
  }

  const key = Object.keys(servers).find(k =>
    k.toLowerCase().includes('novamira')
  ) || Object.keys(servers)[0];

  const srv = servers[key];

  // URL ermitteln
  let mcpUrl: string | undefined = (srv.url || srv.endpoint) as string | undefined;

  if (!mcpUrl && srv.env && (srv.env as Record<string, string>).WP_API_URL) {
    mcpUrl = (srv.env as Record<string, string>).WP_API_URL;
  }

  if (!mcpUrl) {
    mcpUrl = process.env.WP_API_URL || undefined;
  }

  if (!mcpUrl) {
    throw new Error(
      `Kein URL für novamira-Server "${key}" gefunden. ` +
      `Erwartet: "url" im Config-Eintrag, env.WP_API_URL, oder WP_API_URL env var.`
    );
  }

  // Auth ermitteln
  let authHeader: string | null = null;

  if (srv.headers && (srv.headers as Record<string, string>).Authorization) {
    authHeader = (srv.headers as Record<string, string>).Authorization;
  }
  else if (srv.env && (srv.env as Record<string, string>).WP_API_USERNAME && (srv.env as Record<string, string>).WP_API_PASSWORD) {
    const b64 = Buffer.from(
      `${(srv.env as Record<string, string>).WP_API_USERNAME}:${(srv.env as Record<string, string>).WP_API_PASSWORD}`
    ).toString('base64');
    authHeader = `Basic ${b64}`;
  }
  else if (srv.wp_user && srv.wp_app_password) {
    const b64 = Buffer.from(
      `${srv.wp_user}:${srv.wp_app_password}`
    ).toString('base64');
    authHeader = `Basic ${b64}`;
  }
  else if (srv.apiKey || srv.api_key) {
    authHeader = `Bearer ${srv.apiKey || srv.api_key}`;
  }
  else if (process.env.WP_API_USERNAME && process.env.WP_API_PASSWORD) {
    const b64 = Buffer.from(
      `${process.env.WP_API_USERNAME}:${process.env.WP_API_PASSWORD}`
    ).toString('base64');
    authHeader = `Basic ${b64}`;
  }
  else if (process.env.NOVAMIRA_API_KEY) {
    authHeader = `Bearer ${process.env.NOVAMIRA_API_KEY}`;
  }

  const wpUrl = (srv.wp_url || (srv.env ? (srv.env as Record<string, string>).WP_URL : null) || mcpUrl.replace(/\/wp-json\/mcp\/.*$/, '')) as string;

  return { mcpUrl, authHeader, wpUrl, serverKey: key };
}

// ── McpBridge ─────────────────────────────────────────────────────────────────

export class McpBridge {
  mcpUrl: string;
  _authHeader: string | null;
  wpUrl: string;
  timeout: number;
  verbose: boolean;
  defaultConcurrency: number;

  private _sessionId: string | null = null;
  private _sessionExpiry: number = 0;
  private _requestCounter: number = 0;
  private _cache: Map<string, CacheEntry> = new Map();
  private _cacheTtl: number = 5 * 60 * 1000; // 5 Minuten
  private _httpsAgent: any = undefined;
  private _circuitBreaker: CircuitBreaker | null = null;
  private _idempotency: Idempotency | null = null;
  private _batchScheduler: BatchScheduler | null = null;

  static _REST_ENDPOINT_MAP: Record<string, (p: Record<string, unknown>) => RestEndpoint> = {
    'novamira/elementor-set-content': (p) => ({
      url: `/wp-json/novamira/v1/elementor/set-content`,
      method: 'POST', body: { post_id: p.post_id, content: p.content } as Record<string, unknown>,
    }),
    'novamira/elementor-get-content': (p) => ({
      url: `/wp-json/novamira/v1/elementor/get-content/${p.post_id}`,
      method: 'GET',
    }),
    'novamira/adrians-export-design-system': (p) => ({
      url: `/wp-json/novamira/v1/design-system/export${p.what ? `?what=${encodeURIComponent(String(p.what))}` : ''}`,
      method: 'GET',
    }),
    'novamira/adrians-media-upload': (p) => ({
      url: '/wp-json/novamira/v1/media/upload',
      method: 'POST', body: p,
    }),
    'novamira/adrians-batch-media-upload': (p) => ({
      url: '/wp-json/novamira/v1/media/batch-upload',
      method: 'POST', body: p,
    }),
    'novamira/adrians-setup-v4-foundation': (p) => ({
      url: '/wp-json/novamira/v1/elementor/foundation',
      method: 'POST', body: p,
    }),
    'novamira/adrians-layout-audit': (p) => ({
      url: `/wp-json/novamira/v1/elementor/layout-audit/${p.post_id}`,
      method: 'GET',
    }),
    'novamira/adrians-visual-qa': (p) => ({
      url: `/wp-json/novamira/v1/elementor/visual-qa/${p.post_id}`,
      method: 'GET',
    }),
    'novamira/adrians-responsive-audit': (p) => ({
      url: `/wp-json/novamira/v1/elementor/responsive-audit/${p.post_id}`,
      method: 'GET',
    }),
    'novamira/adrians-variable-audit': (p) => ({
      url: '/wp-json/novamira/v1/elementor/variable-audit',
      method: 'POST', body: p,
    }),
    'novamira/adrians-batch-create-variables': (p) => ({
      url: '/wp-json/novamira/v1/elementor/variables/batch',
      method: 'POST', body: p,
    }),
    'novamira/adrians-add-global-class-variant': (p) => ({
      url: '/wp-json/novamira/v1/elementor/class-variant',
      method: 'POST', body: p,
    }),
    'novamira/adrians-apply-variable-to-class': (p) => ({
      url: '/wp-json/novamira/v1/elementor/class-variable',
      method: 'POST', body: p,
    }),
  };

  constructor(options: McpBridgeOptions = {}) {
    this.mcpUrl       = options.mcpUrl || '';
    this._authHeader  = options.authHeader || null;
    this.wpUrl        = options.wpUrl || '';
    this.timeout      = options.timeout || 120000;
    this.verbose      = options.verbose || false;
    this.defaultConcurrency = options.concurrency
      || McpBridge._resolveConcurrency();

    // Circuit Breaker Integration (UMBAUPLAN Phase 7)
    if (options.circuitBreaker) {
      this._circuitBreaker = options.circuitBreaker;
    } else if (process.env.CB_MCP_ENABLED === '1') {
      this._circuitBreaker = new CircuitBreaker(
        { name: 'mcp', failureThreshold: 5 },
        options.circuitBreakerCallbacks || {},
      );
    }

    // Idempotency Integration (UMBAUPLAN Phase 7b)
    if (options.idempotency) {
      this._idempotency = options.idempotency;
    } else if (process.env.IDEM_MCP_ENABLED === '1') {
      this._idempotency = new Idempotency({ name: 'mcp' });
    }

    // BatchScheduler Integration (UMBAUPLAN Phase 7c)
    if (options.batchScheduler) {
      this._batchScheduler = options.batchScheduler;
    } else if (process.env.BS_MCP_ENABLED === '1') {
      this._batchScheduler = new BatchScheduler({
        name: 'mcp',
        concurrency: this.defaultConcurrency,
      });
    }
  }

  static _resolveConcurrency(): number {
    const explicit = parseInt(process.env.MCP_CONCURRENCY || '', 10);
    if (!isNaN(explicit) && explicit > 0) return explicit;

    const profile = process.env.MCP_CONCURRENCY_PROFILE || 'medium';
    const presets: Record<string, number> = { low: 2, medium: 5, high: 10 };
    return presets[profile] || 5;
  }

  static async fromConfig(configPath: string | null = null): Promise<McpBridge> {
    const resolved = configPath || findMcpConfig();

    if (!resolved) {
      const mcpUrl = process.env.WP_API_URL;
      if (mcpUrl) {
        const bridge = new McpBridge({
          mcpUrl,
          authHeader: null,
          wpUrl: mcpUrl.replace(/\/wp-json\/mcp\/.*$/, ''),
        });
        if (process.env.WP_API_USERNAME && process.env.WP_API_PASSWORD) {
          const b64 = Buffer.from(
            `${process.env.WP_API_USERNAME}:${process.env.WP_API_PASSWORD}`
          ).toString('base64');
          bridge._authHeader = `Basic ${b64}`;
        } else if (process.env.NOVAMIRA_API_KEY) {
          bridge._authHeader = `Bearer ${process.env.NOVAMIRA_API_KEY}`;
        }
        return bridge;
      }
      throw new Error(
        'Keine MCP-Konfiguration gefunden.\n' +
        'Erwartet: .mcp.json, mcp-server-config.json, oder WP_API_URL env var.\n' +
        'Siehe mcp-server-config.example.json für ein Template.'
      );
    }

    const { mcpUrl, authHeader, wpUrl } = parseMcpConfig(resolved);
    return new McpBridge({ mcpUrl, authHeader, wpUrl, verbose: process.env.MCP_VERBOSE === '1' });
  }

  // ── Session-Management ───────────────────────────────────────────────────

  async _ensureSession(): Promise<void> {
    if (this._sessionId && Date.now() < this._sessionExpiry) {
      return;
    }

    process.stderr.write('[mcp-bridge] Initialisiere MCP-Session...\n');

    const httpsAgent = this.mcpUrl.startsWith('https')
      ? this._getHttpsAgent()
      : null;

    const fetchOpts: Record<string, unknown> = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this._getAuthHeaders(),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'framer-v4-pipeline',
            version: '4.0.0',
          },
        },
      }),
      signal: AbortSignal.timeout(30000),
    };

    if (httpsAgent) {
      fetchOpts.agent = httpsAgent;
    }

    const res = await fetch(this.mcpUrl, fetchOpts as RequestInit);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `MCP initialize fehlgeschlagen: HTTP ${res.status} — ${text.slice(0, 300)}`
      );
    }

    const sid = res.headers.get('mcp-session-id');
    if (!sid) {
      throw new Error(
        'MCP initialize: Kein Mcp-Session-Id im Response-Header. ' +
        'Prüfe ob der MCP-Server läuft und die Auth korrekt ist.'
      );
    }

    this._sessionId = sid;
    this._sessionExpiry = Date.now() + 25 * 60 * 1000;
    this._requestCounter = 0;
    process.stderr.write(`[mcp-bridge] Session initialisiert: ${sid.slice(0, 8)}...\n`);
  }

  _getHttpsAgent(): any {
    if (this._httpsAgent !== undefined) {
      return this._httpsAgent;
    }

    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
      this._httpsAgent = null;
      return null;
    }

    try {
      const https = require('https') as { Agent: new (options?: Record<string, unknown>) => unknown };
      this._httpsAgent = new https.Agent({ rejectUnauthorized: false });
      return this._httpsAgent;
    } catch {
      this._httpsAgent = null;
      return null;
    }
  }

  // ── Circuit Breaker Access ──────────────────────────────────────────────

  /** Setzt oder aktiviert einen CircuitBreaker nachtraeglich. */
  setCircuitBreaker(cb: CircuitBreaker): void {
    this._circuitBreaker = cb;
  }

  /** Gibt den aktuellen CircuitBreaker zurueck (oder null). */
  getCircuitBreaker(): CircuitBreaker | null {
    return this._circuitBreaker;
  }

  /** Circuit-Breaker Status (oder null wenn nicht aktiv). */
  circuitBreakerStatus(): Record<string, unknown> | null {
    if (!this._circuitBreaker) return null;
    const s = this._circuitBreaker.status();
    return {
      name: s.name,
      state: s.state,
      failureCount: s.failureCount,
      isOpen: s.isOpen,
      totalCalls: s.totalCalls,
      totalFailures: s.totalFailures,
    };
  }

  // ── Idempotency Access ─────────────────────────────────────────────────

  /** Setzt oder aktiviert Idempotency nachtraeglich. */
  setIdempotency(idem: Idempotency): void {
    this._idempotency = idem;
  }

  /** Gibt die aktuelle Idempotency-Instanz zurueck (oder null). */
  getIdempotency(): Idempotency | null {
    return this._idempotency;
  }

  // ── BatchScheduler Access ──────────────────────────────────────────────

  /** Setzt oder aktiviert einen BatchScheduler nachtraeglich. */
  setBatchScheduler(bs: BatchScheduler): void {
    this._batchScheduler = bs;
  }

  /** Gibt den aktuellen BatchScheduler zurueck (oder null). */
  getBatchScheduler(): BatchScheduler | null {
    return this._batchScheduler;
  }

  // ── Core Call Methods ────────────────────────────────────────────────────

  async call(ability: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<unknown> {
    // Layering: Idempotency (inner) → CircuitBreaker (middle) → _callInternal (core)
    // Idempotency wraps the raw call fn, CB wraps the idempotent fn
    const rawCall = () => this._callInternal(ability, params, options);

    // Idempotency Wrapper (UMBAUPLAN Phase 7b) — inner to CB
    const idempotentCall = this._idempotency
      ? () => this._idempotency!.call(rawCall, ability, params)
      : rawCall;

    // Circuit Breaker Wrapper (UMBAUPLAN Phase 7) — outer
    if (this._circuitBreaker) {
      return this._circuitBreaker.call(idempotentCall);
    }
    return idempotentCall();
  }

  /** Interne Call-Implementierung (ohne CircuitBreaker-Wrapper). */
  private async _callInternal(ability: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<unknown> {
    const isMutable = (
      ability.includes('setup-v4-foundation') ||
      ability.includes('setup-kit')
    );

    const useCache = isMutable ? false : (options.cache !== false);

    if (useCache) {
      const cacheKey = `${ability}:${JSON.stringify(params)}`;
      const cached = this._cache.get(cacheKey);
      if (cached && Date.now() < cached.expiry) {
        this._log(`Cache-HIT: ${ability}`);
        return cached.data;
      }
    }

    const maxRetries = options.maxRetries ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this._ensureSession();

        const id = ++this._requestCounter;
        const httpsAgent = this.mcpUrl.startsWith('https')
          ? this._getHttpsAgent()
          : null;

        const fetchOpts: Record<string, unknown> = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': this._sessionId,
            ...this._getAuthHeaders(),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: {
              name: 'mcp-adapter-execute-ability',
              arguments: {
                ability_name: ability,
                parameters: params,
              },
            },
          }),
          signal: AbortSignal.timeout(this.timeout),
        };

        if (httpsAgent) {
          fetchOpts.agent = httpsAgent;
        }

        const res = await fetch(this.mcpUrl, fetchOpts as RequestInit);

        if (res.status === 401 || res.status === 419) {
          if (attempt < maxRetries) {
            process.stderr.write(`[mcp-bridge] Session abgelaufen (${res.status}), initialisiere neu...\n`);
            this._sessionId = null;
            this._sessionExpiry = 0;
            continue;
          }
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            `MCP HTTP ${res.status} für "${ability}": ${text.slice(0, 300)}`
          );
        }

        const envelope = await res.json() as Record<string, unknown>;

        if (envelope.error) {
          const err = envelope.error as { code?: number; message?: string };
          throw new Error(
            `MCP RPC Error ${err.code || '?'}: ${err.message || 'Unbekannter Fehler'}`
          );
        }

        const result = this._parseToolResult(envelope.result as Record<string, unknown>);

        if (useCache) {
          const cacheKey = `${ability}:${JSON.stringify(params)}`;
          this._cache.set(cacheKey, {
            data: result,
            expiry: Date.now() + this._cacheTtl,
          });
        }

        return result;

      } catch (err: unknown) {
        if (err instanceof SyntaxError) {
          throw new Error(`Invalid JSON response für "${ability}": ${err.message}`);
        }

        const typedErr = err as Error & { name?: string };

        if (typedErr.name === 'TimeoutError' || typedErr.name === 'AbortError') {
          throw new Error(`Timeout bei "${ability}" nach ${this.timeout}ms`);
        }

        if (attempt >= maxRetries) {
          try {
            process.stderr.write(`[mcp-bridge] JSON-RPC fehlgeschlagen, versuche REST-Fallback für "${ability}"...\n`);
            const restResult = await this._wpRestCall(ability, params);
            if (useCache) {
              const cacheKey = `${ability}:${JSON.stringify(params)}`;
              this._cache.set(cacheKey, {
                data: restResult,
                expiry: Date.now() + this._cacheTtl,
              });
            }
            return restResult;
          } catch (_restErr: unknown) {
            const restMsg = _restErr instanceof Error ? _restErr.message : String(_restErr);
            process.stderr.write(`[mcp-bridge] REST-Fallback ebenfalls fehlgeschlagen: ${restMsg.slice(0, 150)}\n`);
          }
          throw err;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        process.stderr.write(`[mcp-bridge] Retry ${attempt + 1}/${maxRetries} in ${delay}ms: ${typedErr.message.slice(0, 120)}\n`);
        await new Promise<void>(r => setTimeout(r, delay));
      }
    }
  }

  _parseToolResult(result: Record<string, unknown> | undefined): unknown {
    if (!result) return null;

    const content = result.content;
    if (!Array.isArray(content)) return result;

    const textBlocks = content.filter((b: unknown) => (b as Record<string, unknown>)?.type === 'text') as Array<{ type: string; text: string }>;

    if (textBlocks.length === 0) return result;
    if (textBlocks.length === 1) {
      const block = textBlocks[0];
      try {
        return JSON.parse(block.text);
      } catch {
        return block.text;
      }
    }

    const parsed = textBlocks.map(b => {
      try { return JSON.parse(b.text); }
      catch { return b.text; }
    });

    if (parsed.every(p => typeof p === 'object' && p !== null && !Array.isArray(p))) {
      return Object.assign({}, ...(parsed as object[]));
    }

    return parsed.length === 1 ? parsed[0] : parsed;
  }

  async callSequence(calls: CallItem[], options: { stopOnError?: boolean } = {}): Promise<unknown[]> {
    const stopOnError = options.stopOnError === true;
    const results: unknown[] = [];
    for (const item of calls) {
      try {
        const result = await this.call(item.ability, item.params || {});
        results.push(result);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp-bridge] callSequence: "${item.ability}" fehlgeschlagen: ${errMsg}\n`);
        if (stopOnError) {
          if (this._circuitBreaker) {
            this._circuitBreaker.recordFailure(err instanceof Error ? err : new Error(errMsg));
          }
          throw err;
        }
        results.push({ __error: errMsg, ability: item.ability });
      }
    }
    return results;
  }

  async callParallel(calls: CallItem[], options: { concurrency?: number } = {}): Promise<ParallelResult[]> {
    if (!Array.isArray(calls) || calls.length === 0) return [];

    // ── BatchScheduler Mode (UMBAUPLAN Phase 7c) ─────────────────────────
    // Wenn BatchScheduler aktiv UND mindestens ein Call hat eine Priority,
    // nutze den BatchScheduler statt des Worker-Pools.
    const hasPriorities = calls.some(c => c.priority !== undefined);
    if (this._batchScheduler && hasPriorities) {
      return this._callParallelViaScheduler(calls, options);
    }

    // ── Worker-Pool Mode (mit Idempotency via this.call()) ────────────────
    const concurrency = Math.max(1, options.concurrency ?? this.defaultConcurrency ?? 5);

    process.stderr.write(
      `[mcp-bridge] callParallel: ${calls.length} calls gestartet (concurrency=${concurrency})\n`
    );

    const start = Date.now();
    const results: ParallelResult[] = new Array(calls.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < calls.length) {
        const idx = cursor++;
        const { ability, params = {} } = calls[idx];
        try {
          // this.call() hat bereits Idempotency+CB Schutz
          const value = await this.call(ability, params);
          results[idx] = { status: 'fulfilled', value, ability };
        } catch (reason: unknown) {
          results[idx] = { status: 'rejected', reason, ability };
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, calls.length) },
      () => worker()
    );
    await Promise.all(workers);

    const ms = Date.now() - start;
    const failed = results.filter(r => r.status === 'rejected').length;
    process.stderr.write(
      `[mcp-bridge] callParallel: fertig in ${ms}ms ` +
      `(${calls.length - failed} ok, ${failed} fehler, concurrency=${concurrency})\n`
    );
    return results;
  }

  /**
   * callParallel ueber BatchScheduler — priorisierte Ausfuehrung.
   * Tasks ohne Priority bekommen default=5.
   */
  private async _callParallelViaScheduler(
    calls: CallItem[],
    _options: { concurrency?: number },
  ): Promise<ParallelResult[]> {
    const bs = this._batchScheduler!;

    process.stderr.write(
      `[mcp-bridge] callParallel: ${calls.length} calls via BatchScheduler ` +
      `(concurrency=${bs.concurrency}, with priorities)\n`
    );

    const start = Date.now();
    const results: ParallelResult[] = new Array(calls.length);

    const bsResults = await bs.scheduleAll(
      calls.map((c, i) => ({
        fn: () => this.call(c.ability, c.params || {}),
        options: {
          priority: c.priority ?? 5,
          ability: c.ability,
          params: c.params || {},
          maxRetries: 0,  // this.call() hat bereits eigene Retry-Logik
        } as ScheduleOptions,
      })),
    );

    for (let i = 0; i < bsResults.length; i++) {
      const r = bsResults[i];
      if (r.status === 'fulfilled') {
        results[i] = {
          status: 'fulfilled',
          value: r.value,
          ability: calls[i].ability,
        };
      } else {
        results[i] = {
          status: 'rejected',
          reason: r.reason,
          ability: calls[i].ability,
        };
      }
    }

    const ms = Date.now() - start;
    const failed = results.filter(r => r.status === 'rejected').length;
    process.stderr.write(
      `[mcp-bridge] callParallel (BatchScheduler): fertig in ${ms}ms ` +
      `(${calls.length - failed} ok, ${failed} fehler)\n`
    );
    return results;
  }

  // ── WP REST Fallback ─────────────────────────────────────────────────────

  async _wpRestCall(ability: string, params: Record<string, unknown>): Promise<unknown> {
    const endpointFn = McpBridge._REST_ENDPOINT_MAP[ability];
    if (!endpointFn) {
      throw new Error(`Kein REST-Endpoint für "${ability}" registriert`);
    }

    const endpoint = endpointFn(params);
    const url = `${this.wpUrl}${endpoint.url}`;

    process.stderr.write(`[mcp-bridge] REST-Fallback: ${endpoint.method} ${endpoint.url}\n`);

    const httpsAgent = this.wpUrl.startsWith('https')
      ? this._getHttpsAgent()
      : null;

    const fetchOpts: Record<string, unknown> = {
      method: endpoint.method,
      headers: {
        'Accept': 'application/json',
        ...this._getAuthHeaders(),
      },
      signal: AbortSignal.timeout(this.timeout),
    };

    if (endpoint.body && endpoint.method !== 'GET') {
      (fetchOpts.headers as Record<string, string>)['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(endpoint.body);
    }

    if (httpsAgent) {
      fetchOpts.agent = httpsAgent;
    }

    const res = await fetch(url, fetchOpts as RequestInit);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `REST HTTP ${res.status} für "${ability}": ${text.slice(0, 300)}`
      );
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ── Spezialisierte Methoden ──────────────────────────────────────────────

  async batchMediaUpload(files: Array<{filename: string; mime_type: string; content_base64: string}>): Promise<unknown> {
    if (!Array.isArray(files) || files.length === 0) {
      return { results: [] };
    }

    this._log(`Batch-Media-Upload: ${files.length} Dateien...`);

    return this.call('novamira/adrians-batch-media-upload', { files }, {
      cache: false,
      maxRetries: 1,
    });
  }

  // ── Internal Helpers ─────────────────────────────────────────────────────

  _getAuthHeaders(): Record<string, string> {
    if (this._authHeader) {
      return { Authorization: this._authHeader };
    }
    return {};
  }

  _log(message: string): void {
    if (this.verbose || process.env.MCP_VERBOSE === '1') {
      process.stderr.write(`[mcp-bridge] ${message}\n`);
    }
  }
}

export default McpBridge;

// ── Self-Test ─────────────────────────────────────────────────────────────────
// node --import tsx scripts/lib/mcp-bridge.ts --self-test

if (process.argv.includes('--self-test')) {
  (async () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║       framer-v4-pipeline-v2 — MCP Bridge v4.0.0             ║
║       Fix A: JSON-RPC 2.0 + Session-Handshake              ║
╚══════════════════════════════════════════════════════════════╝
`);

    const configPath = findMcpConfig();
    if (configPath) {
      console.log(`✅ Config gefunden: ${configPath}`);
    } else {
      console.log('⚠️  Keine .mcp.json gefunden — prüfe Umgebungsvariablen.');
    }

    let bridge: McpBridge;
    try {
      bridge = await McpBridge.fromConfig();
      console.log(`✅ Bridge initialisiert`);
      console.log(`   MCP URL: ${bridge.mcpUrl}`);
      console.log(`   Auth:    ${bridge._authHeader ? 'Konfiguriert' : 'NICHT konfiguriert'}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`❌ Bridge-Init fehlgeschlagen: ${errMsg}`);
      console.log(`
📋 Konfigurations-Guide:
   Erstelle eine .mcp.json im Projekt-Root:

   {
     "mcpServers": {
       "novamira-yoursite-local": {
         "url": "http://yoursite.local/wp-json/mcp/novamira",
         "headers": {
           "Authorization": "Basic <base64-von-user:app-password>"
         }
       }
     }
   }

   ODER setze Umgebungsvariablen:
   WP_API_URL=http://yoursite.local/wp-json/mcp/novamira
   WP_API_USERNAME=Adrian
   WP_API_PASSWORD=<app-password>
`);
      process.exit(1);
    }

    console.log('\n🔌 Teste Verbindung (novamira/adrians-greet)...');
    try {
      const greeting = await bridge.call('novamira/adrians-greet', { name: 'Pipeline-Smoke-Test' });
      console.log(`✅ Verbindung OK: ${JSON.stringify(greeting).slice(0, 200)}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`❌ Verbindungstest fehlgeschlagen: ${errMsg}`);
      console.log(`
🔧 Troubleshooting:
   1. Läuft der MCP-Server auf yoursite.local?
   2. Ist das App-Password gültig? (WordPress → Benutzer → Application Passwords)
   3. TLS-Problem bei https? Setze NODE_TLS_REJECT_UNAUTHORIZED=0
   4. Firewall/Netzwerk: Kann dein Rechner yoursite.local erreichen?
`);
      process.exit(2);
    }

    console.log('\n📦 Teste Cache (export-design-system — read-only)...');
    const startCached = Date.now();
    await bridge.call('novamira/adrians-export-design-system', {});
    const cachedDuration = Date.now() - startCached;
    console.log(`   Erster Call: ${cachedDuration}ms`);

    const startCached2 = Date.now();
    await bridge.call('novamira/adrians-export-design-system', {});
    const cachedDuration2 = Date.now() - startCached2;
    console.log(`   Zweiter Call: ${cachedDuration2}ms ${cachedDuration2 < 100 ? '(✅ gecacht)' : '(⚠️ nicht gecacht)'}`);

    console.log('\n✅ Alle Checks bestanden — MCP Bridge ist bereit.\n');
    process.exit(0);
  })();
}
