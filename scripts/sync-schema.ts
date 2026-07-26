#!/usr/bin/env node
/**
 * sync-schema.ts — Phase 0.2 Schema-Dedup (+ Phase 1.2 Retry)
 *
 * Fetches the canonical V4 Property Type Schema from the V2-Plugin's
 * REST endpoint and writes it to schemas/v4-prop-type-schema.json.
 *
 * Uses McpClient (Phase 1.2) for HTTP calls with exponential-backoff
 * retry on 5xx / network errors / timeouts.
 *
 * SOURCE OF TRUTH: wp-json/novamira/v1/prop-schema
 * TARGET:          schemas/v4-prop-type-schema.json
 *
 * Fail-Fast: exit code 1 if the endpoint is unreachable after all
 * retries, returns non-200, or the response is not valid JSON.
 *
 * CRITICAL: This script never calls process.exit(). On Windows,
 * Node's global fetch() (undici) triggers a libuv assertion
 * (UV_HANDLE_CLOSING) when process.exit() runs cleanup. Instead,
 * we set process.exitCode and destroy undici's dispatcher — Node
 * exits naturally when the event loop drains.
 *
 * Usage:
 *   node --import tsx scripts/sync-schema.ts
 *   node --import tsx scripts/sync-schema.ts --url http://yoursite.local
 *   node --import tsx scripts/sync-schema.ts --output schemas/v4-prop-type-schema.json
 *
 * Environment variables:
 *   WP_API_URL  — WordPress REST base URL (falls back to --url arg)
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from './lib/mcp-client.js';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface PropSchema {
  version?: string;
  types?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const { values: raw } = parseArgs({
  options: {
    url:      { type: 'string' },
    output:   { type: 'string' },
    timeout:  { type: 'string', default: '15000' },
    verbose:  { type: 'boolean', default: false },
    help:     { type: 'boolean', default: false },
  },
  strict: false,
});

const urlArg    = raw.url as string | undefined;
const outputArg = raw.output as string | undefined;
const timeoutArg = raw.timeout as string;
const verbose   = (raw.verbose as boolean) ?? false;
const help      = (raw.help as boolean) ?? false;

if (help) {
  process.stdout.write(`
sync-schema.ts — Fetch canonical V4 prop schema from V2-Plugin

USAGE:
  node --import tsx scripts/sync-schema.ts [options]

OPTIONS:
  --url URL      WordPress base URL (e.g. http://yoursite.local)
                 Falls back to WP_API_URL env var
  --output FILE  Output path [default: schemas/v4-prop-type-schema.json]
  --timeout MS   HTTP timeout in ms [default: 15000]
  --verbose      Verbose logging
  --help         This help

ENV:
  WP_API_URL     WordPress REST base URL
`);
  process.exit(0);
}

const log  = (...m: string[]) => { if (verbose) process.stderr.write('[sync-schema] ' + m.join(' ') + '\n'); };
const warn = (...m: string[]) => process.stderr.write('[sync-schema] WARN: ' + m.join(' ') + '\n');

// ─── Config ──────────────────────────────────────────────────────────────────

const WP_BASE_URL  = urlArg || process.env.WP_API_URL || '';
const OUTPUT_PATH  = outputArg
  ? resolve(outputArg)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'v4-prop-type-schema.json');
const TIMEOUT_MS   = parseInt(timeoutArg, 10);
const API_PATH     = '/wp-json/novamira/v1/prop-schema';

// ─── Sentinel for fatal() unwinding ──────────────────────────────────────────

const FATAL = Symbol('fatal');

let _client: McpClient | null   = null;
let _exitCode = 0;

function fatal(m: string, c: number = 1): never {
  process.stderr.write('[sync-schema] FATAL: ' + m + '\n');
  _exitCode = c;
  throw FATAL;
}

// ─── Fetch (Phase 1.2: resilient McpClient) ──────────────────────────────────

interface McpError extends Error {
  status?: number;
}

async function fetchSchema(): Promise<PropSchema> {
  _client = new McpClient(WP_BASE_URL, {
    maxRetries: 3,
    baseDelayMs: 1000,
    timeout: TIMEOUT_MS,
    verbose,
  });
  const client = _client;

  log(`Fetching schema from ${client.baseUrl}${API_PATH} (retry: up to ${client.maxRetries}x)...`);

  let schema: unknown;
  try {
    schema = await client.get(API_PATH);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    const err = e as McpError;
    if (err.status && err.status >= 400) {
      fatal(
        `Server returned HTTP ${err.status} from ${client.baseUrl}${API_PATH}\n` +
        `  Is the Novamira AdrianV2 plugin activated?`
      );
    }
    fatal(
      `Could not reach ${client.baseUrl}${API_PATH}\n` +
      `  ${reason}\n` +
      `  Is the WordPress site running at ${WP_BASE_URL}?`
    );
  }

  if (!schema || typeof schema !== 'object') {
    fatal('Response is not a valid schema object');
  }

  const s = schema as PropSchema;

  if (!s.types || typeof s.types !== 'object') {
    fatal("Schema is missing required 'types' key");
  }
  if (!s.properties || typeof s.properties !== 'object') {
    fatal("Schema is missing required 'properties' key");
  }

  return s;
}

// ─── Write ───────────────────────────────────────────────────────────────────

function writeSchema(schema: PropSchema): void {
  const dir = dirname(OUTPUT_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const json = JSON.stringify(schema, null, 2);
  writeFileSync(OUTPUT_PATH, json, 'utf8');

  log(`Schema written to ${OUTPUT_PATH}`);
  log(`  Version: ${schema.version || 'unknown'}`);
  log(`  Types:   ${Object.keys(schema.types || {}).length}`);
  log(`  Props:   ${Object.keys(schema.properties || {}).length}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!WP_BASE_URL) {
    fatal(
      'No WordPress URL configured. Set --url or WP_API_URL env var.\n' +
      '  Example: node --import tsx scripts/sync-schema.ts --url http://yoursite.local\n' +
      '  Or set:  export WP_API_URL=http://yoursite.local'
    , 2);
  }

  const schema = await fetchSchema();

  const outputDir = dirname(OUTPUT_PATH);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeSchema(schema);

  process.stderr.write(`[sync-schema] ✅ Schema synced from ${WP_BASE_URL}\n`);
  process.stderr.write(`[sync-schema]    Version: ${schema.version || 'unknown'} → ${OUTPUT_PATH}\n`);
}

// ─── Top-Level Runner (no process.exit() — Node exits naturally) ─────────────

main().then(() => {
  // Success path — _exitCode stays 0
}).catch(err => {
  if (err !== FATAL) {
    process.stderr.write('[sync-schema] FATAL: ' + (err instanceof Error ? err.message : String(err)) + '\n');
    if (verbose && err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
    _exitCode = 1;
  }
}).finally(() => {
  if (_client) _client.close();
  process.exitCode = _exitCode;
});
