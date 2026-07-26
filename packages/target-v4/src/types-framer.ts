/**
 * src/types/framer.ts
 * Framer-spezifische Typdefinitionen.
 *
 * Deckt ab:
 *   - Font-Parsing-Typen
 *   - UnframerBridge-Optionen
 *   - Framer Export/Component-Typen
 */

import type { CircuitBreaker, CircuitBreakerCallbacks } from '../../scripts/lib/circuit-breaker.js';
import type { Idempotency } from '../../scripts/lib/idempotency.js';
import type { BatchScheduler, ScheduleOptions } from '../../scripts/lib/batch-scheduler.js';

// ── Font Types ───────────────────────────────────────────────────────────────

export interface ParsedFontPrefix {
  source: string;
  family: string;
  weight: string;
  variant: string;
}

// ── Unframer Bridge Types ────────────────────────────────────────────────────

export interface UnframerBridgeOptions {
  url: string;
  id: string;
  secret: string;
  timeout?: number;
  concurrency?: number;
  verbose?: boolean;
  circuitBreaker?: CircuitBreaker;
  circuitBreakerCallbacks?: CircuitBreakerCallbacks;
  idempotency?: Idempotency;
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

export type ParallelCallEntry<T = unknown> = ParallelCallResult<T> | ParallelCallError;

// ── Framer Component Types ───────────────────────────────────────────────────

export interface FramerComponentNode {
  id: string;
  name: string;
  type: string;
  children?: FramerComponentNode[];
  props?: Record<string, unknown>;
}

export interface FramerExportManifest {
  projectId: string;
  projectName: string;
  pages: FramerPageInfo[];
  components: FramerComponentInfo[];
}

export interface FramerPageInfo {
  id: string;
  name: string;
  path: string;
  url?: string;
}

export interface FramerComponentInfo {
  id: string;
  name: string;
  type: string;
  variants?: Array<{ id: string; name: string }>;
}

// ── Framer XML / Style Types ─────────────────────────────────────────────────

export interface FramerStyleNode {
  tag: string;
  id: string;
  className?: string;
  attrs: Record<string, unknown>;
  children?: FramerStyleNode[];
}

export interface FramerBreakpoint {
  id: string;
  name: string;
  width: number;
  height: number;
}
