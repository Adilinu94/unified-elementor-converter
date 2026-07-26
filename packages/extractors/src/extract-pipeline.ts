/**
 * extract-pipeline — orchestrates Pre-Flight + Extraction + Spec-Build (V2 Phase 1+2).
 *
 * Order of operations:
 *   1. robots.txt check — abort if disallowed (V2 §2.2 Korrektur)
 *   2. Rate-limit acquisition — wait 500ms minimum per host
 *   3. Playwright extraction — full pipeline (screenshot, computed-styles, sections,
 *      animations, css-vars, assets)
 *   4. Asset download — must complete BEFORE spec.json is written, so the spec
 *      references local paths (V2 §2.2)
 *   5. Section merge — apply V2 §5.5 threshold
 *   6. spec.json build — classify sections, emit PageSpec
 *
 * This is the new V2 entry point; the legacy `extractFromUrl()` is still
 * available for backward compatibility.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { extractFromUrl } from './browser/playwright-extractor.js';
import {
  mergeSmallSections,
  type DetectSectionsOptions,
  type MergeThreshold,
} from './browser/section-detector.js';
import {
  runAdaptiveScroll,
  type AdaptiveScrollOptions,
} from './browser/adaptive-scroll.js';
import { buildPageSpec, type BuildSpecInput } from './spec-builder.js';
import type { PageSpec } from './spec-schema.js';
import { robotsAllowed } from './assets/robots-check.js';
import {
  RateLimiter,
  createDomainRateLimiter,
  type RateLimiterOptions,
} from './assets/rate-limiter.js';
import type { Page } from 'playwright';

export interface ExtractPipelineOptions {
  url: string;
  outputDir: string;
  /** robots.txt user-agent (default: site-clone-to-v3). */
  userAgent?: string;
  /** Skip robots.txt check (e.g. in CI). */
  skipRobotsCheck?: boolean;
  /** Skip asset download (for fast smoke runs). */
  skipAssetDownload?: boolean;
  /** RateLimiter config (default: 500ms between calls per host). */
  rateLimiter?: RateLimiter | RateLimiterOptions;
  /** Adaptive-scroll config. */
  adaptiveScroll?: AdaptiveScrollOptions;
  /** Section-detector config. */
  detectSectionsOptions?: DetectSectionsOptions;
  /** Section-merger threshold. */
  mergeThreshold?: MergeThreshold;
  /** Detected source framework (best-effort auto-detect). */
  sourceFramework?: PageSpec['sourceFramework'];
}

export interface ExtractPipelineResult {
  spec: PageSpec;
  extractionResultPath: string;
  specPath: string;
  durationMs: number;
  preFlight: {
    robotsAllowed: boolean;
    rateLimitedMs: number;
  };
  sectionMergeStats: {
    before: number;
    after: number;
    merged: number;
  };
}

/**
 * Auto-detect the source framework from the URL hostname or content-type hints.
 * This is a best-effort heuristic; users should override via `sourceFramework`.
 */
export function detectSourceFramework(url: string, html?: string): PageSpec['sourceFramework'] {
  const lower = url.toLowerCase();
  if (lower.includes('bricksbuilder') || lower.includes('.bricks.')) return 'bricks';
  if (lower.includes('elementor')) return 'elementor';
  if (lower.includes('framer')) return 'framer';
  if (lower.includes('webflow')) return 'webflow';
  if (lower.includes('next') || html?.includes('__NEXT_DATA__')) return 'next';
  if (lower.includes('wordpress') || lower.includes('wp-content')) return 'wordpress';
  return 'unknown';
}

/**
 * Run the full V2 Pre-Flight + Extraction + Spec-Pipeline.
 */
export async function runExtractPipeline(
  options: ExtractPipelineOptions,
): Promise<ExtractPipelineResult> {
  const start = Date.now();
  const outputDir = options.outputDir;
  await fs.mkdir(outputDir, { recursive: true });

  // Build or accept rate-limiter
  const limiter: RateLimiter =
    options.rateLimiter instanceof RateLimiter
      ? options.rateLimiter
      : new RateLimiter({
          minDelayMs: 500,
          ...((options.rateLimiter ?? {}) as RateLimiterOptions),
        });

  const robots = options.skipRobotsCheck
    ? true
    : await robotsAllowed(options.url, null, { userAgent: options.userAgent });
  if (!robots) {
    throw new Error(`robots.txt disallows crawling ${options.url}`);
  }

  // Rate-limit acquire (consumes immediately; second call to same host waits)
  const rateStart = Date.now();
  await limiter.acquireUrl(options.url);
  const rateLimitedMs = Date.now() - rateStart;

  // Phase 4 in V1 = Phase 2 in V2: we run the standard extractor + apply V2 enhancements.
  // Note: we use the original extractFromUrl() which already calls triggerLazyLoad.
  // Future enhancement: replace triggerLazyLoad with runAdaptiveScroll here.
  const extractionResult = await extractFromUrl({
    url: options.url,
    outputDir,
  });

  // Section merge (V2 §5.5)
  const beforeMerge = extractionResult.sections;
  const afterMerge = mergeSmallSections(
    beforeMerge.map((s) => ({
      section_id: s.section_id,
      selector: s.selector,
      y_range: s.y_range,
      layout: s.layout,
      child_count: s.child_count,
      tag: s.tag ?? 'section',
      id: s.id,
      classes: s.classes ?? '',
      // backgroundColor is optional; extracted sections may not carry it.
      // In a deeper integration, we would re-fetch each section's computed bg.
    })),
    options.mergeThreshold,
  );

  // Source framework auto-detect (best-effort)
  const framework = options.sourceFramework ?? detectSourceFramework(options.url);

  // Build spec.json — flatten DesignTokens into the PageSpec's tokens shape.
  // The DesignTokens shape is more typed (array of tokens with optional
  // semantic role); we flatten it into Record<string, string> for the spec.
  let tokens: BuildSpecInput['tokens'];
  if (extractionResult.designTokens) {
    const dt = extractionResult.designTokens;
    const colorsFlat: Record<string, string> = {};
    for (const token of dt.colors) {
      if (token.hex) colorsFlat[token.role ?? token.id] = token.hex;
    }
    const fontsFlat: Record<string, string> = {};
    for (const token of dt.fonts) {
      if (token.family) fontsFlat[token.role ?? token.id] = token.family;
    }
    const spacingFlat: Record<string, string> = {};
    for (const token of dt.sizes) {
      if (token.px !== undefined) spacingFlat[token.id] = String(token.px);
    }
    tokens = {
      colors: colorsFlat,
      fonts: fontsFlat,
      spacing: spacingFlat,
      radii: {},
      shadows: {},
      cssVariables: extractionResult.cssVariables,
    };
  }

  const buildInput: BuildSpecInput = {
    sourceUrl: options.url,
    sections: afterMerge,
    tokens,
    sourceFramework: framework,
    assetSummary: {
      images: extractionResult.images.length,
      svgs: extractionResult.svgs.length,
      fonts: extractionResult.fontsIntercepted.length,
      favicons: extractionResult.favicons.length,
    },
  };
  const spec = buildPageSpec(buildInput);

  // Persist spec.json
  const specPath = path.join(outputDir, 'spec.json');
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2));

  // Persist merged sections
  const mergedSectionsPath = path.join(outputDir, 'sections-merged.json');
  await fs.writeFile(mergedSectionsPath, JSON.stringify(afterMerge, null, 2));

  return {
    spec,
    extractionResultPath: path.join(outputDir, 'extraction-result.json'),
    specPath,
    durationMs: Date.now() - start,
    preFlight: { robotsAllowed: robots, rateLimitedMs },
    sectionMergeStats: {
      before: beforeMerge.length,
      after: afterMerge.length,
      merged: beforeMerge.length - afterMerge.length,
    },
  };
}

/**
 * Run adaptive scroll on a live page (exposed for callers that want to
 * re-trigger scroll after initial extraction).
 */
export async function preFlightScroll(
  page: Page,
  options: AdaptiveScrollOptions = {},
): Promise<void> {
  await runAdaptiveScroll(page, options);
}

/** Re-export for convenience. */
export { createDomainRateLimiter };