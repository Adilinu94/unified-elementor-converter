/**
 * AI Engine — Repair Block Task (Modul AI2).
 *
 * Sends full context (screenshots, HTML, computed CSS, diff hotspot,
 * parent/siblings, token constraints) to the AI so it can propose a fix
 * for a single mismatched block, instead of guessing from a Vision-QA
 * issue description alone.
 *
 * NOTE on `REPAIR_BLOCK_PROMPT`: UMBAUPLAN.md §7/Modul AI2 sketches the
 * prompt as a template literal with embedded `${input => ...}` arrow
 * functions — that isn't valid JS (a template literal can't contain a
 * function and defer its evaluation). `buildRepairBlockPrompt()` below is
 * the real implementation: a plain function that interpolates the actual
 * `RepairBlockInput` values into the prompt text.
 */
import type { AIRouter, RepairBlockInput, RepairResult, RepairBlockViaAIFn } from '../../contracts/ai.contract.js';

export function buildRepairBlockPrompt(input: RepairBlockInput): string {
  const hotspotLine = input.diffHotspot
    ? `- Diff-Hotspot (Bereich mit größtem Unterschied): ${JSON.stringify(input.diffHotspot)}`
    : '';

  const constraintColors = input.tokenConstraints?.colors.map((c) => c.hex) ?? [];

  return `Du reparierst einen fehlerhaften Elementor-Block, damit er visuell mit dem Original übereinstimmt.

KONTEXT:
- Original-Screenshot: [IMAGE 1]
- Aktueller Clone-Screenshot (FEHLERHAFT): [IMAGE 2]
${hotspotLine}

ELEMENT-INFO:
- Typ: ${input.elementType}
- HTML: \`\`\`html
${input.html}
\`\`\`
- Computed CSS: \`\`\`json
${JSON.stringify(input.computedCss, null, 2)}
\`\`\`

UMGEBUNG:
- Parent: ${input.parentHtml ?? '(kein)'}
- Geschwister: ${input.siblingHtml?.join(', ') ?? '(keine)'}

DESIGN-CONSTRAINTS (AUSSCHLIESSLICH diese verwenden):
${JSON.stringify(constraintColors, null, 2)}
Verfügbare Global Classes: ${input.existingClasses?.join(', ') ?? '(keine)'}

AUFGABE:
Erzeuge ein korrigiertes Elementor-JSON für diesen Block, das visuell zum Original passt.
Verwende AUSSCHLIESSLICH Farben/Schriften/Spacing aus den Design-Constraints.
Wenn eine Constraint-Farbe nicht passt, wähle die ähnlichste aus.

ANTWORT (nur JSON, kein Markdown):
{
  "settings": { ... },
  "styles": { ... },
  "classes": ["string"],
  "explanation": "kurze Erklärung was geändert wurde und warum"
}`;
}

function parseRepairResponse(text: string, attemptsUsed: number): RepairResult {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const hasContent = typeof parsed['settings'] === 'object' || typeof parsed['styles'] === 'object';
    return {
      success: hasContent,
      settings: (parsed['settings'] as Record<string, unknown>) ?? undefined,
      styles: (parsed['styles'] as Record<string, unknown>) ?? undefined,
      classes: Array.isArray(parsed['classes']) ? (parsed['classes'] as string[]) : undefined,
      explanation: typeof parsed['explanation'] === 'string' ? parsed['explanation'] : '',
      attemptsUsed,
    };
  } catch {
    return {
      success: false,
      explanation: `AI-Antwort war kein gültiges JSON: ${text.slice(0, 120)}`,
      attemptsUsed,
    };
  }
}

/** Sends one repair attempt to the AI Engine. Does not retry — retry/attempt counting lives in the caller (see `runFullContextRepair` in `src/qa/healing-loop.ts`). */
export const repairBlockViaAI: RepairBlockViaAIFn = async (
  router: AIRouter,
  input: RepairBlockInput,
): Promise<RepairResult> => {
  const response = await router.execute({
    name: 'repair-block',
    prompt: buildRepairBlockPrompt(input),
    images: [
      { path: input.originalScreenshotPath, label: 'Original' },
      { path: input.cloneScreenshotPath, label: 'Clone' },
    ],
    context: { elementType: input.elementType },
  });

  return parseRepairResponse(response.text, 1);
};
