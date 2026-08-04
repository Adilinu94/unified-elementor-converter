/**
 * @elconv/cli — Unified command router for elconv.
 * Routes to target-specific handlers with anti-contamination enforcement.
 */

import { parseArgs } from './args.js';
import { cmdConvert } from './cmd-convert.js';
import { cmdDoctor } from './cmd-doctor.js';
import { cmdDeploy } from './cmd-deploy.js';
import { cmdQa } from './cmd-qa.js';
import { cmdDesignCritic } from './cmd-design-critic.js';
import { cmdSessionInit } from './cmd-session.js';
import { cmdTarget } from './cmd-target.js';
import { cmdWizard } from './cmd-wizard.js';
import { cmdBatch } from './cmd-batch.js';
import { cmdServe } from './cmd-serve.js';
import { cmdRollback } from './cmd-rollback.js';
import { cmdPreflight } from './cmd-preflight.js';

const VERSION = '1.0.0';

const HELP = `
elconv v${VERSION} — Unified Elementor Converter

USAGE:
  elconv <command> [options]

COMMANDS:
  convert       Extract source → build V3/V4 tree → validate → output
  wizard        Unified step-by-step pipeline (preflight → extract → build → deploy → QA)
  doctor        Run preflight checks (MCP, guards, contamination)
  deploy        Deploy tree to WordPress via MCP
  qa            Visual QA comparison (pixelmatch + structural probes)
  design-critic Design critique (L1 computed-style rules + optional server-side)
  session-init  Initialize a conversion session
  target        Manage WordPress targets (add|list|remove)
  batch         Multi-page batch build from a JSON manifest
  serve         HTTP API mode (default port 7123)
  rollback      Restore a WordPress page from a snapshot
  preflight     Check target WordPress plugin/PHP/WP compatibility

CONVERT OPTIONS:
  --target <v3|v4>     Required: output format
  --url <url>          Source URL (browser pipeline; no deployment)
  --xml <path>         Framer XML export file
  --html <path>        Static HTML file
  --out <path>         Output file (default: stdout)
  --report <path>      URL conversion report (default: <output-dir>/conversion-report.json)
  --output-dir <path>  URL pipeline artifact directory
  --timeout-ms <n>     Total URL conversion timeout budget in ms (default: extractor default)
  --skip-guards        Skip guard validation

DOCTOR OPTIONS:
  --target <v3|v4>     Required: target to check
  --mcp-url <url>      MCP server URL
  --tree <path>        Tree JSON to validate
  --wizard-contract <state-file>  Check the wizard-contract.json next to a wizard
                       state file (reads, soft-migrates pre-O-12, validates)
  --wizard-contracts <dir>  Auto-discover state/contract pairs in a directory
                       (recursive) and check each (contract + consistency)
  --sync-abilities     Diff the live server's ability list against the frozen registry
  --verify-large-deploy  Fetch live schemas of the frozen upload-php/split contract's
                       abilities and compare them against the plan (diagnostic only —
                       the productive gate stays closed)
  --json               Machine-readable JSON report for --wizard-contract(s),
                       --sync-abilities and --verify-large-deploy

DEPLOY OPTIONS:
  --target <v3|v4>     Required: target format
  --tree <path>        Required: tree JSON file
  --post-id <n>        Required: WordPress post ID
  --strategy <mode>    auto|direct|upload-php|split (direct live-capable; others require verified server schemas)
  --dry-run            Validate only, no changes
  --force              Override guard failures
  --force-large-direct Explicitly allow direct push for trees at/above the size threshold
  --mcp-url <url>      MCP server URL
  --auth-env <ENV>     Env var containing user:application-password
  --snapshot-dir <dir> Snapshot directory (default: .elconv-snapshots)
  --title <title>      Page metadata title
  --status <draft|publish> Page status (default: draft)
  --page-template <name> Elementor page template
  --server-convert     After a V3 deploy: run server-side V3→V4 conversion
                       (needs --mcp-url + --auth-env; --convert-dry-run for preview)

BATCH OPTIONS:
  --manifest <path>    Required: JSON array of {target, url|html|xml, out?}
  --stop-on-error      Abort after the first failing entry (forces sequential)
  --concurrency <n>    Parallel workers (default: 1 = sequential)
  --rate-limit <n>     Max entry starts per minute (0 = unlimited)
  --retry <n>          Retries per failing entry (default: 0)
  --resume             Skip entries whose out file already exists

SERVE OPTIONS:
  --port <n>           TCP port (default: 7123)

DESIGN-CRITIC OPTIONS:
  --url <url>          Page URL for L1 computed-style rules (requires Playwright)
  --viewport-width <n> Viewport width in px (default: 1440)
  --server-critic      Also run server-side score-distinctiveness + suggest-design-fixes
                       (needs --post-id, --mcp-url, --auth-env <ENV_VAR>)
  --min-distinctiveness <n> Server-side pass threshold (default: 70)

ROLLBACK OPTIONS:
  --post-id <n>        Restore the newest snapshot for this post
  --snapshot <path>    Restore a specific snapshot file instead
  --snapshot-dir <dir> Snapshot directory (default: .elconv-snapshots)
  --list               List available snapshots (optionally filtered by --post-id)
  --dry-run            Show what would be restored without calling MCP
  --mcp-url <url> --auth-env <ENV>  Required to actually restore

PREFLIGHT OPTIONS:
  --mode <v3|v4>       Target mode to check (default: v3)
  --json               Machine-readable report (for CI)
  --fix                Auto-install missing plugins from wp.org
  --mcp-url <url> --auth-env <ENV>  Required: target WordPress via novamira/execute-php

QA OPTIONS:
  --url <url>          Deployed page URL
  --ref-url <url>      Reference/source URL
  --section <name>     Specific section to compare

DESIGN-CRITIC OPTIONS:
  --url <url>              Required: page to critique
  --viewport-width <n>     Viewport width in px (default: 1440)

WIZARD OPTIONS:
  (no flags)           Interactive mode — prompts for target, source, output, deploy
  --target <v3|v4>     Non-interactive: output format (presence skips the prompts)
  --target-profile <n> Resolve saved metadata from ~/.clone-v3 or .elconv (credentials still via --auth-env)
  --url/--html/--xml   Source for non-interactive mode
  --out <path>         Output tree path
  --viewports <w,...>  Target QA viewport widths (default: 1440,768,390)
  --strictness <mode>  draft|balanced|pixel-perfect
  --animations <mode>  none|css|gsap|auto
  --fonts <mode>       auto|system|all
  --sections <id,...>  Optional section selection
  --token-strategy     V4 only: auto|preserve|inline|global
  --responsive <mode>  V4 only: auto|preserve|mobile-first
  --unknown-widgets    V4 only: fallback-html|skip|error
  --post-id <n>        Deploy into an existing WordPress page
  --mcp-url <url>      Novamira MCP endpoint for deployment
  --auth-env <ENV>     Env var containing user:application-password
  --title <title>      Page metadata title
  --page-template <name> Elementor page template
  --qa-ref-url <url>   Reference URL for a real visual QA score
  --qa-threshold <n>   QA threshold from 0 to 100 (default: 85)
  --max-repair-rounds <n> Maximum repair rounds from 0 to 20
  --qa-auto-fix        Enable QA auto-fix option in persisted state
  --heal               Enable healing option in persisted state
  --full-context-repair Enable diagnostic AI repair option in persisted state
  --remote-state-key <key> Use an injected verified remote-state adapter
  --dry-run            Extract/build/validate locally; nothing pushed
  --resume             Continue a previous run from its saved state file
  --no-interactive     Force flag mode (requires --target)

EXIT CODES:
  0  Success
  1  Guard failure / contamination / deploy error
  2  Usage error (missing flags, invalid target)

EXAMPLES:
  elconv convert --target v3 --html ./export/index.html --out ./v3-tree.json
  elconv convert --target v4 --xml ./framer/homepage.xml
  elconv doctor --target v3 --tree ./v3-tree.json
  elconv deploy --target v3 --tree ./v3-tree.json --post-id 42 --dry-run
  elconv target add --name prod --mcp-url http://localhost:3000 --site-url https://example.com
`;

export async function main(argv: string[] = process.argv): Promise<number> {
  const { command, subcommand, flags } = parseArgs(argv);

  if (!command || command === 'help' || flags['help']) {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === 'version' || flags['version']) {
    process.stdout.write(`elconv v${VERSION}\n`);
    return 0;
  }

  switch (command) {
    case 'convert':
      return cmdConvert(flags);
    case 'wizard':
      return cmdWizard(flags);
    case 'doctor':
      return cmdDoctor(flags);
    case 'deploy':
      return cmdDeploy(flags);
    case 'qa':
      return cmdQa(flags);
    case 'design-critic':
      return cmdDesignCritic(flags);
    case 'session-init':
      return cmdSessionInit(flags);
    case 'target':
      return cmdTarget(subcommand, flags);
    case 'batch':
      return cmdBatch(flags);
    case 'serve':
      return cmdServe(flags);
    case 'rollback':
      return cmdRollback(flags);
    case 'preflight':
      return cmdPreflight(flags);
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.stderr.write(`Run "elconv help" for usage.\n`);
      return 2;
  }
}

export { cmdConvert } from './cmd-convert.js';
export { cmdWizard } from './cmd-wizard.js';
export { cmdDoctor } from './cmd-doctor.js';
export { cmdDeploy } from './cmd-deploy.js';
export { cmdQa } from './cmd-qa.js';
export { cmdSessionInit } from './cmd-session.js';
export { cmdTarget } from './cmd-target.js';
export { cmdBatch, parseBatchManifest } from './cmd-batch.js';
export { cmdServe, createElconvServer } from './cmd-serve.js';
export { cmdRollback } from './cmd-rollback.js';
export { cmdPreflight } from './cmd-preflight.js';
export { parseArgs } from './args.js';
export * from './skill-session.js';
export * from './changelog-generator.js';
export * from './pipeline-runner.js';
export * from './state-manager.js';
export * from './update-checker.js';
export * from './prompts.js';
export * from './framer-build-wizard.js';
export * from './incremental.js';
export * from './diff-only.js';
export * from './dry-run.js';
export * from './clone-v3.js';
export * from './clone.js';
export * from './phase11-cli-flags.js';
export {
  PIPELINE_STAGES,
  buildPipelineStages,
  pipelineStageLabel,
  describePipelineStage,
  runStage,
  runClonePipeline,
} from './phase11-pipeline.js';
export type {
  PipelineStage,
  PipelineStageResult,
  PipelineRunOptions as Phase11PipelineRunOptions,
  PipelineRunResult as Phase11PipelineRunResult,
} from './phase11-pipeline.js';
export * from './v3v4-diff.js';
export * from './wizard.js';
export * from './wizard-contract.js';
