/**
 * Vision QA — semantische Screenshot-Analyse via Anthropic Vision API.
 *
 * Vergleicht zwei Screenshots (Original vs. Clone) und gibt strukturiertes
 * Feedback zurück: Score 0–100, typisierte Issues, freier Kommentar.
 *
 * Design:
 * - `callApi` ist injizierbar → echte Tests ohne HTTP.
 * - API-Key kommt aus `options.apiKey` oder `process.env.ANTHROPIC_API_KEY`.
 * - Alle Issue-Types/Severities sind kompatibel mit `issue-detector.ts`.
 *
 * REFACTORED (Modul AI1): prompt text, response parsing, and the default
 * direct-fetch Claude call now live in `ai-engine/tasks/vision-qa.task.ts`
 * so every AI task shares one implementation. This file keeps its exact
 * public API and behavior; it just delegates. An optional `router` can be
 * passed to route the call through the central `AIRouter` instead of
 * calling Anthropic directly — if neither `callApi` nor `router` is given,
 * behavior is unchanged from before this refactor.
 */

import { promises as fs } from 'node:fs';
import type { IssueType } from './issue-detector.js';
import type { IssueSeverity } from './strictness.js';
import type { AIRouter } from '@elconv/core';
import {
  ratingFromScore,
  parseVisionQAResponse,
  defaultClaudeVisionQaCall,
  runVisionQA,
} from '@elconv/core';

export type VisionMatchRating = 'excellent' | 'good' | 'fair' | 'poor';

export interface VisionIssue {
  type: IssueType;
  severity: IssueSeverity;
  location: string;
  description: string;
  suggestedFix: string;
}

export interface VisionQaResult {
  overallScore: number;
  matchRating: VisionMatchRating;
  issues: VisionIssue[];
  semanticFeedback: string;
  computedAt: string;
}

/**
 * Injectable API-Funktion für Tests.
 * Erhält beide Bilder als base64-Strings und gibt den rohen Modell-Text zurück.
 */
export type VisionApiCallFn = (
  originalBase64: string,
  cloneBase64: string,
  mediaType: 'image/png' | 'image/jpeg',
) => Promise<string>;

export interface VisionQaOptions {
  originalPath: string;
  clonePath: string;
  sourceUrl?: string;
  cloneUrl?: string;
  apiKey?: string;
  /** Override für Tests — wenn gesetzt, wird kein echter API-Call gemacht. */
  callApi?: VisionApiCallFn;
  /**
   * Optional: route the call through the central AI Engine instead of a
   * direct Anthropic fetch. Ignored if `callApi` is set. If neither is
   * set, falls back to the original direct-fetch behavior (unchanged).
   */
  router?: AIRouter;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analysiert zwei Screenshot-Dateien semantisch via Anthropic Vision.
 *
 * @example
 * const result = await runVisionQa({
 *   originalPath: 'qa/original.png',
 *   clonePath: 'qa/clone.png',
 * });
 * console.log(result.overallScore, result.matchRating, result.issues.length);
 */
export async function runVisionQa(options: VisionQaOptions): Promise<VisionQaResult> {
  const [originalBuf, cloneBuf] = await Promise.all([
    fs.readFile(options.originalPath),
    fs.readFile(options.clonePath),
  ]);

  const originalBase64 = originalBuf.toString('base64');
  const cloneBase64 = cloneBuf.toString('base64');
  const mediaType = options.originalPath.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';

  if (!options.callApi && options.router) {
    // Delegate entirely to the AI Engine task. Its response is parsed via
    // the same `parseVisionQAResponse()` used below, so the issue
    // type/severity values are already validated against the same literal
    // sets as `VisionIssue` — safe to treat as VisionQaResult here.
    // `callApi` (if provided) always takes priority over `router`, matching
    // the pre-existing test override behavior.
    const result = await runVisionQA(options.router, {
      originalPath: options.originalPath,
      clonePath: options.clonePath,
    });
    return {
      overallScore: result.overallScore,
      matchRating: result.matchRating,
      issues: result.issues as VisionIssue[],
      semanticFeedback: result.semanticFeedback,
      computedAt: result.computedAt,
    };
  }

  let rawText: string;
  if (options.callApi) {
    rawText = await options.callApi(originalBase64, cloneBase64, mediaType);
  } else {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Vision QA (set env var or pass options.apiKey)');
    }
    rawText = await defaultClaudeVisionQaCall(originalBase64, cloneBase64, mediaType, apiKey);
  }

  const { score, issues, feedback } = parseVisionQAResponse(rawText);
  return {
    overallScore: score,
    matchRating: ratingFromScore(score),
    issues,
    semanticFeedback: feedback,
    computedAt: new Date().toISOString(),
  };
}
