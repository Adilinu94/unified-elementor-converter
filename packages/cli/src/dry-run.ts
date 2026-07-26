/**
 * Dry-Run Mode (Phase 9B — BAUPLAN §4, Task 4)
 *
 * Generates build specs (V3 page-data + V4 atomic plan + animation plan + manifest)
 * from an existing extraction-result.json, WITHOUT any MCP HTTP calls.
 *
 * Use-case: CI/CD validation "would this build run?" without touching a real WP.
 * Source extraction is read from disk (saved by Stage 1 of a prior run).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildV3PageData, writeV3PageData } from '../builder/v3-builder.js';
import { buildV4Plan, writeV4Plan } from '../builder/v4-builder.js';
import { buildAnimationPlan, writeAnimationPlan } from '../builder/animation-injector.js';
import { classifyAll } from '../classifier/section-picker.js';
import type { ExtractionResult } from '../extractor/playwright-extractor.js';

export interface DryRunOptions {
  researchDir: string;
  url: string;
}

export interface DryRunReport {
  url: string;
  researchDir: string;
  timestamp: string;
  extracted: {
    sections: number;
    assets: { images: number; fonts: number; svgs: number; favicons: number };
    hasDesignTokens: boolean;
    hasAnimations: boolean;
  };
  wouldBuild: {
    v3Sections: number;
    v4Sections: number;
    v4Widgets: number;
    v4Classes: number;
    animationSnippets: number;
    syncOperations: number;
  };
  artifacts: string[];
  warnings: string[];
}

export interface DryRunDeps {
  classify: typeof classifyAll;
}

const defaultDeps: DryRunDeps = { classify: classifyAll };

export async function runDryRun(
  options: DryRunOptions,
  deps: DryRunDeps = defaultDeps,
): Promise<DryRunReport> {
  const extractionPath = path.join(options.researchDir, 'extraction-result.json');
  let extraction: ExtractionResult;
  try {
    const raw = await fs.readFile(extractionPath, 'utf8');
    extraction = JSON.parse(raw) as ExtractionResult;
  } catch (err) {
    throw new Error(
      `Cannot load extraction-result.json at ${extractionPath}: ${err instanceof Error ? err.message : err}`,
    );
  }

  const warnings: string[] = [];
  if (!extraction.designTokens) {
    warnings.push('No design tokens in extraction — Phase 5 token-sync would be a no-op.');
  }
  if (!extraction.sections || extraction.sections.length === 0) {
    warnings.push('No sections detected — build would produce an empty page.');
  }

  const classification = await deps.classify({
    url: options.url,
    outputDir: options.researchDir,
    sections: extraction.sections,
    computedStyles: extraction.computedStyles ?? { desktop: [] },
    designTokens: extraction.designTokens,
    cssVars: extraction.cssVariables,
    autoApprove: true,
  });
  const kept = classification.specs;

  const v3Data = buildV3PageData(kept, options.url);
  const v3Path = path.join(options.researchDir, 'dryrun-page-v3.json');
  await writeV3PageData(v3Data, v3Path);

  const v4Plan = buildV4Plan(kept, options.url);
  const v4Path = path.join(options.researchDir, 'dryrun-page-v4.json');
  await writeV4Plan(v4Plan, v4Path);

  const animationPlan = buildAnimationPlan({
    url: options.url,
    animations: extraction.animations,
    sections: extraction.sections,
  });
  const animationsDir = path.join(options.researchDir, 'dryrun-animations');
  await writeAnimationPlan(animationPlan, animationsDir);

  const manifestPath = path.join(options.researchDir, 'dryrun-build-summary.json');
  const summary = {
    url: options.url,
    timestamp: new Date().toISOString(),
    dryRun: true,
    extraction: {
      sectionCount: extraction.sections.length,
      hasDesignTokens: !!extraction.designTokens,
      hasAnimations: !!animationPlan.hasAnimations,
    },
    v3: {
      sectionCount: kept.length,
      widgetCount: kept.reduce((sum, s) => sum + countWidgets(s), 0),
    },
    v4: {
      sectionCount: v4Plan.summary.sectionCount,
      widgetCount: v4Plan.summary.widgetCount,
      classCount: v4Plan.summary.classes.length,
    },
    animations: {
      snippetCount: animationPlan.snippets.length,
      sectionTargets: animationPlan.sectionTargets.length,
    },
    warnings,
  };
  await fs.writeFile(manifestPath, JSON.stringify(summary, null, 2), 'utf8');

  const artifacts = [v3Path, v4Path, manifestPath, animationsDir];

  return {
    url: options.url,
    researchDir: options.researchDir,
    timestamp: summary.timestamp,
    extracted: {
      sections: extraction.sections.length,
      assets: {
        images: extraction.images?.length ?? 0,
        fonts: extraction.fontsIntercepted?.length ?? 0,
        svgs: extraction.svgs?.length ?? 0,
        favicons: extraction.favicons?.length ?? 0,
      },
      hasDesignTokens: !!extraction.designTokens,
      hasAnimations: !!animationPlan.hasAnimations,
    },
    wouldBuild: {
      v3Sections: kept.length,
      v4Sections: v4Plan.summary.sectionCount,
      v4Widgets: v4Plan.summary.widgetCount,
      v4Classes: v4Plan.summary.classes.length,
      animationSnippets: animationPlan.snippets.length,
      syncOperations: extraction.designTokens ? Object.keys(extraction.designTokens).length : 0,
    },
    artifacts,
    warnings,
  };
}

function countWidgets(section: { widgets?: unknown[] }): number {
  return section.widgets?.length ?? 0;
}

export function formatDryRunReport(report: DryRunReport): string {
  const lines: string[] = [];
  lines.push('=== Dry-Run Build Plan ===');
  lines.push(`URL:         ${report.url}`);
  lines.push(`Research:    ${report.researchDir}`);
  lines.push(`Timestamp:   ${report.timestamp}`);
  lines.push('');
  lines.push('--- Extracted ---');
  lines.push(`Sections:    ${report.extracted.sections}`);
  lines.push(`Images:      ${report.extracted.assets.images}`);
  lines.push(`Fonts:       ${report.extracted.assets.fonts}`);
  lines.push(`SVGs:        ${report.extracted.assets.svgs}`);
  lines.push(`Favicons:    ${report.extracted.assets.favicons}`);
  lines.push(`Tokens:      ${report.extracted.hasDesignTokens ? 'yes' : 'no'}`);
  lines.push(`Animations:  ${report.extracted.hasAnimations ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('--- Would Build (no MCP calls) ---');
  lines.push(`V3 sections: ${report.wouldBuild.v3Sections}`);
  lines.push(`V4 sections: ${report.wouldBuild.v4Sections}`);
  lines.push(`V4 widgets:  ${report.wouldBuild.v4Widgets}`);
  lines.push(`V4 classes:  ${report.wouldBuild.v4Classes}`);
  lines.push(`Animations:  ${report.wouldBuild.animationSnippets} snippet(s)`);
  lines.push(`Token sync:  ${report.wouldBuild.syncOperations} operation(s)`);
  lines.push('');
  lines.push('--- Artifacts ---');
  for (const a of report.artifacts) lines.push(`  ${a}`);
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('--- Warnings ---');
    for (const w of report.warnings) lines.push(`  ⚠ ${w}`);
  }
  return lines.join('\n');
}
