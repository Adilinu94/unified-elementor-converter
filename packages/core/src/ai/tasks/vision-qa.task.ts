/**
 * AI Engine — Vision QA Task.
 *
 * Extracted from `src/qa/vision-qa.ts` (formerly `SYSTEM_PROMPT` +
 * `defaultCallApi`, lines 57-82 / 156-194 in the pre-refactor version).
 * `src/qa/vision-qa.ts` keeps its public `runVisionQa()` API for backward
 * compatibility and delegates here; new callers can use `runVisionQA()`
 * (capital QA, matches the `RunVisionQAFn` contract) directly against an
 * `AIRouter`.
 *
 * IMPORTANT: the parsing logic here (`parseVisionQAResponse`) is the single
 * source of truth used by every call path (`callApi` override, `router`,
 * and the legacy direct-fetch default) — this is what guarantees the
 * refactor is behavior-neutral.
 */
import { promises as fs } from 'node:fs';
import type { AIRouter, VisionQAResult, RunVisionQAFn } from '../../contracts/ai.contract.js';

// IssueType/IssueSeverity are the canonical QA issue-classification string
// unions. They live here (in @elconv/core) rather than being imported from
// @elconv/qa's issue-detector.ts/strictness.ts: core must not depend on qa
// (that would be a package cycle — qa depends on core). The Phase 40 qa port
// re-uses these same unions; the cross-package VisionQAResult contract
// intentionally widens `type`/`severity` to `string`.
export type IssueType =
  | 'color-mismatch'
  | 'layout-shift'
  | 'font-missing'
  | 'size-mismatch'
  | 'image-broken'
  | 'animation-inactive'
  | 'blank-region'
  | 'size-different'
  | 'missing-texture';
export type IssueSeverity = 'low' | 'medium' | 'high';

export type VisionMatchRating = 'excellent' | 'good' | 'fair' | 'poor';

export interface VisionIssue {
  type: IssueType;
  severity: IssueSeverity;
  location: string;
  description: string;
  suggestedFix: string;
}

export const VISION_QA_PROMPT = `You are a visual QA expert for website cloning pipelines.
You receive two screenshots: the FIRST image is the ORIGINAL website, the SECOND is the CLONE built in WordPress/Elementor.
Respond ONLY with a JSON object — no markdown fences, no preamble, no trailing text.

JSON schema (strict):
{
  "overallScore": <integer 0-100, how well the clone matches the original>,
  "issues": [
    {
      "type": <one of: "color-mismatch"|"layout-shift"|"font-missing"|"size-mismatch"|"image-broken"|"animation-inactive"|"blank-region"|"size-different">,
      "severity": <"high"|"medium"|"low">,
      "location": <short string: e.g. "hero section", "navigation", "footer CTA">,
      "description": <one sentence describing the difference>,
      "suggestedFix": <one sentence suggesting a fix>
    }
  ],
  "semanticFeedback": <2-3 sentences overall assessment>
}

Scoring guide:
- 95-100: Nearly identical, only micro-differences
- 85-94: Good match, minor visual differences
- 70-84: Acceptable, noticeable differences in specific areas
- 0-69: Poor, significant layout/color/content differences

Return issues only for visible, meaningful differences. Return an empty array if the match is excellent.`;

export const VISION_QA_USER_PROMPT = `First image = ORIGINAL. Second image = CLONE. Analyze and return JSON.`;

// ─── Parsing (single source of truth, reused by every call path) ───────────

export function ratingFromScore(score: number): VisionMatchRating {
  if (score >= 95) return 'excellent';
  if (score >= 85) return 'good';
  if (score >= 70) return 'fair';
  return 'poor';
}

function clampScore(score: unknown): number {
  const n = typeof score === 'number' ? score : Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)));
}

const VALID_TYPES = new Set<string>([
  'color-mismatch', 'layout-shift', 'font-missing', 'size-mismatch',
  'image-broken', 'animation-inactive', 'blank-region', 'size-different',
]);
const VALID_SEVERITIES = new Set<string>(['high', 'medium', 'low']);

function parseIssues(raw: unknown): VisionIssue[] {
  if (!Array.isArray(raw)) return [];
  const issues: VisionIssue[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const type = typeof obj['type'] === 'string' && VALID_TYPES.has(obj['type'])
      ? (obj['type'] as IssueType)
      : 'color-mismatch';
    const severity = typeof obj['severity'] === 'string' && VALID_SEVERITIES.has(obj['severity'])
      ? (obj['severity'] as IssueSeverity)
      : 'low';
    issues.push({
      type,
      severity,
      location: typeof obj['location'] === 'string' ? obj['location'] : 'unknown',
      description: typeof obj['description'] === 'string' ? obj['description'] : '',
      suggestedFix: typeof obj['suggestedFix'] === 'string' ? obj['suggestedFix'] : '',
    });
  }
  return issues;
}

export function parseVisionQAResponse(text: string): { score: number; issues: VisionIssue[]; feedback: string } {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {
      score: 0,
      issues: [{
        type: 'blank-region',
        severity: 'high',
        location: 'unknown',
        description: `Vision API returned non-JSON response: ${text.slice(0, 120)}`,
        suggestedFix: 'Check ANTHROPIC_API_KEY and model availability.',
      }],
      feedback: 'Vision analysis failed — response was not valid JSON.',
    };
  }
  return {
    score: clampScore(parsed['overallScore']),
    issues: parseIssues(parsed['issues']),
    feedback: typeof parsed['semanticFeedback'] === 'string' ? parsed['semanticFeedback'] : '',
  };
}

// ─── Legacy direct-call path (kept for vision-qa.ts's no-router fallback) ──

export async function defaultClaudeVisionQaCall(
  originalBase64: string,
  cloneBase64: string,
  mediaType: 'image/png' | 'image/jpeg',
  apiKey: string,
): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: VISION_QA_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: originalBase64 } },
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: cloneBase64 } },
            { type: 'text', text: VISION_QA_USER_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error ${resp.status}: ${await resp.text().catch(() => resp.statusText)}`);
  }

  const data = (await resp.json()) as { content?: Array<{ type: string; text: string }> };
  const block = data.content?.find((b) => b.type === 'text');
  if (!block) throw new Error('No text block in Anthropic API response');
  return block.text;
}

// ─── AIRouter-based entry point (new; matches RunVisionQAFn contract) ──────

export const runVisionQA: RunVisionQAFn = async (
  router: AIRouter,
  options: { originalPath: string; clonePath: string },
): Promise<VisionQAResult> => {
  await Promise.all([fs.access(options.originalPath), fs.access(options.clonePath)]);

  const response = await router.execute({
    name: 'vision-qa',
    prompt: VISION_QA_PROMPT,
    images: [
      { path: options.originalPath, label: 'Original' },
      { path: options.clonePath, label: 'Clone' },
    ],
  });

  const { score, issues, feedback } = parseVisionQAResponse(response.text);
  return {
    overallScore: score,
    matchRating: ratingFromScore(score),
    issues,
    semanticFeedback: feedback,
    computedAt: new Date().toISOString(),
  };
};
