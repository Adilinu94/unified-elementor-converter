#!/usr/bin/env node
/**
 * clone-v3 — Site-Clone to Elementor V3
 *
 * Sub-commands (Plan §1):
 *   clone          Full pipeline (all phases)
 *   extract        Phase 2 only (Playwright extraction)
 *   extract-tokens Phase 2 + 2.5 (Design-Tokens only, no build)
 *   apply-kit      Phase 5 standalone (Kit on existing WP)
 *   build          Phase 6-8 (Build + QA from existing extraction)
 *   diff           Original vs existing V3-Page without build
 *   convert-page-v3-to-v4  Single-page dry-run V3→V4 conversion (independent of clone --upgrade-to-v4)
 *
 * Flags (Plan §3):
 *   --url, --target, --viewports, --animations, --fonts,
 *   --strictness, --auto-pick-sections, --sections, --no-wizard,
 *   --resume, --output, --dry-run, --merge, --source-auth,
 *   --version, --help
 */
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';

import { PACKAGE_VERSION, hostnameFromUrl, loadProfiles } from '@elconv/core';
import { runWizard, type WizardOptions } from './wizard.js';
import type { AnimationStrategy, FontStrategy, StrictnessLevel } from './prompts.js';
import { runWizardPipeline } from './pipeline-runner.js';
import { runDryRun, formatDryRunReport } from './dry-run.js';
import { runDiffOnly, formatDiffReport, saveSnapshots, snapshotSections } from './diff-only.js';
import { runIncremental, formatIncrementalReport } from './incremental.js';

const program = new Command();

program
  .name('clone-v3')
  .description('Clone any live website to Elementor V3 — pixel-accurate, on any WordPress with the Novamira plugin.')
  .version(PACKAGE_VERSION)
  .option('--format <fmt>', 'Output format: text|json (default text)', 'text')
  .option('--timeout <seconds>', 'Global timeout in seconds for MCP/Playwright calls', '300')
  .option('--no-color', 'Disable ANSI colors in output')
  .hook('preAction', (_thisCommand) => {
    const globalOpts = program.opts<{ format?: string; timeout?: string; color?: boolean }>();
    if (globalOpts.color === false) {
      process.env.NO_COLOR = '1';
      chalk.level = 0;
    }
    if (globalOpts.format === 'json') {
      process.env.CLONE_V3_FORMAT = 'json';
    }
  });

program
  .command('clone [url]')
  .description('Full pipeline: extract → design-tokens → section-picker → assets → design-system → build → QA')
  .option('-u, --url <url>', 'Source URL (alias for positional arg, useful for non-interactive)')
  .option('-t, --target <name>', 'WP target profile name (e.g. yoursite-local)')
  .option('--viewports <list>', 'Comma-separated viewport widths (e.g. 1440,768,390)')
  .option('-a, --animations <strategy>', 'Animation strategy: none|css|gsap|auto')
  .option('-f, --fonts <strategy>', 'Font strategy: auto|system|all')
  .option('-s, --strictness <level>', 'Pixel-match strictness: draft|balanced|pixel-perfect')
  .option('--auto-pick-sections', 'Skip interactive section picker, pick all detected sections', false)
  .option('--sections <list>', 'Comma-separated section IDs to build (overrides picker)')
  .option('--source-auth <name>', 'Use named source auth from source-auth.json')
  .option('--no-wizard', 'Run non-interactively (CI/CD mode)')
  .option('--resume <state.json>', 'Resume from a saved state file')
  .option('-o, --output <dir>', 'Research output directory', './research')
  .option('--dry-run', 'Generate specs only, no MCP calls', false)
  .option('--diff-only', 'Compare against existing V3 page, do not build', false)
  .option('--incremental', 'Only rebuild changed sections (requires previous build)', false)
  .option('--clone-url <url>', 'Deployed clone page URL for visual QA stage (e.g. https://yoursite.local/?p=1234)')
  .option('--post-id <id>', 'WordPress post ID of the deployed clone page — required for QA auto-fix MCP calls')
  .option('--qa-auto-fix', 'Enable auto-fix loop after QA diff (requires --clone-url + --post-id + MCP target)', false)
  .option('--upgrade-to-v4', 'Upgrade the pushed page to Elementor V4 Atomic Widgets as the final step (requires --post-id + MCP target, runs after QA/auto-fix)', false)
  .option('--heal', 'Enable Vision-QA self-healing loop after QA diff (requires --clone-url + --post-id + MCP target)', false)
  .option('--vision-enhance', 'Enable AI vision-enhancement for ambiguous sections during classification (Modul P1, requires ANTHROPIC_API_KEY or OPENAI_API_KEY)', false)
  .option('--full-context-repair', 'Generate an AI-proposed repair report for sections that fail QA (Modul AI2, diagnostic only — does not push to WordPress; requires --clone-url + ANTHROPIC_API_KEY/OPENAI_API_KEY)', false)
  .option('--mcp-url <url>', 'MCP endpoint URL for WP-Push and Auto-Fix (e.g. https://test4.nick-webdesign.de/wp-json/mcp/novamira)')
  .option('--mcp-auth <user:pass>', 'Basic auth credentials for MCP endpoint')
  .option('--extractor <mode>', 'Browser backend for extraction: local (default) | browserbase (cloud CDP)')
  .action(async (url: string | undefined, options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] full pipeline`));
    try {
      const profiles = await loadProfiles();
      const wizardOpts: WizardOptions = {
        url: options.url ?? url,
        target: options.target,
        targets: Object.entries(profiles.targets).map(([name, p]) => ({
          name,
          description: `${p.label} (${p.url})`,
        })),
        viewports: options.viewports
          ?.split(',')
          .map((s: string) => parseInt(s.trim(), 10))
          .filter(Number.isFinite),
        animations: options.animations as AnimationStrategy | undefined,
        fonts: options.fonts as FontStrategy | undefined,
        strictness: options.strictness as StrictnessLevel | undefined,
        autoPickSections: !!options.autoPickSections,
        sections: options.sections?.split(',').map((s: string) => s.trim()).filter(Boolean),
        sourceAuth: options.sourceAuth,
        resume: options.resume,
        output: options.output ?? './research',
        interactive: options.wizard !== false,
        cloneUrl: options.cloneUrl,
        postId: options.postId !== undefined ? parseInt(options.postId as string, 10) : undefined,
        qaAutoFix: !!options.qaAutoFix,
        upgradeToV4: !!options.upgradeToV4,
        heal: !!options.heal,
        visionEnhance: !!options.visionEnhance,
        fullContextRepair: !!options.fullContextRepair,
        mcpUrl: options.mcpUrl,
        mcpAuth: options.mcpAuth,
        extractor: options.extractor as 'local' | 'browserbase' | undefined,
      };
      const result = await runWizard(wizardOpts);
      const researchDir = `${wizardOpts.output}/${result.state.hostname}`;
      console.log(chalk.cyan(`\n[clone-v3] State saved to ${wizardOpts.resume ?? `research/${result.state.hostname}/state.json`}`));

      const sourceUrl = result.state.sourceUrl;
      const modeCount = [options.dryRun, options.diffOnly, options.incremental].filter(Boolean).length;
      if (modeCount > 1) {
        console.error(chalk.red('Error: --dry-run, --diff-only, and --incremental are mutually exclusive.'));
        process.exit(2);
      }

      if (options.dryRun) {
        console.log(chalk.yellow('[DRY-RUN] Generating specs without MCP calls...'));
        const report = await runDryRun({ researchDir, url: sourceUrl });
        console.log(chalk.cyan(formatDryRunReport(report)));
        process.exit(0);
      }

      if (options.diffOnly) {
        console.log(chalk.yellow('[DIFF-ONLY] Comparing current extraction against previous build...'));
        const report = await runDiffOnly({ researchDir, url: sourceUrl });
        console.log(chalk.cyan(formatDiffReport(report)));
        process.exit(0);
      }

      if (options.incremental) {
        console.log(chalk.yellow('[INCREMENTAL] Computing change set vs previous build...'));
        const report = await runIncremental({ researchDir, url: sourceUrl });
        console.log(chalk.cyan(formatIncrementalReport(report)));
        process.exit(0);
      }

      // ── Phase 9: Run pipeline with step-by-step wizard (reviews between stages) ──
      const runResult = await runWizardPipeline(result);

      if (runResult.approvedSectionIds?.length) {
        console.log(chalk.gray(`  Sections approved: ${runResult.approvedSectionIds.length}`));
      }

      console.log(chalk.green(`\n✓ Clone complete: ${result.state.hostname}`));
      console.log(chalk.gray(`  State saved → ${runResult.stateFile}`));
      console.log(chalk.gray(`  Run 'clone-v3 diff --url ${sourceUrl}' to compare against previous builds.`));
    } catch (err) {
      console.error(chalk.red('Clone failed:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('extract <url>')
  .description('Phase 2: Playwright extraction (screenshots, DOM, styles, animations, fonts, css-vars)')
  .option('-o, --output <dir>', 'Research output directory', './research')
  .option('--viewports <list>', 'Comma-separated viewport widths', '1440,768,390')
  .option('--source-auth <name>', 'Use named source auth from source-auth.json')
  .option('--no-wizard', 'Run non-interactively')
  .action(async (url: string, _options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] extract`));
    console.log(chalk.gray(`URL: ${url}`));
    console.log(chalk.gray('Extraction not yet implemented — see Phase 2'));
  });

program
  .command('extract-tokens [url]')
  .description('Phase 2 + 2.5: extract + design-token intelligence (no build)')
  .option('--from <research-dir>', 'Reuse existing research dir, skip extraction')
  .option('-o, --output <dir>', 'Research output directory', './research')
  .action(async (url, _options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] extract-tokens`));
    console.log(chalk.gray(`URL: ${url ?? '(reuse --from)'}`));
    console.log(chalk.gray('Token extraction not yet implemented — see Phase 2.5'));
  });

program
  .command('apply-kit')
  .description('Phase 5 standalone: apply a design-tokens.json as V3 Kit to an existing WP')
  .requiredOption('--tokens <path>', 'Path to design-tokens.json')
  .requiredOption('-t, --target <name>', 'WP target profile name')
  .option('--merge', 'Only create new tokens, do not overwrite existing', false)
  .action(async (options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] apply-kit`));
    console.log(chalk.gray(`Tokens: ${options.tokens}`));
    console.log(chalk.gray(`Target: ${options.target}`));
    console.log(chalk.gray(`Mode:   ${options.merge ? 'merge' : 'overwrite'}`));
    console.log(chalk.gray('Kit-apply not yet implemented — see Phase 5'));
  });

program
  .command('build <research-dir>')
  .description('Phase 6-8: build V3 page from existing extraction (specs in research-dir)')
  .requiredOption('-t, --target <name>', 'WP target profile name')
  .option('-s, --strictness <level>', 'Pixel-match strictness: draft|balanced|pixel-perfect', 'balanced')
  .option('--dry-run', 'Generate specs only, no MCP calls', false)
  .action(async (researchDir, options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] build`));
    console.log(chalk.gray(`Research: ${researchDir}`));
    console.log(chalk.gray(`Target:   ${options.target}`));
    console.log(chalk.gray('Build not yet implemented — see Phase 6-8'));
  });

program
  .command('diff [url]')
  .description('Compare source extraction vs previous build (no MCP, no Playwright)')
  .option('-u, --url <url>', 'Source URL (or read from state.json)')
  .option('-o, --output <dir>', 'Research output directory', './research')
  .option('--save-snapshots', 'Save current extraction as new baseline (previous-sections.json)', false)
  .action(async (url: string | undefined, options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] diff`));
    try {
      const sourceUrl = options.url ?? url;
      if (!sourceUrl) {
        console.error(chalk.red('Error: URL required (--url or positional arg).'));
        process.exit(2);
      }
      const hostname = hostnameFromUrl(sourceUrl);
      const researchDir = path.join(options.output, hostname);
      const report = await runDiffOnly({ researchDir, url: sourceUrl });
      console.log(chalk.cyan(formatDiffReport(report)));
      if (options.saveSnapshots) {
        const { loadExtractionResult } = await import('./diff-only.js');
        const extraction = await loadExtractionResult(researchDir);
        const snapshots = snapshotSections(extraction);
        const savedPath = await saveSnapshots(researchDir, snapshots);
        console.log(chalk.green(`[diff] saved new baseline → ${savedPath}`));
      }
    } catch (err) {
      console.error(chalk.red('Diff failed:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('v3v4-diff')
  .description('Visual diff between V3 and V4 Elementor pages (screenshot + pixelmatch + HTML report)')
  .requiredOption('--v3-url <url>', 'V3 (original) page URL')
  .requiredOption('--v4-url <url>', 'V4 (converted) page URL')
  .option('--v3-label <label>', 'Label for V3 page', 'V3 (Original)')
  .option('--v4-label <label>', 'Label for V4 page', 'V4 (Converted)')
  .option('-o, --output <dir>', 'Output directory for screenshots and report', './v3v4-diff-output')
  .option('--viewports <list>', 'Comma-separated viewport sizes (e.g. 1440,768,390)', '1440,768,390')
  .action(async (options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] v3v4-diff`));
    try {
      const { runV3V4Diff } = await import('./v3v4-diff.js');
      const viewportWidths = options.viewports.split(',').map((s: string) => parseInt(s.trim(), 10)).filter(Number.isFinite);
      const viewports = viewportWidths.map((w: number) => ({
        label: w >= 1024 ? `Desktop ${w}` : w >= 600 ? `Tablet ${w}` : `Mobile ${w}`,
        width: w,
        height: w >= 1024 ? 900 : w >= 600 ? 1024 : 844,
      }));
      const htmlPath = await runV3V4Diff({
        v3Url: options.v3Url,
        v4Url: options.v4Url,
        v3Label: options.v3Label,
        v4Label: options.v4Label,
        outputDir: options.output,
        viewports,
      });
      console.log(chalk.green(`\nOpen report: ${htmlPath}`));
    } catch (err) {
      console.error(chalk.red('v3v4-diff failed:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('convert-page-v3-to-v4')
  .description(
    'Single-page dry-run conversion of an existing V3 Elementor page to V4 Atomic (via novamira-adrianv2/convert-page-v3-to-v4). ' +
      'Separate from `clone --upgrade-to-v4`: that upgrades a page just pushed by the full pipeline, this converts any already-existing V3 page on demand.',
  )
  .requiredOption('--post-id <id>', 'WordPress post ID of the V3 page to convert')
  .requiredOption('--mcp-url <url>', 'Novamira MCP base URL')
  .option('--mcp-auth <user:pass>', 'Basic auth credentials for the MCP endpoint')
  .option('--no-dry-run', 'Actually write the converted V4 tree instead of just previewing it (default: dry-run preview only)')
  .option('--target-post-id <id>', 'Write the converted tree to a different post ID instead of the source post')
  .option('--unknown-widget-strategy <strategy>', 'How to handle widgets with no V4 equivalent: keep_v3|skip|error', 'keep_v3')
  .option('--run-kit-convert', 'Also convert the active Kit (colors/fonts) to V4 Global Classes/Variables', false)
  .option('--auto-fix', 'Let the ability auto-fix known-safe issues during conversion', false)
  .action(async (options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] convert-page-v3-to-v4`));
    try {
      const { McpAdapter } = await import('../mcp/mcp-adapter.js');
      const { convertPageV3ToV4 } = await import('../mcp/convert-page-v3-to-v4.js');
      const mcp = new McpAdapter({
        baseUrl: options.mcpUrl,
        authHeader: options.mcpAuth ? `Basic ${Buffer.from(options.mcpAuth).toString('base64')}` : '',
      });
      const result = await convertPageV3ToV4(mcp, {
        postId: parseInt(options.postId, 10),
        dryRun: options.dryRun,
        targetPostId: options.targetPostId ? parseInt(options.targetPostId, 10) : undefined,
        unknownWidgetStrategy: options.unknownWidgetStrategy,
        runKitConvert: options.runKitConvert,
        autoFix: options.autoFix,
      });
      if (!result.success) {
        console.error(chalk.red('Conversion failed:'), result.error);
        process.exit(1);
      }
      console.log(
        chalk.gray(
          `Widgets:  ${result.stats?.converted} converted, ${result.stats?.kept_v3} kept as V3, ${result.stats?.skipped} skipped`,
        ),
      );
      if (result.stats?.unsupported_widgets.length) {
        console.log(chalk.yellow(`Unsupported: ${result.stats.unsupported_widgets.join(', ')}`));
      }
      if (result.audit && result.audit.total_issues > 0) {
        console.log(
          chalk.yellow(
            `Audit issues: ${result.audit.total_issues} (${result.audit.by_severity.error} error, ${result.audit.by_severity.warning} warning, ${result.audit.by_severity.info} info)`,
          ),
        );
      }
      if (result.warnings?.length) {
        for (const w of result.warnings) console.log(chalk.yellow(`  ! ${w}`));
      }
    } catch (err) {
      console.error(chalk.red('convert-page-v3-to-v4 failed:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('add-target')
  .description('Interactively add a WP target profile (saves to ~/.clone-v3/profiles.json)')
  .action(async () => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] add-target`));
    console.log(chalk.gray('Target setup not yet implemented — see Phase 1'));
  });

program
  .command('framer-build')
  .description('Skill-based Framer→Elementor V3 build: pre-exported Framer XML → V3 tree → deploy → QA → run report. Run with no flags for the interactive wizard.')
  .option('--framer-xml <path>', 'Path to pre-exported Framer page XML (from framer_getNodeXml)')
  .option('--framer-styles <path>', 'Path to JSON with {textStyles, colorStyles} (from framer_getProjectXml)')
  .option('--framer-code <dir>', 'Directory of Framer code files (.tsx) for animation detection')
  .option('--framer-url <url>', 'Live Framer URL (for structure-diff)')
  .option('--mcp-url <url>', 'Novamira MCP endpoint URL (e.g. https://site.de/wp-json/mcp/novamira)')
  .option('--mcp-auth <user:pass>', 'Basic auth credentials (WP username:application-password)')
  .option('--post-id <id>', 'Existing WP post id to inject into (creates new page if omitted)')
  .option('--page-title <title>', 'Page title (used when creating a new page)')
  .option('--page-slug <slug>', 'Page slug (used when creating a new page)')
  .option('--probe-checks <path>', 'Path to probe-checks JSON (selectors + expected styles)')
  .option('--structure-sections <path>', 'Path to structure-diff section mappings JSON')
  .option('--responsive <path>', 'Path to responsive overrides JSON (tablet/phone variants)')
  .requiredOption('-o, --output <dir>', 'Output directory for run-report + artifacts', './research')
  .option('--max-fix-rounds <n>', 'Max auto-fix rounds. Default 3. Set 0 to skip', '3')
  .option('--fix-threshold <pct>', 'Auto-fix pass-rate threshold %. Default 90', '90')
  .option('--dry-run', 'Build tree + report only, no MCP deploy', false)
  .option('--interactive', 'Force the interactive wizard even when flags are provided', false)
  .action(async (options) => {
    console.log(chalk.cyan(`[clone-v3 v${PACKAGE_VERSION}] framer-build`));
    try {
      // Interactive mode: no --framer-xml OR --interactive flag
      const hasFlags = options.framerXml && options.mcpUrl && options.mcpAuth;
      if (!hasFlags || options.interactive) {
        const { runFramerBuildWizard } = await import('./framer-build-wizard.js');
        await runFramerBuildWizard({
          framerXmlPath: options.framerXml,
          framerStylesPath: options.framerStyles,
          framerCodeDir: options.framerCode,
          framerUrl: options.framerUrl,
          mcpUrl: options.mcpUrl,
          mcpAuth: options.mcpAuth,
          postId: options.postId ? parseInt(options.postId, 10) : undefined,
          pageTitle: options.pageTitle,
          pageSlug: options.pageSlug,
          output: options.output,
          probeChecksPath: options.probeChecks,
          structureSectionsPath: options.structureSections,
          responsivePath: options.responsive,
          maxFixRounds: parseInt(options.maxFixRounds, 10),
          fixThreshold: parseInt(options.fixThreshold, 10),
          dryRun: options.dryRun,
        });
        return;
      }

      // Non-interactive mode: all required flags provided
      const [username, password] = options.mcpAuth.split(':');
      if (!username || !password) {
        console.error(chalk.red('--mcp-auth must be "user:application-password"'));
        process.exit(1);
      }
      const { runFramerBuild } = await import('../builder/framer-build-orchestrator.js');
      const result = await runFramerBuild({
        framer: {
          pageXmlPath: options.framerXml,
          stylesPath: options.framerStyles,
          codeDir: options.framerCode,
          framerUrl: options.framerUrl,
        },
        target: { url: options.mcpUrl.replace(/\/wp-json\/mcp\/novamira\/?$/, ''), username, password },
        page: {
          title: options.pageTitle ?? 'Framer Clone',
          postId: options.postId ? parseInt(options.postId, 10) : undefined,
          slug: options.pageSlug,
        },
        outputDir: options.output,
        maxFixRounds: parseInt(options.maxFixRounds, 10),
        fixThreshold: parseInt(options.fixThreshold, 10),
        dryRun: options.dryRun,
      });
      console.log(chalk.green(`\nDone. post_id=${result.postId}, probe=${result.probePassPct}%, report=${result.reportPath}`));
    } catch (err) {
      console.error(chalk.red('framer-build failed:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  program.parseAsync(process.argv).catch((err) => {
    console.error(chalk.red('Error:'), err);
    process.exit(1);
  });
}
