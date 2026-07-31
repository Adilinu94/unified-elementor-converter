/**
 * Framer Build Wizard — interactive onboarding for the skill-based Framer→V3 build.
 *
 * Asks the user for all important info up front (Framer artifacts, WP target,
 * page config, QA options), then invokes the orchestrator. Run via
 * `npx clone-v3 framer-build` with no required flags (interactive mode) or
 * `npx clone-v3 framer-build --interactive`.
 *
 * Questions asked:
 *  1. Framer page XML path (pre-exported via Unframer MCP)
 *  2. Framer styles JSON path (optional — textStyles + colorStyles)
 *  3. Framer code files dir (optional — for animation detection)
 *  4. Framer live URL (optional — for structure diff)
 *  5. WP target: MCP URL + auth (user:application-password), or load a profile
 *  6. Page: existing post ID or create new (title + slug)
 *  7. Output directory
 *  8. QA: probe-checks JSON path (optional), max fix rounds, threshold
 *  9. Dry run? (build tree + report only, no deploy)
 */

import { input, confirm } from '@inquirer/prompts';
import path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import chalk from 'chalk';
import { runFramerBuild, type FramerResponsiveOverrides } from '@elconv/target-v3';
import type { ProbeCheck } from '@elconv/target-v3';
import type { SectionMapping } from '@elconv/qa';

const URL_PATTERN = /^https?:\/\/[a-z0-9.-]+/i;

function isValidUrl(v: string): boolean {
  return URL_PATTERN.test(v);
}

function fileExists(v: string): boolean {
  try {
    return existsSync(path.resolve(v));
  } catch {
    return false;
  }
}

export interface FramerBuildWizardOptions {
  /** Pre-filled values from CLI flags (non-interactive overrides). */
  framerXmlPath?: string;
  framerStylesPath?: string;
  framerCodeDir?: string;
  framerUrl?: string;
  mcpUrl?: string;
  mcpAuth?: string;
  postId?: number;
  pageTitle?: string;
  pageSlug?: string;
  output?: string;
  probeChecksPath?: string;
  structureSectionsPath?: string;
  responsivePath?: string;
  maxFixRounds?: number;
  fixThreshold?: number;
  dryRun?: boolean;
}

export async function runFramerBuildWizard(opts: FramerBuildWizardOptions): Promise<void> {
  console.log(chalk.cyan('\n=== Framer → Elementor V3 Build Wizard ===\n'));
  console.log(chalk.gray('This wizard collects everything needed for a skill-based Framer build.'));
  console.log(chalk.gray('Pre-export Framer artifacts first via the Unframer MCP (framer_getNodeXml, framer_getProjectXml).\n'));

  // ---- 1. Framer artifacts
  const framerXmlPath = opts.framerXmlPath ?? await input({
    message: 'Path to pre-exported Framer page XML:',
    default: './research/page.xml',
    validate: (v) => (fileExists(v) ? true : 'File not found. Export it via framer_getNodeXml first.'),
  });

  const framerStylesPath = opts.framerStylesPath ?? (await confirm({
    message: 'Do you have a Framer styles JSON (textStyles + colorStyles)?',
    default: true,
  }))
    ? await input({
        message: 'Path to Framer styles JSON:',
        default: './research/styles.json',
        validate: (v) => (fileExists(v) ? true : 'File not found.'),
      })
    : undefined;

  const framerCodeDir = opts.framerCodeDir ?? (await confirm({
    message: 'Do you have Framer code files (.tsx) for animation detection?',
    default: false,
  }))
    ? await input({
        message: 'Directory of Framer code files:',
        default: './research/code',
        validate: (v) => (fileExists(v) ? true : 'Directory not found.'),
      })
    : undefined;

  const framerUrl = opts.framerUrl ?? (await confirm({
    message: 'Do you have the live Framer URL (for structure diff)?',
    default: true,
  }))
    ? await input({
        message: 'Live Framer URL:',
        validate: (v) => (isValidUrl(v) ? true : 'Must be a valid http(s) URL'),
      })
    : undefined;

  // ---- 2. WP target
  console.log(chalk.cyan('\n--- WordPress Target ---'));
  const mcpUrl = opts.mcpUrl ?? await input({
    message: 'Novamira MCP endpoint URL:',
    default: 'https://testseite.nick-webdesign.de/wp-json/mcp/novamira',
    validate: (v) => (isValidUrl(v) ? true : 'Must be a valid http(s) URL'),
  });

  const mcpAuth = opts.mcpAuth ?? await input({
    message: 'WP credentials (user:application-password):',
    default: 'Adrian:',
    validate: (v) => (v.includes(':') && v.split(':')[1].length > 0 ? true : 'Format: user:application-password'),
  });
  const [username, password] = mcpAuth.split(':');
  const baseUrl = mcpUrl.replace(/\/wp-json\/mcp\/novamira\/?$/, '');

  // Verify credentials against WP REST API before proceeding
  console.log(chalk.gray('Verifying WP credentials...'));
  const credOk = await verifyWpCredentials(baseUrl, username, password);
  if (!credOk) {
    console.error(chalk.red('WP credentials invalid (401). Check application password — no spaces, correct user.'));
    const proceed = await confirm({ message: 'Continue anyway?', default: false });
    if (!proceed) process.exit(1);
  } else {
    console.log(chalk.green('Credentials OK.'));
  }

  // ---- 3. Page config
  console.log(chalk.cyan('\n--- Page ---'));
  const createNew = await confirm({
    message: 'Create a new page? (no = inject into existing post)',
    default: opts.postId == null,
  });
  let postId: number | undefined;
  let pageTitle: string | undefined;
  let pageSlug: string | undefined;
  if (createNew) {
    pageTitle = opts.pageTitle ?? await input({ message: 'Page title:', default: 'Framer Clone' });
    pageSlug = opts.pageSlug ?? ((await input({ message: 'Page slug (blank = auto):', default: '' })) || undefined);
  } else {
    postId = opts.postId ?? parseInt(await input({
      message: 'Existing post ID:',
      validate: (v) => (/^\d+$/.test(v) ? true : 'Must be a number'),
    }), 10);
  }

  // ---- 4. Output
  const output = opts.output ?? await input({
    message: 'Output directory for run-report + artifacts:',
    default: './research/framer-build',
  });

  // ---- 5. QA options
  console.log(chalk.cyan('\n--- QA ---'));
  const probeChecksPath = opts.probeChecksPath ?? (await confirm({
    message: 'Do you have a probe-checks JSON (selectors + expected styles)?',
    default: false,
  }))
    ? await input({
        message: 'Path to probe-checks JSON:',
        default: './research/probe-checks.json',
        validate: (v) => (fileExists(v) ? true : 'File not found.'),
      })
    : undefined;

  const structureSectionsPath = opts.structureSectionsPath ?? (await confirm({
    message: 'Do you have structure-diff section mappings JSON?',
    default: false,
  }))
    ? await input({
        message: 'Path to structure-sections JSON:',
        default: './research/structure-sections.json',
        validate: (v) => (fileExists(v) ? true : 'File not found.'),
      })
    : undefined;

  const responsivePath = opts.responsivePath ?? (await confirm({
    message: 'Do you have responsive overrides JSON (tablet/phone variants)?',
    default: false,
  }))
    ? await input({
        message: 'Path to responsive overrides JSON:',
        default: './research/responsive.json',
        validate: (v) => (fileExists(v) ? true : 'File not found.'),
      })
    : undefined;

  const maxFixRounds = opts.maxFixRounds ?? parseInt(await input({
    message: 'Max auto-fix rounds (0 = skip):',
    default: '3',
    validate: (v) => (/^\d+$/.test(v) ? true : 'Must be a number'),
  }), 10);

  const fixThreshold = opts.fixThreshold ?? parseInt(await input({
    message: 'Auto-fix pass-rate threshold %:',
    default: '90',
    validate: (v) => (/^\d+$/.test(v) ? true : 'Must be a number'),
  }), 10);

  const dryRun = opts.dryRun ?? (await confirm({
    message: 'Dry run? (build tree + report only, no deploy)',
    default: false,
  }));

  // ---- Load optional JSON files
  let probeChecks: ProbeCheck[] | undefined;
  if (probeChecksPath) {
    try {
      probeChecks = JSON.parse(await fs.readFile(probeChecksPath, 'utf8'));
    } catch (e) {
      console.warn(chalk.yellow(`Could not parse probe-checks JSON: ${(e as Error).message}`));
    }
  }
  let structureSections: SectionMapping[] | undefined;
  if (structureSectionsPath) {
    try {
      structureSections = JSON.parse(await fs.readFile(structureSectionsPath, 'utf8'));
    } catch (e) {
      console.warn(chalk.yellow(`Could not parse structure-sections JSON: ${(e as Error).message}`));
    }
  }
  let responsive: FramerResponsiveOverrides | undefined;
  if (responsivePath) {
    try {
      responsive = JSON.parse(await fs.readFile(responsivePath, 'utf8'));
    } catch (e) {
      console.warn(chalk.yellow(`Could not parse responsive JSON: ${(e as Error).message}`));
    }
  }

  // ---- Summary
  console.log(chalk.cyan('\n=== Summary ==='));
  console.log(`  Framer XML:    ${framerXmlPath}`);
  console.log(`  Styles:        ${framerStylesPath ?? 'none'}`);
  console.log(`  Code dir:      ${framerCodeDir ?? 'none'}`);
  console.log(`  Framer URL:    ${framerUrl ?? 'none'}`);
  console.log(`  MCP URL:       ${mcpUrl}`);
  console.log(`  Page:          ${createNew ? `new "${pageTitle}"` : `existing #${postId}`}`);
  console.log(`  Output:        ${output}`);
  console.log(`  Probe checks:  ${probeChecks?.length ?? 0}`);
  console.log(`  Structure:     ${structureSections?.length ?? 0}`);
  console.log(`  Responsive:    ${responsive ? 'yes' : 'no'}`);
  console.log(`  Max fix rounds: ${maxFixRounds}`);
  console.log(`  Threshold:     ${fixThreshold}%`);
  console.log(`  Dry run:       ${dryRun}`);
  console.log();

  const go = await confirm({ message: 'Start build?', default: true });
  if (!go) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  // ---- Run
  const result = await runFramerBuild({
    framer: { pageXmlPath: framerXmlPath, stylesPath: framerStylesPath, codeDir: framerCodeDir, framerUrl },
    target: { url: baseUrl, username, password },
    page: { title: pageTitle ?? 'Framer Clone', postId, slug: pageSlug },
    outputDir: output,
    responsive,
    structureSections,
    probeChecks,
    maxFixRounds,
    fixThreshold,
    dryRun,
  });

  console.log(chalk.green(`\n✓ Done. post_id=${result.postId}, probe=${result.probePassPct}%, report=${result.reportPath}`));
}

async function verifyWpCredentials(baseUrl: string, user: string, pass: string): Promise<boolean> {
  try {
    const token = Buffer.from(`${user}:${pass.replace(/\s+/g, '')}`).toString('base64');
    const r = await fetch(`${baseUrl}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: `Basic ${token}` },
    });
    return r.status === 200;
  } catch {
    return false;
  }
}
