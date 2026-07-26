/**
 * scripts/lib/unframer-bridge.ts  —  v1.0.0
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CircuitBreaker, type CircuitBreakerCallbacks } from '../lib/circuit-breaker.js';
import { Idempotency } from '../lib/idempotency.js';
import { BatchScheduler, type ScheduleOptions } from '../lib/batch-scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface UnframerBridgeOptions {
  url: string;
  id: string;
  secret: string;
  timeout?: number;
  concurrency?: number;
  verbose?: boolean;
  /** Optionaler CircuitBreaker fuer Fail-Fast-Schutz (UMBAUPLAN Phase 7) */
  circuitBreaker?: CircuitBreaker;
  /** CircuitBreaker-Callbacks (nur wenn kein Breaker uebergeben wird) */
  circuitBreakerCallbacks?: CircuitBreakerCallbacks;
  /** Optionaler Idempotency-Modul fuer Call-Dedup (UMBAUPLAN Phase 7b) */
  idempotency?: Idempotency;
  /** Optionaler BatchScheduler fuer priorisierte Ausfuehrung (UMBAUPLAN Phase 7c) */
  batchScheduler?: BatchScheduler;
}

export interface ParallelCallResult<T = unknown> {
  status: 'fulfilled';
  value: T;
  tool: string;
}

export interface ParallelCallError {
  status: 'rejected';
  reason: Error;
  tool: string;
}

type ParallelCallEntry<T = unknown> = ParallelCallResult<T> | ParallelCallError;

function readEnvFile(): Record<string, string> {
  const projectRoot = join(__dirname, '..', '..');
  const candidates = [
    join(projectRoot, '.env.local'),
    join(projectRoot, '.env'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const env: Record<string, string> = {};
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  }
  return {};
}

function maskSecret(s: string): string {
  if (!s) return '(leer)';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export class UnframerBridge {
  url: string;
  id: string;
  secret: string;
  timeout: number;
  verbose: boolean;
  defaultConcurrency: number;
  private _requestCounter: number;
  private _circuitBreaker: CircuitBreaker | null = null;
  private _idempotency: Idempotency | null = null;
  private _batchScheduler: BatchScheduler | null = null;

  constructor(options: UnframerBridgeOptions = { url: '', id: '', secret: '' }) {
    this.url = options.url || '';
    this.id = options.id || '';
    this.secret = options.secret || '';
    this.timeout = options.timeout || 60000;
    this.verbose = options.verbose || (process.env.UNFRAMER_VERBOSE === '1');
    this._requestCounter = 0;
    this.defaultConcurrency = options.concurrency
      || parseInt(process.env.UNFRAMER_CONCURRENCY || '3', 10);

    // Circuit Breaker Integration (UMBAUPLAN Phase 7)
    if (options.circuitBreaker) {
      this._circuitBreaker = options.circuitBreaker;
    } else if (process.env.CB_UNFRAMER_ENABLED === '1') {
      this._circuitBreaker = new CircuitBreaker(
        { name: 'unframer', failureThreshold: 5 },
        options.circuitBreakerCallbacks || {},
      );
    }

    // Idempotency Integration (UMBAUPLAN Phase 7b)
    if (options.idempotency) {
      this._idempotency = options.idempotency;
    } else if (process.env.IDEM_UNFRAMER_ENABLED === '1') {
      this._idempotency = new Idempotency({ name: 'unframer' });
    }

    // BatchScheduler Integration (UMBAUPLAN Phase 7c)
    if (options.batchScheduler) {
      this._batchScheduler = options.batchScheduler;
    } else if (process.env.BS_UNFRAMER_ENABLED === '1') {
      this._batchScheduler = new BatchScheduler({
        name: 'unframer',
        concurrency: this.defaultConcurrency,
      });
    }
  }

  static fromEnv(): UnframerBridge | null {
    const env = readEnvFile();
    const merged = {
      UNFRAMER_MCP_URL:    process.env.UNFRAMER_MCP_URL    || env.UNFRAMER_MCP_URL,
      UNFRAMER_MCP_ID:     process.env.UNFRAMER_MCP_ID     || env.UNFRAMER_MCP_ID,
      UNFRAMER_MCP_SECRET: process.env.UNFRAMER_MCP_SECRET || env.UNFRAMER_MCP_SECRET,
    };
    if (!merged.UNFRAMER_MCP_URL || !merged.UNFRAMER_MCP_ID || !merged.UNFRAMER_MCP_SECRET) {
      return null;
    }
    return new UnframerBridge({
      url: merged.UNFRAMER_MCP_URL,
      id: merged.UNFRAMER_MCP_ID,
      secret: merged.UNFRAMER_MCP_SECRET,
    });
  }

  static fromCredentials(url: string, id: string, secret: string): UnframerBridge {
    return new UnframerBridge({ url, id, secret });
  }

  static isConfigured(): boolean {
    const bridge = UnframerBridge.fromEnv();
    return bridge !== null;
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

  _buildAuthUrl(_sessionId: string | null = null): string {
    const u = new URL(this.url);
    u.searchParams.set('id', this.id);
    u.searchParams.set('secret', this.secret);
    return u.toString();
  }

  async call(method: string, params: Record<string, unknown> = {}, options: { maxRetries?: number } = {}): Promise<unknown> {
    // Layering: Idempotency (inner) → CircuitBreaker (middle) → _callInternal (core)
    const rawCall = () => this._callInternal(method, params, options);

    const idempotentCall = this._idempotency
      ? () => this._idempotency!.call(rawCall, method, params)
      : rawCall;

    if (this._circuitBreaker) {
      return this._circuitBreaker.call(idempotentCall);
    }
    return idempotentCall();
  }

  /** Interne Call-Implementierung (ohne CircuitBreaker-Wrapper). */
  private async _callInternal(method: string, params: Record<string, unknown> = {}, options: { maxRetries?: number } = {}): Promise<unknown> {
    const maxRetries = options.maxRetries ?? 2;
    const id = ++this._requestCounter;

    const body = { jsonrpc: '2.0', id, method, params };

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(this._buildAuthUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeout),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} fuer "${method}": ${text.slice(0, 300)}`);
        }

        const text = await res.text();
        const json = this._parseResponse(text);

        if (json?.error) {
          throw new Error(`RPC ${json.error.code || '?'}: ${json.error.message || 'Unbekannt'}`);
        }

        return json?.result ?? json;
      } catch (err: unknown) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (lastErr.message.includes('HTTP 4') &&
            !lastErr.message.includes('HTTP 408') &&
            !lastErr.message.includes('HTTP 429')) {
          throw lastErr;
        }
        if (err instanceof SyntaxError) throw err;
        if (lastErr.name === 'TimeoutError' || lastErr.name === 'AbortError') throw lastErr;

        if (attempt < maxRetries) {
          const delay = Math.min(500 * Math.pow(2, attempt), 4000);
          this._log(`Retry ${attempt + 1}/${maxRetries} in ${delay}ms: ${lastErr.message.slice(0, 100)}`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastErr!;
  }

  _parseResponse(text: string): { result?: unknown; error?: { code: number; message: string } } | null {
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try { return JSON.parse(text); } catch {}
    }
    if (text.startsWith('data:')) {
      const dataLine = text.split('\n').find(l => l.startsWith('data:'));
      if (dataLine) {
        try { return JSON.parse(dataLine.slice(5).trim()); } catch {}
      }
    }
    return null;
  }

  async callTool(toolName: string, args: Record<string, unknown> = {}, options: { maxRetries?: number } = {}): Promise<unknown> {
    // CB-Schutz erfolgt ueber this.call() — kein doppelter Wrapper noetig
    const result = await this.call('tools/call', { name: toolName, arguments: args }, options) as { content?: Array<{ type: string; text: string }> };

    if (result?.content && Array.isArray(result.content)) {
      const textBlocks = result.content.filter(b => b.type === 'text');
      if (textBlocks.length === 1) {
        const txt = textBlocks[0].text;
        try { return JSON.parse(txt); } catch { return txt; }
      }
      if (textBlocks.length > 1) {
        return textBlocks.map(b => {
          try { return JSON.parse(b.text); } catch { return b.text; }
        });
      }
    }
    return result;
  }

  async callToolsParallel(calls: Array<{ tool: string; args?: Record<string, unknown>; priority?: number }>, options: { concurrency?: number } = {}): Promise<ParallelCallEntry[]> {
    if (!Array.isArray(calls) || calls.length === 0) return [];

    // ── BatchScheduler Mode (UMBAUPLAN Phase 7c) ─────────────────────────
    const hasPriorities = calls.some(c => c.priority !== undefined);
    if (this._batchScheduler && hasPriorities) {
      return this._callToolsParallelViaScheduler(calls, options);
    }

    // ── Worker-Pool Mode (mit Idempotency+CB via this.callTool() → this.call()) ──
    const concurrency = Math.max(1, options.concurrency ?? this.defaultConcurrency);

    const results: ParallelCallEntry[] = new Array(calls.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < calls.length) {
        const idx = cursor++;
        const c = calls[idx];
        try {
          const value = await this.callTool(c.tool, c.args || {});
          results[idx] = { status: 'fulfilled' as const, value, tool: c.tool };
        } catch (reason) {
          results[idx] = { status: 'rejected' as const, reason: reason instanceof Error ? reason : new Error(String(reason)), tool: c.tool };
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, calls.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  /**
   * callToolsParallel ueber BatchScheduler — priorisierte Ausfuehrung.
   * Tools ohne Priority bekommen default=5.
   */
  private async _callToolsParallelViaScheduler(
    calls: Array<{ tool: string; args?: Record<string, unknown>; priority?: number }>,
    _options: { concurrency?: number },
  ): Promise<ParallelCallEntry[]> {
    const bs = this._batchScheduler!;

    this._log(`callToolsParallel: ${calls.length} tools via BatchScheduler (concurrency=${bs.concurrency}, with priorities)`);

    const results: ParallelCallEntry[] = new Array(calls.length);

    const bsResults = await bs.scheduleAll(
      calls.map((c, i) => ({
        fn: () => this.callTool(c.tool, c.args || {}),
        options: {
          priority: c.priority ?? 5,
          ability: c.tool,
          params: c.args || {},
          maxRetries: 0,  // this.callTool() → this.call() hat bereits eigene Retry-Logik
        } as ScheduleOptions,
      })),
    );

    for (let i = 0; i < bsResults.length; i++) {
      const r = bsResults[i];
      if (r.status === 'fulfilled') {
        results[i] = { status: 'fulfilled' as const, value: r.value, tool: calls[i].tool };
      } else {
        results[i] = {
          status: 'rejected' as const,
          reason: r.reason instanceof Error ? r.reason : new Error(String(r.reason)),
          tool: calls[i].tool,
        };
      }
    }

    return results;
  }

  _log(msg: string): void {
    if (this.verbose) {
      process.stderr.write(`[unframer-bridge] ${msg}\n`);
    }
  }

  logConfigSummary(): void {
    const u = new URL(this.url);
    process.stderr.write(
      `[unframer-bridge] Configured: ${u.protocol}//${u.host}${u.pathname}\n` +
      `[unframer-bridge]   id:     ${maskSecret(this.id)}\n` +
      `[unframer-bridge]   secret: ${maskSecret(this.secret)}\n`
    );
  }
}

export default UnframerBridge;
