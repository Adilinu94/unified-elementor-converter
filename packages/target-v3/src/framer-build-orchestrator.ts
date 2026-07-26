/**
 * Framer Build Orchestrator (#1)
 *
 * Ties together all 10 modules into a single pipeline:
 *   Framer XML + styles + code files → V3 tree → wire links → upload images →
 *   apply responsive → generate setting-first CSS → detect animations →
 *   validate → inject page → create WPCode (header CSS, footer animations) →
 *   geometry probe → auto-fix loop → structure diff → run report.
 *
 * The Framer side is read from pre-exported files (the agent runs the Unframer
 * MCP calls and saves artifacts). The WP side uses NovamiraClient.
 *
 * @example
 * import { runFramerBuild } from './framer-build-orchestrator.js';
 * const result = await runFramerBuild({
 *   framer: { pageXmlPath: 'research/oral-care/page.xml', stylesPath, codeDir },
 *   target: { url, username, password },
 *   page: { title: 'Oral Care', postId: 4956 },
 *   outputDir: 'research/oral-care',
 * });
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { framerXmlToV3, autoTextEditor, type FramerConvertOptions } from './framer-tree-to-v3.js';
import { wireLinks } from './framer-link-wirer.js';
import { FramerImageUploader, formatUploadReport } from './framer-image-uploader.js';
import { applyResponsiveOverrides, type ResponsiveOverrides } from './responsive-breakpoint-mapper.js';
import { generateSettingFirstCss } from './setting-first-css-generator.js';
import { detectAnimations, buildAnimationSnippet, formatAnimationInventory } from './framer-animation-detector.js';
import { validateV3Settings, formatRiskReport } from './v3-setting-validator.js';
import { NovamiraClient } from '../mcp/novamira-client.js';
import { WpcodeHelper } from './wpcode-helper.js';
import { runGeometryProbe, formatProbeReport, type ProbeCheck } from '../qa/geometry-probe.js';
import { runAutoFixLoop, formatAutoFixResult } from './auto-fix-loop.js';
import { runStructureDiff, type SectionMapping } from '../qa/structure-diff.js';
import { generateRunReport } from './run-report-generator.js';

export interface FramerBuildInput {
  /** Framer source artifacts (pre-exported via Unframer MCP). */
  framer: {
    pageXmlPath: string;
    stylesPath?: string;
    codeDir?: string;
    framerUrl?: string;
  };
  /** WordPress target. */
  target: {
    url: string;
    username: string;
    password: string;
  };
  /** Page config. */
  page: {
    title: string;
    /** Existing post id. If omitted, a new page is created. */
    postId?: number;
    slug?: string;
  };
  /** Output directory for run-report + artifacts. */
  outputDir: string;
  /** Optional: responsive overrides (tablet/phone variants). */
  responsive?: ResponsiveOverrides;
  /** Optional: structure-diff section mappings. */
  structureSections?: SectionMapping[];
  /** Optional: geometry probe checks for QA + auto-fix. */
  probeChecks?: ProbeCheck[];
  /** Max auto-fix rounds. Default 3. Set 0 to skip. */
  maxFixRounds?: number;
  /** Auto-fix pass threshold %. Default 90. */
  fixThreshold?: number;
  /** Skip deploy (dry run — build tree + report only). */
  dryRun?: boolean;
}

export interface FramerBuildResult {
  postId: number;
  tree: unknown[];
  wpcodeSnippets: Record<string, number>;
  probePassPct: number;
  reportPath: string;
  success: boolean;
}

export async function runFramerBuild(input: FramerBuildInput): Promise<FramerBuildResult> {
  const out = input.outputDir;
  await fs.mkdir(out, { recursive: true });

  // ---- 1. Read Framer artifacts
  const pageXml = await fs.readFile(input.framer.pageXmlPath, 'utf8');
  let styles: FramerConvertOptions = {};
  if (input.framer.stylesPath) {
    const s = JSON.parse(await fs.readFile(input.framer.stylesPath, 'utf8'));
    styles = { textStyles: s.textStyles, colorStyles: s.colorStyles };
  }
  let codeFiles: Record<string, { name: string; content: string }> = {};
  if (input.framer.codeDir) {
    try {
      const files = await fs.readdir(input.framer.codeDir);
      for (const f of files.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
        codeFiles[f] = { name: f, content: await fs.readFile(path.join(input.framer.codeDir, f), 'utf8') };
      }
    } catch {
      /* no code dir — fine */
    }
  }

  // ---- 2. Convert Framer XML → V3 tree
  let tree = framerXmlToV3(pageXml, styles);
  tree = autoTextEditor(tree);
  console.log(`[1/10] Framer XML → V3 tree: ${tree.length} top-level sections`);

  // ---- 3. Wire links
  const linkResult = wireLinks(tree, { baseUrl: input.target.url });
  console.log(`[2/10] Wired ${linkResult.wired} links (${linkResult.unresolved.length} unresolved)`);

  // ---- 4. Upload images + replace URLs
  const uploader = new FramerImageUploader({
    baseUrl: input.target.url,
    username: input.target.username,
    password: input.target.password,
  });
  let uploadReport;
  if (!input.dryRun) {
    const up = await uploader.uploadAndReplace(tree);
    tree = up.tree;
    uploadReport = up.report;
    console.log(`[3/10] Images: ${formatUploadReport(uploadReport).split('\n')[0]}`);
  } else {
    console.log(`[3/10] Images: skipped (dry run)`);
  }

  // ---- 5. Apply responsive overrides
  if (input.responsive) {
    const resp = applyResponsiveOverrides(tree, input.responsive);
    console.log(`[4/10] Responsive: ${resp.applied} overrides applied`);
  } else {
    console.log(`[4/10] Responsive: none provided`);
  }

  // ---- 6. Generate setting-first CSS
  const cssResult = generateSettingFirstCss(tree, { pageId: input.page.postId ?? 0 });
  console.log(`[5/10] Setting-first CSS: ${cssResult.rulesEmitted} rules emitted`);

  // ---- 7. Detect animations
  const v3Classes: string[] = [];
  for (const el of tree as any[]) {
    const cls = el.settings?.css_classes;
    if (typeof cls === 'string') v3Classes.push(...cls.split(/\s+/));
  }
  const animInv = detectAnimations({ pageXml, codeFiles, v3TreeClasses: v3Classes });
  console.log(`[6/10] Animations: ${formatAnimationInventory(animInv).split('\n')[0]}`);

  // ---- 8. Validate
  const renderReport = validateV3Settings(tree);
  if (renderReport.by_severity.error > 0) {
    console.warn(`[7/10] Validation: ${renderReport.by_severity.error} render-risk errors`);
    console.warn(formatRiskReport(renderReport));
  } else {
    console.log(`[7/10] Validation: ${renderReport.by_severity.warning} warnings, 0 errors`);
  }

  // Save tree artifact
  await fs.writeFile(path.join(out, 'tree.json'), JSON.stringify(tree, null, 2));

  if (input.dryRun) {
    const reportMd = generateRunReport({
      projectName: input.page.title,
      framerUrl: input.framer.framerUrl ?? input.framer.pageXmlPath,
      elementorUrl: input.target.url,
      postId: input.page.postId ?? 0,
      tree,
      wpcodeSnippets: {},
      renderReport,
      cssManifest: cssResult.manifest,
      uploadReport,
      animationInventory: animInv,
      linkResult,
    });
    const reportPath = path.join(out, 'run-report.md');
    await fs.writeFile(reportPath, reportMd);
    console.log(`[done] Dry run report: ${reportPath}`);
    return { postId: 0, tree, wpcodeSnippets: {}, probePassPct: 0, reportPath, success: true };
  }

  // ---- 9. Deploy
  const client = new NovamiraClient({ url: input.target.url, username: input.target.username, password: input.target.password });
  await client.init();
  const postId = input.page.postId ?? (await client.createPage(input.page.title, input.page.slug));
  console.log(`[8/10] Page: post_id=${postId}`);

  await client.injectPage({ post_id: postId, tree, template: 'elementor_canvas' });
  await client.clearCache([postId]);
  console.log(`[8/10] Injected V3 tree`);

  // ---- 10. WPCode snippets (header CSS + footer animations)
  const wpcode = new WpcodeHelper(client);
  const headerCss = cssResult.css;
  const headerId = headerCss
    ? await wpcode.create({ title: `${input.page.title} Header CSS`, code: headerCss, type: 'css', location: 'header', pageId: postId })
    : 0;
  const footerJs = animInv.needsGsap ? buildAnimationSnippet(animInv, { pageId: postId, sectionClasses: v3Classes }) : '';
  const footerId = footerJs
    ? await wpcode.create({ title: `${input.page.title} Footer JS`, code: footerJs, type: 'html', location: 'footer', pageId: postId })
    : 0;
  const wpcodeSnippets: Record<string, number> = {};
  if (headerId) wpcodeSnippets['Header CSS'] = headerId;
  if (footerId) wpcodeSnippets['Footer JS'] = footerId;
  console.log(`[9/10] WPCode: header=${headerId}, footer=${footerId}`);

  // ---- 11. Geometry probe + auto-fix loop
  let probeReports;
  let probePassPct = 0;
  const elementorUrl = `${input.target.url.replace(/\/$/, '')}/?p=${postId}`;
  if (input.probeChecks && input.probeChecks.length) {
    if (animInv.needsGsap && headerId) {
      console.log(`[10/10] Auto-fix loop...`);
      const fixResult = await runAutoFixLoop({
        probe: { url: elementorUrl, checks: input.probeChecks },
        wpcode,
        cssSnippetTitle: `${input.page.title} Header CSS`,
        pageId: postId,
        maxRounds: input.maxFixRounds ?? 3,
        threshold: input.fixThreshold ?? 90,
      });
      console.log(formatAutoFixResult(fixResult));
      probePassPct = fixResult.finalPassPct;
    } else {
      probeReports = await runGeometryProbe({ url: elementorUrl, checks: input.probeChecks });
      probePassPct = probeReports[0]?.pass_pct ?? 0;
      console.log(`[10/10] Probe: ${formatProbeReport(probeReports).split('\n')[0]}`);
    }
  } else {
    console.log(`[10/10] Probe: no checks provided — skipping`);
  }

  // ---- 12. Structure diff
  let structureDiff;
  if (input.structureSections && input.framer.framerUrl) {
    structureDiff = await runStructureDiff({
      framerUrl: input.framer.framerUrl,
      elementorUrl,
      sections: input.structureSections,
    });
    console.log(`[done] Structure diff: ${structureDiff.filter((d) => d.match).length}/${structureDiff.length} match`);
  }

  // ---- 13. Run report
  const reportMd = generateRunReport({
    projectName: input.page.title,
    framerUrl: input.framer.framerUrl ?? input.framer.pageXmlPath,
    elementorUrl,
    postId,
    tree,
    wpcodeSnippets,
    renderReport,
    cssManifest: cssResult.manifest,
    probeReports,
    uploadReport,
    animationInventory: animInv,
    structureDiff,
    linkResult: linkResult,
  });
  const reportPath = path.join(out, 'run-report.md');
  await fs.writeFile(reportPath, reportMd);
  console.log(`[done] Run report: ${reportPath}`);

  return { postId, tree, wpcodeSnippets, probePassPct, reportPath, success: true };
}
