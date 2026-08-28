/**
 * Framer → Elementor V3 build orchestrator.
 *
 * The converter is deliberately transport-neutral: deployment, WPCode and
 * browser QA are injected ports. This keeps target-v3 independent from the
 * MCP transport and prevents a dry-run from making implicit network calls.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { framerXmlToV3, autoTextEditor, type FramerConvertOptions } from './framer-tree-to-v3.js';
import { wireLinks } from './framer-link-wirer.js';
import { FramerImageUploader, formatUploadReport } from './framer-image-uploader.js';
import { applyResponsiveOverrides, type ResponsiveOverrides } from './responsive-breakpoint-mapper.js';
import { generateSettingFirstCss } from './setting-first-css-generator.js';
import { detectAnimations, buildAnimationSnippet, formatAnimationInventory } from './framer-animation-detector.js';
import { validateTree, formatRiskReport } from './setting-validator.js';
import { runAutoFixLoop, formatAutoFixResult, type ProbeCheck, type ProbeRunner, type WpcodeUpdatePort } from './auto-fix-loop.js';
import { generateRunReport } from './run-report-generator.js';
import type { GeometryProbeReport, SectionMapping, SectionDiff } from '@elconv/qa';
import type { V3Tree } from './v3-tree-types.js';

export interface FramerBuildDeployPort {
  init?(): Promise<void>;
  createPage(title: string, slug?: string): Promise<number>;
  injectPage(postId: number, tree: V3Tree): Promise<void>;
  clearCache?(postId: number): Promise<void>;
}

export interface FramerBuildWpcodePort extends WpcodeUpdatePort {
  create(spec: { title: string; code: string; type: 'css' | 'html'; location: 'header' | 'footer'; pageId: number }): Promise<number>;
}

export interface FramerBuildInput {
  framer: {
    pageXmlPath: string;
    stylesPath?: string;
    codeDir?: string;
    framerUrl?: string;
  };
  /** Kept for URL/auth compatibility with the legacy CLI surface. */
  target: { url: string; username: string; password: string };
  page: { title: string; postId?: number; slug?: string };
  outputDir: string;
  responsive?: ResponsiveOverrides;
  structureSections?: SectionMapping[];
  probeChecks?: ProbeCheck[];
  maxFixRounds?: number;
  fixThreshold?: number;
  dryRun?: boolean;
  deployPort?: FramerBuildDeployPort;
  wpcodePort?: FramerBuildWpcodePort;
  probeRunner?: ProbeRunner;
}

export interface FramerBuildResult {
  postId: number;
  tree: V3Tree;
  wpcodeSnippets: Record<string, number>;
  probePassPct: number;
  reportPath: string;
  success: boolean;
}

export async function runFramerBuild(input: FramerBuildInput): Promise<FramerBuildResult> {
  const out = input.outputDir;
  await fs.mkdir(out, { recursive: true });

  const pageXml = await fs.readFile(input.framer.pageXmlPath, 'utf8');
  let styles: FramerConvertOptions = {};
  if (input.framer.stylesPath) {
    const source = JSON.parse(await fs.readFile(input.framer.stylesPath, 'utf8')) as Record<string, unknown>;
    styles = {
      textStyles: source.textStyles as Record<string, unknown> | undefined,
      colorStyles: source.colorStyles as Record<string, unknown> | undefined,
    };
  }

  const codeFiles: Record<string, { name: string; content: string }> = {};
  if (input.framer.codeDir) {
    try {
      for (const file of await fs.readdir(input.framer.codeDir)) {
        if (file.endsWith('.tsx') || file.endsWith('.ts')) {
          codeFiles[file] = { name: file, content: await fs.readFile(path.join(input.framer.codeDir, file), 'utf8') };
        }
      }
    } catch {
      // An optional code directory is allowed to be absent.
    }
  }

  let tree = autoTextEditor(framerXmlToV3(pageXml, styles));
  console.log(`[1/10] Framer XML → V3 tree: ${tree.length} top-level sections`);

  const linkResult = wireLinks(tree, { baseUrl: input.target.url });
  console.log(`[2/10] Wired ${linkResult.wired} links (${linkResult.unresolved.length} unresolved)`);

  let uploadReport;
  if (!input.dryRun) {
    const uploader = new FramerImageUploader({
      baseUrl: input.target.url,
      username: input.target.username,
      password: input.target.password,
    });
    const uploaded = await uploader.uploadAndReplace(tree);
    tree = uploaded.tree;
    uploadReport = uploaded.report;
    console.log(`[3/10] Images: ${formatUploadReport(uploadReport).split('\n')[0]}`);
  } else {
    console.log('[3/10] Images: skipped (dry run)');
  }

  if (input.responsive) {
    const response = applyResponsiveOverrides(tree, input.responsive);
    console.log(`[4/10] Responsive: ${response.applied} overrides applied`);
    if (response.rejectedKeys.length > 0) {
      // Silently dropping these would reintroduce the dead-override class.
      console.warn(
        `[4/10] Responsive: ${response.rejectedKeys.length} override key(s) rejected ` +
          `(already breakpoint-marked): ${response.rejectedKeys.slice(0, 5).join(', ')}`,
      );
    }
  } else {
    console.log('[4/10] Responsive: none provided');
  }

  const cssResult = generateSettingFirstCss(tree, { pageId: input.page.postId ?? 0 });
  console.log(`[5/10] Setting-first CSS: ${cssResult.rulesEmitted} rules emitted`);

  const treeClasses = tree.flatMap((element) => {
    const classes = element.settings?.css_classes;
    return typeof classes === 'string' ? classes.split(/\s+/) : [];
  });
  const animationInventory = detectAnimations({ pageXml, codeFiles, v3TreeClasses: treeClasses });
  console.log(`[6/10] Animations: ${formatAnimationInventory(animationInventory).split('\n')[0]}`);

  const renderReport = validateTree(tree);
  if (renderReport.criticalCount > 0) {
    console.warn(`[7/10] Validation: ${renderReport.criticalCount} critical render risks`);
    console.warn(formatRiskReport(renderReport));
  } else {
    console.log(`[7/10] Validation: ${renderReport.highCount} high, ${renderReport.mediumCount} medium risks`);
  }
  await fs.writeFile(path.join(out, 'tree.json'), JSON.stringify(tree, null, 2));

  if (input.dryRun) {
    return finishReport(input, tree, 0, {}, renderReport, cssResult.manifest, uploadReport, animationInventory, linkResult, undefined);
  }

  if (!input.deployPort) {
    throw new Error('Live Framer build requires an injected deployPort; use dry-run or configure the CLI transport adapter.');
  }
  await input.deployPort.init?.();
  const postId = input.page.postId ?? await input.deployPort.createPage(input.page.title, input.page.slug);
  console.log(`[8/10] Page: post_id=${postId}`);
  await input.deployPort.injectPage(postId, tree);
  await input.deployPort.clearCache?.(postId);

  const wpcodeSnippets: Record<string, number> = {};
  if (input.wpcodePort && cssResult.css) {
    const headerId = await input.wpcodePort.create({ title: `${input.page.title} Header CSS`, code: cssResult.css, type: 'css', location: 'header', pageId: postId });
    wpcodeSnippets['Header CSS'] = headerId;
  }
  const footerJs = animationInventory.needsGsap ? buildAnimationSnippet(animationInventory, { pageId: postId, sectionClasses: treeClasses }) : '';
  if (input.wpcodePort && footerJs) {
    const footerId = await input.wpcodePort.create({ title: `${input.page.title} Footer JS`, code: footerJs, type: 'html', location: 'footer', pageId: postId });
    wpcodeSnippets['Footer JS'] = footerId;
  }
  console.log(`[9/10] WPCode: ${Object.keys(wpcodeSnippets).length} snippets`);

  let probePassPct = 0;
  let probeReports: GeometryProbeReport[] | undefined;
  if (input.probeChecks?.length) {
    const fixResult = await runAutoFixLoop({
      probe: { url: `${input.target.url.replace(/\/$/, '')}/?p=${postId}`, checks: input.probeChecks },
      wpcode: input.wpcodePort ?? { update: async () => { throw new Error('WPCode port is required for auto-fix'); } },
      cssSnippetTitle: `${input.page.title} Header CSS`,
      pageId: postId,
      maxRounds: input.maxFixRounds ?? 3,
      threshold: input.fixThreshold ?? 90,
      probeRunner: input.probeRunner,
    });
    console.log(formatAutoFixResult(fixResult));
    probePassPct = fixResult.finalPassPct;
    probeReports = fixResult.finalReports;
  } else {
    console.log('[10/10] Probe: no checks provided — skipping');
  }

  if (input.structureSections && input.framer.framerUrl) {
    const { runStructureDiff } = await import('@elconv/qa');
    const structureDiff: SectionDiff[] = await runStructureDiff({
      framerUrl: input.framer.framerUrl,
      elementorUrl: `${input.target.url.replace(/\/$/, '')}/?p=${postId}`,
      sections: input.structureSections,
    });
    const report = await finishReport(input, tree, postId, wpcodeSnippets, renderReport, cssResult.manifest, uploadReport, animationInventory, linkResult, probeReports, structureDiff);
    return { ...report, probePassPct };
  }

  return finishReport(input, tree, postId, wpcodeSnippets, renderReport, cssResult.manifest, uploadReport, animationInventory, linkResult, probeReports, undefined, probePassPct);
}

async function finishReport(
  input: FramerBuildInput,
  tree: V3Tree,
  postId: number,
  wpcodeSnippets: Record<string, number>,
  renderReport: ReturnType<typeof validateTree>,
  cssManifest: ReturnType<typeof generateSettingFirstCss>['manifest'],
  uploadReport: Awaited<ReturnType<FramerImageUploader['uploadAndReplace']>>['report'] | undefined,
  animationInventory: ReturnType<typeof detectAnimations>,
  linkResult: ReturnType<typeof wireLinks>,
  probeReports?: GeometryProbeReport[],
  structureDiff?: SectionDiff[],
  probePassPct = 0,
): Promise<FramerBuildResult> {
  const reportMd = generateRunReport({
    projectName: input.page.title,
    framerUrl: input.framer.framerUrl ?? input.framer.pageXmlPath,
    elementorUrl: input.target.url,
    postId,
    tree,
    wpcodeSnippets,
    renderReport,
    cssManifest,
    uploadReport,
    animationInventory,
    structureDiff,
    linkResult,
    probeReports,
  });
  const reportPath = path.join(input.outputDir, 'run-report.md');
  await fs.writeFile(reportPath, reportMd);
  console.log(`[done] Run report: ${reportPath}`);
  return { postId, tree, wpcodeSnippets, probePassPct, reportPath, success: true };
}
