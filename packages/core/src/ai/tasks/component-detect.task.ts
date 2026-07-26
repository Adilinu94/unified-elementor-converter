/**
 * AI Engine — Component Detection (Vision) Task.
 *
 * Thin wrapper around `section-classify.task.ts` that reshapes the result
 * into the `ComponentDetectionResult` contract shape (Modul A2, Schicht 2).
 * `src/classifier/detect-by-vision.ts` implements the same detection layer
 * with a simpler, directly-injectable `VisionCallFn` signature for unit
 * testing without an `AIRouter` mock; this task is the AIRouter-native
 * entry point for callers that already hold a router instance.
 */
import type { AIRouter, ComponentDetectionResult } from '../../contracts/ai.contract.js';
import { runSectionClassification } from './section-classify.task.js';

export async function runComponentDetectVision(
  router: AIRouter,
  sectionScreenshotPath: string,
): Promise<ComponentDetectionResult> {
  const { value, confidence } = await runSectionClassification(router, sectionScreenshotPath);
  return {
    type: value.type,
    confidence,
    evidence: value.layoutDescription,
    layer: 'vision',
  };
}
