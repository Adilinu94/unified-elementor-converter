/**
 * Extractor types shared across all input adapters.
 */

import type { SourceSpec } from '@elconv/core';

/** Browser extraction is the canonical extraction result consumed by the CLI pipeline. */
export type ExtractionResult = import('./browser/types.js').BrowserExtractionResult;
export type ExtractionOptions = import('./browser/types.js').BrowserExtractionOptions;

export interface ExtractorOptions {
  /** Timeout for network operations (ms) */
  timeoutMs?: number;
  /** Viewport width for screenshot-based extraction */
  viewportWidth?: number;
  /** Whether to extract animations */
  detectAnimations?: boolean;
  /** CSS selectors to ignore */
  ignoreSelectors?: string[];
}

export interface ExtractResult {
  spec: SourceSpec;
  /** Time taken in ms */
  durationMs: number;
  /** Screenshots captured (paths) */
  screenshots?: string[];
}

export interface Extractor {
  readonly name: string;
  extract(input: string, options?: ExtractorOptions): Promise<ExtractResult>;
}
