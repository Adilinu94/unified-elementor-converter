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

export async function runTokenSemantics(
  router: AIRouter,
  input: TokenSemanticsInput,
): Promise<ConfidentResult<TokenSemanticsResult>> {
  const response = await router.execute({
    name: 'token-semantics',
    prompt: TOKEN_SEMANTICS_PROMPT,
    context: { hex: input.hex, contextColors: input.contextColors ?? [] },
  });

  const result = parseResult(response.text);
  if (!result) {
    return { value: { role: 'unknown', reasoning: '' }, confidence: 0 };
  }
  return { value: { role: result.role, reasoning: result.reasoning }, confidence: result.confidence };
}
