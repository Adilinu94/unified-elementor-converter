/**
 * src/types/novamira.ts
 * Novamira MCP Server Typdefinitionen.
 *
 * Deckt ab:
 *   - McpBridge-Optionen & Config
 *   - MCP Call/Response-Typen
 *   - WordPress REST-API-Typen
 */

import type { CircuitBreaker, CircuitBreakerCallbacks } from '../../scripts/lib/circuit-breaker.js';
import type { Idempotency } from '../../scripts/lib/idempotency.js';
import type { BatchScheduler } from '../../scripts/lib/batch-scheduler.js';

// ── MCP Config Types ─────────────────────────────────────────────────────────

export interface McpConfigResult {
  mcpUrl: string;
  authHeader: string | null;
  wpUrl: string;
  serverKey: string;
}

export interface McpBridgeOptions {
  mcpUrl?: string;
  authHeader?: string | null;
  wpUrl?: string;
  timeout?: number;
  concurrency?: number;
  verbose?: boolean;
  circuitBreaker?: CircuitBreaker;
  circuitBreakerCallbacks?: CircuitBreakerCallbacks;
  idempotency?: Idempotency;
  batchScheduler?: BatchScheduler;
}

// ── MCP Call Types ───────────────────────────────────────────────────────────

export interface CallOptions {
  cache?: boolean;
  maxRetries?: number;
}

export interface CallItem {
  ability: string;
  params?: Record<string, unknown>;
  /** Prioritaet fuer BatchScheduler (0=hoechste, 10=niedrigste, default=5) */
  priority?: number;
}

export interface ParallelResult {
  status: 'fulfilled' | 'rejected';
  value?: unknown;
  reason?: unknown;
  ability: string;
}

export interface CacheEntry {
  data: unknown;
  expiry: number;
}

export interface RestEndpoint {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

// ── MCP JSON-RPC Types ───────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ── Tool Result Types ────────────────────────────────────────────────────────

export interface ToolCallResult {
  content?: Array<ToolContentBlock>;
  isError?: boolean;
}

export interface ToolContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

// ── WordPress REST Types ─────────────────────────────────────────────────────

export interface WpPost {
  ID: number;
  post_title: string;
  post_status: string;
  post_type: string;
  post_content?: string;
  post_name?: string;
  post_date?: string;
  post_modified?: string;
}

export interface WpMediaItem {
  id: number;
  source_url: string;
  mime_type: string;
  title: { rendered: string };
  alt_text?: string;
}

export interface DesignSystemExport {
  variables: Record<string, unknown>;
  classes: Record<string, unknown>;
  theme: Record<string, unknown>;
}

// ── Ability Parameter Types ──────────────────────────────────────────────────

export interface BatchBuildPageParams {
  post_id: number;
  tree: Record<string, unknown>;
  options?: { validate?: boolean; publish?: boolean };
}

export interface BatchMediaUploadParams {
  files: Array<{ filename: string; mime_type: string; content_base64: string }>;
}

export interface BatchCreateVariablesParams {
  variables: Array<{ name: string; type: string; value: unknown }>;
}

export interface SetupV4FoundationParams {
  post_id: number;
  theme?: string;
  settings?: Record<string, unknown>;
}
