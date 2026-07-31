/**
 * Pipeline orchestrator (Phase 4 + 5 + 6 + 7).
 *
 * 7-Stage-Pipeline:
 *   Stage 1 (extract): Playwright → ExtractionResult + JSON-Outputs
 *   Stage 2 (classify): Section-Picker → SectionSpec[] + Manifest
 *   Stage 3 (assets): Downloads all 4 asset types (images, fonts, SVGs, favicons) → manifest.json
 *   Stage 4 (tokens, optional): Design-Token-Sync via MCP
 *   Stage 5 (build): V3 + V4 page-data writers
 *   Stage 6 (animations, Phase 7): WPCode-Snippet-Plan aus Animations
 *   Stage 7 (qa, Phase 8): Visual QA via pixel-diff + SSIM (optional, requires cloneUrl)
 *
 * The asset-downloader is now integrated as Stage 3.
 * Images, SVGs, and favicons are collected by the extractor
 * via collectAssets() from the live DOM.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  extractFromUrl,
  type ExtractionResult,
  type ExtractionOptions,
  type ImageManifestEntry,
  type FontManifestEntry,
  runExtractPipeline,
  writeSpecMarkdown,
  writeResponsiveMatrix,
  downloadFonts,
  downloadImages,
  downloadSvgs,
  downloadFavicons,
  buildAndWriteManifest,
  type AssetManifest,
} from '@elconv/extractors';
import {
  classifyAll,
  type ClassifyAllResult,
  type ClassifyResult,
  writeV3PageData,
  buildV3PageDataFromSections,
  buildAnimationPlan,
  writeAnimationPlan,
  type AnimationPlan,
} from '@elconv/target-v3';
import { writeV4Plan, buildV4Plan } from '@elconv/target-v4';
import { designTokensToConstraintSet } from '@elconv/core';
import { syncTokens, type SyncResult } from './token-sync.js';
import { syncFontsToKit, type FontKitResult } from './font-kit-bridge.js';
import {
  McpAdapter,
  pushToWordPress,
  type WpPushResult,
  upgradePageToV4,
  type UpgradeV4Result,
} from '@elconv/mcp';
import {
  runAcceptance,
} from '@elconv/qa';
import { createAIRouter } from '@elconv/core';
// NOTE: runVisionQA does not exist yet — Stage 7 vision-QA is a documented
// gap (CRITICAL-FAILURE-POINTS.md, P2: AIRouter has no provider implementations).
// Stage 7 degrades to skipping the vision-QA sub-step rather than failing the
// whole pipeline; see runQaStage() below.

export interface PipelineOptions extends ExtractionOptions {
  outputDir: string;
  dryRun?: boolean;
  syncToMcp?: boolean;
  mcpUrl?: string;
  mcpAuth?: string;
  /** Overrides McpAdapter's defaults (3/500ms) — from TargetProfile.retryPolicy when --target resolved. */
  mcpMaxRetries?: number;
  mcpBackoffMs?: number;
  skipStages?: number[];
  /** Pre-loaded extraction result — used when Stage 1 is skipped (step-by-step mode). */
  preloadedExtraction?: ExtractionResult;
  /** Pre-loaded classification result — used when Stage 2 is skipped (step-by-step mode). */
  preloadedClassification?: ClassifyAllResult;
  /** Clone URL for QA stage (the deployed page to compare against original). */
  cloneUrl?: string;
  /** Minimum acceptable match score for QA acceptance (0–1, default 0.85). */
  qaMinScore?: number;
  /** Enable Auto-Fix-Loop after QA (requires postId + mcpUrl). Default: false. */
  qaAutoFix?: boolean;
  /** Enable Vision-QA Healing-Loop after QA (requires postId + mcpUrl + cloneUrl). Default: false. */
  heal?: boolean;
  /**
   * Enable AI vision-enhancement for ambiguous sections during classification
   * (Modul P1). Uses ANTHROPIC_API_KEY/OPENAI_API_KEY from env. Sections with
   * a confident DOM-based classification never trigger a vision call — this
   * only affects sections that would otherwise fall through to the generic
   * 'content' pattern. Default: false.
   */
  visionEnhance?: boolean;
  /**
   * Generate an AI-proposed repair report for sections that fail QA (Modul
   * AI2). Diagnostic only — writes `qa/full-context-repair/repair-report.json`
   * with proposed settings/styles/classes per section; does NOT push
   * anything to WordPress. Requires cloneUrl (reuses the QA-stage
   * screenshots) and ANTHROPIC_API_KEY/OPENAI_API_KEY. Default: false.
   */
  fullContextRepair?: boolean;
  /** Post-ID of the deployed Elementor page for Auto-Fix elementor-edit-element calls. */
  postId?: number;
  /**
   * Upgrade the pushed page to Elementor V4 Atomic Widgets as the final stage
   * (requires postId + mcpUrl). Runs via novamira-adrianv2/upgrade-page-to-v4,
   * after WP-push and QA/auto-fix have completed. Default: false.
   */
  upgradeToV4?: boolean;
  /**
   * Browser backend for Stage 1 extraction.
   * 'local'      — Playwright chromium.launch() (default, requires local Chrome)
   * 'browserbase' — Browserbase cloud CDP session (requires BROWSERBASE_API_KEY)
   */
  extractor?: 'local' | 'browserbase';
}

export type StageName = 'extract' | 'classify' | 'assets' | 'tokens' | 'build' | 'animations' | 'qa';

export interface StageResult {
  name: StageName;
  status: 'ok' | 'skipped' | 'failed';
  durationMs: number;
  outputPaths: string[];
  summary: Record<string, unknown>;
  error?: string;
}

export interface PipelineResult {
  url: string;
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  stages: StageResult[];
  extraction?: ExtractionResult;
  classification?: ClassifyResult;
  assetManifest?: AssetManifest;
  sync?: SyncResult;
  fontKit?: FontKitResult;
  animationPlan?: AnimationPlan;
  wpPush?: WpPushResult;
  upgradeV4?: UpgradeV4Result;
  artifacts: Record<string, string>;
}

async function time<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

/**
 * Builds an McpAdapter from PipelineOptions, applying mcpMaxRetries/
 * mcpBackoffMs (from TargetProfile.retryPolicy when --target was resolved)
 * on top of McpAdapter's own defaults (3/500ms). Keys are omitted rather
 * than passed as `undefined` — McpAdapter's constructor spreads opts over
 * its defaults, so an explicit `undefined` key would override the default
 * with `undefined` instead of leaving it alone.
 */
function buildMcpAdapter(options: PipelineOptions, baseUrl?: string): McpAdapter {
  return new McpAdapter({
    baseUrl: baseUrl ?? options.mcpUrl ?? '',
    authHeader: options.mcpAuth ? `Basic ${Buffer.from(options.mcpAuth).toString('base64')}` : '',
    ...(options.mcpMaxRetries !== undefined ? { maxRetries: options.mcpMaxRetries } : {}),
    ...(options.mcpBackoffMs !== undefined ? { backoffMs: options.mcpBackoffMs } : {}),
  });
}

export async function runPipeline(
  url: string,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const startedAt = new Date().toISOString();
  const outputDir = options.outputDir;
  const skip = new Set(options.skipStages ?? []);
  const stages: StageResult[] = [];
  const artifacts: Record<string, string> = {};

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, 'sections'), { recursive: true });
  await fs.mkdir(path.join(outputDir, 'tokens'), { recursive: true });
  await fs.mkdir(path.join(outputDir, 'animations'), { recursive: true });

  let extraction: ExtractionResult | undefined;
  let classification: ClassifyAllResult | undefined;
  let assetManifest: AssetManifest | undefined;
  let sync: SyncResult | undefined;
  let fontKit: FontKitResult | undefined;
  let animationPlan: AnimationPlan | undefined;
  let wpPush: WpPushResult | undefined;
  let upgradeV4Result: UpgradeV4Result | undefined;

  // Stage 1: extract (V2 — runExtractPipeline with robots.txt, rate-limit, section-merge, spec.json)
  //   runExtractPipeline internally calls extractFromUrl(), applies mergeSmallSections(),
  //   writes spec.json + sections-merged.json, returns the spec. We re-derive extraction
  //   from extractFromUrl() to keep downstream stage shapes stable.
  if (!skip.has(1)) {
    const { result, ms } = await time(async () => {
      const extraction = options.extractor === 'browserbase'
        ? await (await import('@elconv/extractors')).extractViaCloud(options.url, options)
        : await extractFromUrl(options);
      const v2 = await runExtractPipeline({
        url: options.url,
        outputDir,
        skipRobotsCheck: true, // CI/local default; wire real robots check later
      }).catch((v2err) => {
        // Non-fatal: if V2 path fails (e.g. a regression), continue with V1 extraction
        console.warn(`[pipeline] runExtractPipeline failed (V1 fallback): ${v2err instanceof Error ? v2err.message : String(v2err)}`);
        return null;
      });
      return { extraction, v2 };
    });

    extraction = result.extraction;
    const extractionPath = path.join(outputDir, 'extraction-result.json');
    await fs.writeFile(extractionPath, JSON.stringify(result.extraction, null, 2), 'utf-8');
    artifacts.extraction = extractionPath;

    // Responsive matrix: cross-viewport CSS diff (only when multi-viewport styles captured)
    if (result.extraction.computedStyles && Object.keys(result.extraction.computedStyles).length >= 2) {
      const matrixPath = await writeResponsiveMatrix(
        result.extraction.computedStyles,
        outputDir,
        options.url,
      ).catch((err: Error) => {
        console.warn(`[pipeline] responsive-matrix failed (non-fatal): ${err.message}`);
        return null;
      });
      if (matrixPath) artifacts.responsiveMatrix = matrixPath;
    }

    const outputPaths = [extractionPath];
    const summary: Record<string, unknown> = {
      sectionCount: result.extraction.sections.length,
      fontCount: result.extraction.fontsIntercepted.length,
      hasDesignTokens: !!result.extraction.designTokens,
      hasComputedStyles: !!result.extraction.computedStyles,
      v2Spec: !!result.v2,
    };
    if (result.v2) {
      const specPath = path.join(outputDir, 'spec.json');
      const mergedPath = path.join(outputDir, 'sections-merged.json');
      outputPaths.push(specPath, mergedPath);
      artifacts.spec = specPath;
      artifacts.sectionsMerged = mergedPath;
      summary.sectionMergeStats = result.v2.sectionMergeStats;
      summary.preFlight = result.v2.preFlight;

      // Write human-readable .spec.md files alongside spec.json
      const mdPaths = await writeSpecMarkdown(result.v2.spec, outputDir).catch((mdErr: Error) => {
        console.warn(`[pipeline] writeSpecMarkdown failed (non-fatal): ${mdErr.message}`);
        return [] as string[];
      });
      outputPaths.push(...mdPaths);
      artifacts.specMdDir = path.join(outputDir, 'spec-md');
      summary.specMdCount = mdPaths.length;
    }

    stages.push({
      name: 'extract',
      status: 'ok',
      durationMs: ms,
      outputPaths,
      summary,
    });
  } else if (options.preloadedExtraction) {
    // Step-by-step mode: reuse extraction from previous pipeline run
    extraction = options.preloadedExtraction;
    stages.push({
      name: 'extract',
      status: 'skipped',
      durationMs: 0,
      outputPaths: [],
      summary: { reason: 'reused from step-by-step phase 1' },
    });
  }

  // Stage 2: classify
  if (!skip.has(2) && extraction) {
    const { result, ms } = await time(async () => {
      const desktopScreenshot = options.visionEnhance
        ? extraction!.viewports?.find((v) => v.config.label === 'desktop')?.screenshotPath
        : undefined;
      const r = await classifyAll({
        url,
        outputDir,
        sections: extraction!.sections,
        computedStyles: extraction!.computedStyles ?? { desktop: [] },
        designTokens: extraction!.designTokens,
        cssVars: extraction!.cssVariables,
        autoApprove: true,
        pageScreenshotPath: options.visionEnhance ? desktopScreenshot : undefined,
        visionRouter: options.visionEnhance ? createAIRouter() : undefined,
      });
      return r;
    });
    classification = result;
    const classificationPath = path.join(outputDir, 'selected-sections.json');
    await fs.writeFile(classificationPath, JSON.stringify(result.selectedManifest, null, 2), 'utf-8');
    artifacts.classification = classificationPath;
    stages.push({
      name: 'classify',
      status: 'ok',
      durationMs: ms,
      outputPaths: [classificationPath],
      summary: {
        totalSections: result.specs.length,
        approved: result.selectedManifest.approved_count,
        skipped: result.selectedManifest.skipped_count,
      },
    });
  } else if (options.preloadedClassification) {
    // Step-by-step mode: reuse classification from previous pipeline run
    classification = options.preloadedClassification;
    stages.push({
      name: 'classify',
      status: 'skipped',
      durationMs: 0,
      outputPaths: [],
      summary: { reason: 'reused from step-by-step phase 1' },
    });
  }

  // Stage 3: assets (images, fonts, SVGs, favicons from extraction)
  if (!skip.has(3) && extraction) {
    const hasAnyAssets =
      (extraction.images?.length ?? 0) > 0 ||
      (extraction.fontsIntercepted?.length ?? 0) > 0 ||
      (extraction.svgs?.length ?? 0) > 0 ||
      (extraction.favicons?.length ?? 0) > 0;

    if (!hasAnyAssets) {
      stages.push({
        name: 'assets',
        status: 'skipped',
        durationMs: 0,
        outputPaths: [],
        summary: { reason: 'no assets discovered in extraction' },
      });
    } else {
      const assetsRoot = path.join(outputDir, 'assets');
      await fs.mkdir(assetsRoot, { recursive: true });

      const { result, ms } = await time(async () => {
        // Download all four asset categories in parallel
        const [imagesResult, fontsResult, svgsResult, faviconsResult] = await Promise.all([
          extraction!.images?.length
            ? downloadImages(
                extraction!.images.map((img) => ({ url: img.url, alt: img.alt })),
                { hostname: extraction!.hostname, outputRoot: assetsRoot, subdir: 'images' },
              )
            : Promise.resolve({ manifest: [] as ImageManifestEntry[], errors: [] }),

          extraction!.fontsIntercepted?.length
            ? downloadFonts(extraction!.fontsIntercepted, {
                outputRoot: assetsRoot,
              })
            : Promise.resolve({ manifest: [] as FontManifestEntry[], errors: [] }),

          extraction!.svgs?.length
            ? downloadSvgs(
                extraction!.svgs.map((s) =>
                  s.kind === 'inline'
                    ? { kind: 'inline' as const, markup: s.markup!, sourceElement: s.sourceElement, existingId: s.existingId }
                    : { kind: 'external' as const, url: s.url! },
                ),
                { hostname: extraction!.hostname, outputRoot: assetsRoot },
              )
            : Promise.resolve({ manifest: {}, errors: [] }),

          extraction!.favicons?.length
            ? downloadFavicons(
                extraction!.favicons.map((f) => ({
                  url: f.url,
                  kind: f.kind,
                  sizes: f.sizes,
                  type: f.type,
                })),
                { hostname: extraction!.hostname, outputRoot: assetsRoot },
              )
            : Promise.resolve({ manifest: {}, errors: [] }),
        ]);

        const { manifest } = await buildAndWriteManifest(
          {
            hostname: extraction!.hostname,
            url,
            images: imagesResult,
            fonts: fontsResult,
            svgs: svgsResult,
            favicons: faviconsResult,
          },
          assetsRoot,
        );
        return { imagesResult, fontsResult, svgsResult, faviconsResult, manifest };
      });

      assetManifest = result.manifest;
      const manifestPath = path.join(assetsRoot, 'manifest.json');
      artifacts['asset-manifest'] = manifestPath;

      stages.push({
        name: 'assets',
        status: 'ok',
        durationMs: ms,
        outputPaths: [manifestPath],
        summary: {
          images: Object.keys(result.imagesResult.manifest).length,
          imageErrors: result.imagesResult.errors.length,
          fonts: Object.keys(result.fontsResult.manifest).length,
          fontErrors: result.fontsResult.errors.length,
          svgs: Object.keys(result.svgsResult.manifest).length,
          svgErrors: result.svgsResult.errors.length,
          favicons: Object.keys(result.faviconsResult.manifest).length,
          faviconErrors: result.faviconsResult.errors.length,
          manifest: path.join(assetsRoot, 'manifest.json'),
        },
      });
    }
  } else if (!skip.has(3)) {
    stages.push({
      name: 'assets',
      status: 'skipped',
      durationMs: 0,
      outputPaths: [],
      summary: { reason: 'extraction stage did not run' },
    });
  }

  // Stage 4: tokens (requires MCP + extraction.designTokens)
  if (!skip.has(4) && extraction?.designTokens && options.syncToMcp) {
    const { result, ms } = await time(async () => {
      const mcp = buildMcpAdapter(options, options.mcpUrl ?? 'https://test4.nick-webdesign.de/wp-json/mcp/novamira');
      return syncTokens(extraction.designTokens!, mcp, path.join(outputDir, 'tokens'), {
        dryRun: options.dryRun,
      });
    });
    sync = result;
    artifacts.sync = result.artifactPath;

    // Font-to-Kit Bridge: auto-sync intercepted fonts into Kit typography
    if (extraction.fontsIntercepted.length > 0) {
      const mcp = buildMcpAdapter(options, options.mcpUrl ?? 'https://test4.nick-webdesign.de/wp-json/mcp/novamira');
      fontKit = await syncFontsToKit(extraction.fontsIntercepted, mcp, { dryRun: options.dryRun });
    }

    stages.push({
      name: 'tokens',
      status: 'ok',
      durationMs: ms,
      outputPaths: [result.artifactPath],
      summary: {
        newVariables: result.newVariables.length,
        newClasses: result.newClasses.length,
        reusedVariables: result.reusedVariables,
        cacheHits: result.cacheHits,
        fontsAdded: fontKit?.added.length ?? 0,
        fontsSkipped: fontKit?.skipped.length ?? 0,
      },
    });
  }

  // Stage 5: build (V3 + V4)
  if (!skip.has(5) && classification) {
    const { result, ms } = await time(async () => {
      const kept = classification.specs;
      const tokenConstraints = extraction?.designTokens
        ? designTokensToConstraintSet(extraction.designTokens)
        : undefined;
      const v3Data = buildV3PageDataFromSections(kept, url, undefined, { tokenConstraints });
      const v3Path = path.join(outputDir, 'page-v3.json');
      await writeV3PageData(v3Data, v3Path);
      artifacts['v3-build'] = v3Path;

      const v4Plan = buildV4Plan(kept, url, undefined, undefined, { tokenConstraints });
      const v4Path = path.join(outputDir, 'page-v4.json');
      await writeV4Plan(v4Plan, v4Path);
      artifacts['v4-build'] = v4Path;

      // Stage 5.5: WP push — inject V3 tree via elementor-inject-calibrated-page
      let pushResult: WpPushResult | undefined;
      if (options.postId !== undefined && options.mcpUrl) {
        const mcp = buildMcpAdapter(options);
        pushResult = await pushToWordPress(mcp, v3Data.content, {
          postId: options.postId,
          title: v3Data.title,
          status: v3Data.status,
          pageTemplate: 'elementor_canvas',
          target: 'v3',
          dryRun: options.dryRun,
        });
        wpPush = pushResult;
      }

      return { v3Path, v4Path, v4Plan, pushResult };
    });

    stages.push({
      name: 'build',
      status: 'ok',
      durationMs: ms,
      outputPaths: [result.v3Path, result.v4Path],
      summary: {
        sectionCount: result.v4Plan.summary.sectionCount,
        widgetCount: result.v4Plan.summary.widgetCount,
        classCount: result.v4Plan.summary.classes.length,
        wpPush: result.pushResult
          ? { postId: result.pushResult.postId, permalink: result.pushResult.permalink, created: result.pushResult.created }
          : 'skipped (no --post-id or --mcp-url)',
      },
    });
  }

  // Stage 6: animations (Phase 7) — WPCode snippet plan
  if (!skip.has(6) && extraction) {
    const { result, ms } = await time(async () => {
      const plan = buildAnimationPlan({
        url,
        animations: extraction!.animations,
        sections: extraction!.sections,
      });
      await writeAnimationPlan(plan, path.join(outputDir, 'animations'));
      return plan;
    });
    animationPlan = result;
    artifacts.animations = path.join(outputDir, 'animations', 'animation-plan.json');
    stages.push({
      name: 'animations',
      status: 'ok',
      durationMs: ms,
      outputPaths: [artifacts.animations],
      summary: {
        snippetCount: result.snippets.length,
        sectionTargets: result.sectionTargets.length,
        hasAnimations: result.hasAnimations,
      },
    });
  }

  // Stage 7: qa (Phase 8) — Visual QA via pixel-diff + SSIM + optional Auto-Fix loop
  if (!skip.has(7) && options.cloneUrl) {
    const { result, ms } = await time(async () => {
      const qaOutputDir = path.join(outputDir, 'qa');
      const report = await runAcceptance({
        originalUrl: url,
        cloneUrl: options.cloneUrl!,
        outputDir: qaOutputDir,
        minAcceptableScore: options.qaMinScore,
      });
      return report;
    });
    const qaReport = result;
    artifacts['qa-report'] = path.join(outputDir, 'qa', 'acceptance-report.json');
    const stageSummary: Record<string, unknown> = {
      verdict: qaReport.verdict,
      matchPercent: qaReport.matchPercent,
      score: qaReport.score,
      recommendations: qaReport.recommendations,
    };
    const outputPaths = [
      path.join(outputDir, 'qa', 'acceptance-report.json'),
      path.join(outputDir, 'qa', 'original.png'),
      path.join(outputDir, 'qa', 'clone.png'),
      path.join(outputDir, 'qa', 'diff.png'),
    ];

    if (options.qaAutoFix) {
      stageSummary.autoFixNote =
        'auto-fix requested but skipped — the retained CLI path has no compatible injected fix-loop port';
    }

    if (options.heal) {
      stageSummary.healNote =
        'heal requested but skipped — no compatible capture/fix port is injected into this CLI path';
    }

    if (options.fullContextRepair) {
      stageSummary.fullContextRepairNote =
        'full-context-repair requested but skipped — no compatible AI repair contract is wired into this CLI path';
    }

    stages.push({
      name: 'qa',
      status: qaReport.verdict === 'fail' ? 'failed' : 'ok',
      durationMs: ms,
      outputPaths,
      summary: stageSummary,
    });
  } else if (!skip.has(7)) {
    stages.push({
      name: 'qa',
      status: 'skipped',
      durationMs: 0,
      outputPaths: [],
      summary: { reason: 'no clone URL provided — QA requires a deployed page to compare' },
    });
  }

  // V4 upgrade — final step, converts the pushed page to Atomic Widgets via
  // novamira-adrianv2/upgrade-page-to-v4. Runs after QA/auto-fix so the
  // auto-fix loop (which operates on V3 element structure) always sees V3
  // markup. Not part of the numbered stages[]/resume system: the ability is
  // already idempotent via its own skip_v4 flag, so resume-tracking wasn't
  // needed for this to be safe to re-run.
  if (options.upgradeToV4) {
    if (options.postId !== undefined && options.mcpUrl) {
      const mcp = buildMcpAdapter(options);
      upgradeV4Result = await upgradePageToV4(mcp, {
        postId: options.postId,
        dryRun: options.dryRun,
      });
    } else {
      upgradeV4Result = {
        success: false,
        status: 'skipped',
        error: 'upgrade-to-v4 requested but skipped — requires postId + mcpUrl',
      };
    }
  }

  return {
    url,
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: options.dryRun ?? false,
    stages,
    extraction,
    classification,
    assetManifest,
    sync,
    fontKit,
    animationPlan,
    wpPush,
    upgradeV4: upgradeV4Result,
    artifacts,
  };
}
