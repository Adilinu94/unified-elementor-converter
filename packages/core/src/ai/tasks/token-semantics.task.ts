/**
 * AI Engine — Token Semantics Task.
 *
 * Asks the AI to name the semantic role of a design token (e.g. is this
 * color a "primary" brand color, an "accent", or a neutral/background
 * shade?). Consumed by Agent C's token-constraint system when a raw color
 * doesn't have an obvious name from CSS variables alone.
 */
import type { AIRouter } from '../../contracts/ai.contract.js';
import type { ConfidentResult } from '../../contracts/index.js';

export interface TokenSemanticsInput {
  hex: string;
  /** Other colors present in the same design system, for contrast. */
  contextColors?: string[];
}

export interface TokenSemanticsResult {
  role: 'primary' | 'secondary' | 'accent' | 'neutral' | 'background' | 'text' | 'unknown';
  reasoning: string;
}

const TOKEN_SEMANTICS_PROMPT = `Du bestimmst die semantische Rolle einer Design-Farbe innerhalb eines Farbsystems.
Antworte NUR mit folgendem JSON:
{
  "role": "<einer von: primary|secondary|accent|neutral|background|text|unknown>",
  "confidence": <0.0-1.0>,
  "reasoning": "<kurze Begründung>"
}`;

function parseResult(text: string): { role: TokenSemanticsResult['role']; reasoning: string; confidence: number } | null {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const validRoles = new Set(['primary', 'secondary', 'accent', 'neutral', 'background', 'text', 'unknown']);
    const role = typeof parsed['role'] === 'string' && validRoles.has(parsed['role'])
      ? (parsed['role'] as TokenSemanticsResult['role'])
      : 'unknown';
    const confidence = typeof parsed['confidence'] === 'number' ? Math.max(0, Math.min(1, parsed['confidence'])) : 0;
    return {
      role,
      reasoning: typeof parsed['reasoning'] === 'string' ? parsed['reasoning'] : '',
      confidence,
    };
  } catch {
    return null;
  }
}

export function inferDeterministicTokenRole(hex: string): { role: TokenSemanticsResult['role']; confidence: number } | null {
  const c = hex.replace('#', '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(c)) return null;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (sat < 0.08 && lum > 0.92) return { role: 'background', confidence: 0.78 };
  if (sat < 0.08 && lum < 0.12) return { role: 'text', confidence: 0.78 };
  if (sat < 0.06) return { role: 'neutral', confidence: 0.62 };
  return null;
}

export async function runTokenSemantics(
  router: AIRouter,
  input: TokenSemanticsInput,
  options: { minConfidence?: number; deterministicGate?: boolean } = {},
): Promise<ConfidentResult<TokenSemanticsResult>> {
  const minConfidence = options.minConfidence ?? 0.6;
  const useGate = options.deterministicGate ?? false;
  const det = useGate ? inferDeterministicTokenRole(input.hex) : null;
  if (det && det.confidence >= minConfidence) {
    return { value: { role: det.role, reasoning: 'deterministic' }, confidence: det.confidence };
  }
  if (router && typeof (router as unknown as { isBreakerOpen?: () => boolean }).isBreakerOpen === 'function') {
    if ((router as unknown as { isBreakerOpen: () => boolean }).isBreakerOpen()) {
      const fallbackRole = det?.role ?? 'unknown';
      return { value: { role: fallbackRole, reasoning: 'breaker-open' }, confidence: det?.confidence ?? 0 };
    }
  }
  const response = await router.execute({
    name: 'token-semantics',
    prompt: TOKEN_SEMANTICS_PROMPT,
    context: { hex: input.hex, contextColors: input.contextColors ?? [] },
  });

  const result = parseResult(response.text);
  if (!result) {
    return { value: { role: det?.role ?? 'unknown', reasoning: '' }, confidence: 0 };
  }
  return { value: { role: result.role, reasoning: result.reasoning }, confidence: result.confidence };
}
