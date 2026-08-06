/**
 * Component Detection — Schicht 2: Vision-LLM-Klassifikation.
 *
 * Croppt die Section aus einem Page-Screenshot und lässt ein Vision-Modell
 * beurteilen, um welche Art von UI-Sektion es sich handelt.
 *
 * Portiert aus site-clone-to-v3/src/classifier/detect-by-vision.ts (Phase 45).
 * Anpassung: sharp ist optionale Dependency — ohne sharp wird null zurückgegeben.
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import type { SectionInfo } from '@elconv/core';
import { SECTION_CLASSIFY_PROMPT } from '@elconv/core';

export interface VisionClassificationResult {
  type: string;
  confidence: number;
  layoutDescription: string;
  primaryContentType: string;
}

export type VisionCallFn = (
  sectionScreenshotBase64: string,
  prompt: string,
) => Promise<string>;

function parseVisionClassification(text: string): VisionClassificationResult | null {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (typeof parsed['type'] !== 'string' || typeof parsed['confidence'] !== 'number') return null;
    return {
      type: parsed['type'],
      confidence: Math.max(0, Math.min(1, parsed['confidence'])),
      layoutDescription: typeof parsed['layoutDescription'] === 'string' ? parsed['layoutDescription'] : '',
      primaryContentType: typeof parsed['primaryContentType'] === 'string' ? parsed['primaryContentType'] : '',
    };
  } catch {
    return null;
  }
}

export function isVisionLayerReachable(input: { pageScreenshotPath?: string; callVision?: VisionCallFn }): boolean {
  return Boolean(input.pageScreenshotPath && input.callVision);
}

/**
 * Crops the section out of a full-page screenshot and asks a vision model
 * to classify it. Returns null if sharp is unavailable or parsing fails.
 * KI-12: raw VisionCallFn path — callers that have an AIRouter should use
 * section-picker enhanceWithVision (router path) instead; this path has no
 * router timeout/breaker/cost tracking.
 */
export async function classifyByVision(
  section: SectionInfo,
  pageScreenshotPath: string,
  callVision: VisionCallFn,
): Promise<VisionClassificationResult | null> {
  let sharp: typeof import('sharp');
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return null; // sharp not installed — skip vision layer
  }

  const [yTop, yBottom] = section.y_range;
  const tempPath = path.join(os.tmpdir(), `section-${section.section_id}-${Date.now()}.png`);

  const image = sharp(pageScreenshotPath);
  const metadata = await image.metadata();
  const width = metadata.width ?? 1440;

  await image
    .extract({ left: 0, top: Math.max(0, yTop), width, height: Math.max(1, yBottom - yTop) })
    .toFile(tempPath);

  try {
    const buf = await fs.readFile(tempPath);
    const base64 = buf.toString('base64');
    const responseText = await callVision(base64, SECTION_CLASSIFY_PROMPT);
    return parseVisionClassification(responseText);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}
