/**
 * AI Engine — Section Classification Task.
 *
 * Single source of truth for the "what kind of UI section is this?" prompt.
 * Used by:
 * - `src/classifier/detect-by-vision.ts` (Modul A2, Schicht 2 — component
 *   detection) via its own injectable `VisionCallFn` signature.
 * - `src/classifier/section-picker.ts` (Modul P1 — parser vision enhancement)
 *   via `runSectionClassification()` directly against an `AIRouter`.
 *
 * Per UMBAUPLAN.md §6 / Modul A2 (Schicht 2) for the prompt wording.
 */
import type { AIRouter } from '../../contracts/ai.contract.js';
import type { ConfidentResult } from '../../contracts/index.js';

export interface SectionClassification {
  type: string;
  layoutDescription: string;
  primaryContentType: string;
}

export const SECTION_CLASSIFY_PROMPT = `Du klassifizierst UI-Sektionen einer Webseite.
Betrachte das Bild und antworte NUR mit folgendem JSON:
{
  "type": "<einer von: hero|features|pricing|testimonial|faq|cta|nav|footer|gallery|blog-list|contact|team|stats|logo-grid|content|unknown>",
  "confidence": <0.0-1.0>,
  "layoutDescription": "<kurze Beschreibung, z.B. 'großes Bild links, Text und CTA rechts'>",
  "primaryContentType": "<hauptinhalt, z.B. 'Produktbild, Headline, Button'>"
}

Klassifikationshilfe:
- hero: Erste Sektion, großes Bild/Video, Headline + CTA
- features: 3-6 Karten mit Icon + Text
- pricing: 2-4 Preis-Pläne nebeneinander
- testimonial: Zitate mit Avatar
- faq: Frage-Antwort-Paare
- cta: Alleinstehende Handlungsaufforderung
- nav: Navigationsleiste
- footer: Fußzeile mit Links/Kontakt
- gallery: Bildergalerie (3+ Bilder)
- stats: Zahlen/Statistiken in Reihe`;

function parseClassification(text: string): { classification: SectionClassification; confidence: number } | null {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const confidence = typeof parsed['confidence'] === 'number'
      ? Math.max(0, Math.min(1, parsed['confidence']))
      : 0;
    return {
      classification: {
        type: typeof parsed['type'] === 'string' ? parsed['type'] : 'unknown',
        layoutDescription: typeof parsed['layoutDescription'] === 'string' ? parsed['layoutDescription'] : '',
        primaryContentType: typeof parsed['primaryContentType'] === 'string' ? parsed['primaryContentType'] : '',
      },
      confidence,
    };
  } catch {
    return null;
  }
}

/**
 * Classifies a (already-cropped) section screenshot via the AI Engine.
 * Returns `confidence: 0` and `type: 'unknown'` if the response can't be parsed.
 */
export async function runSectionClassification(
  router: AIRouter,
  sectionScreenshotPath: string,
): Promise<ConfidentResult<SectionClassification>> {
  const response = await router.execute({
    name: 'section-classify',
    prompt: SECTION_CLASSIFY_PROMPT,
    images: [{ path: sectionScreenshotPath, label: 'Section' }],
  });

  const result = parseClassification(response.text);
  if (!result) {
    return {
      value: { type: 'unknown', layoutDescription: '', primaryContentType: '' },
      confidence: 0,
    };
  }
  return { value: result.classification, confidence: result.confidence };
}
