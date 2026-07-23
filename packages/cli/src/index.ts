/**
 * @elconv/cli — Unified command router for elconv.
 * Routes to target-specific handlers with anti-contamination enforcement.
 */

import { parseArgs } from './args.js';
import { cmdConvert } from './cmd-convert.js';
import { cmdDoctor } from './cmd-doctor.js';
import { cmdDeploy } from './cmd-deploy.js';
import { cmdQa } from './cmd-qa.js';
import { cmdSessionInit } from './cmd-session.js';
import { cmdTarget } from './cmd-target.js';

const VERSION = '1.0.0';

const HELP = `
elconv v${VERSION} — Unified Elementor Converter

USAGE:
  elconv <command> [options]

COMMANDS:
  convert       Extract source → build V3/V4 tree → validate → output
  doctor        Run preflight checks (MCP, guards, contamination)
  deploy        Deploy tree to WordPress via MCP
  qa            Visual QA comparison (pixelmatch + structural probes)
  session-init  Initialize a conversion session
  target        Manage WordPress targets (add|list|remove)

CONVERT OPTIONS:
  --target <v3|v4>     Required: output format
  --url <url>          Source URL (requires Playwright)
  --xml <path>         Framer XML export file
  --html <path>        Static HTML file
  --out <path>         Output file (default: stdout)
  --skip-guards        Skip guard validation

DOCTOR OPTIONS:
  --target <v3|v4>     Required: target to check
  --mcp-url <url>      MCP server URL
  --tree <path>        Tree JSON to validate

DEPLOY OPTIONS:
  --target <v3|v4>     Required: target format
  --tree <path>        Required: tree JSON file
  --post-id <n>        Required: WordPress post ID
  --strategy <mode>    auto|direct|upload-php|split
  --dry-run            Validate only, no changes
  --force              Override guard failures
  --mcp-url <url>      MCP server URL

QA OPTIONS:
  --url <url>          Deployed page URL
  --ref-url <url>      Reference/source URL
  --section <name>     Specific section to compare

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
    case 'doctor':
      return cmdDoctor(flags);
    case 'deploy':
      return cmdDeploy(flags);
    case 'qa':
      return cmdQa(flags);
    case 'session-init':
      return cmdSessionInit(flags);
    case 'target':
      return cmdTarget(subcommand, flags);
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.stderr.write(`Run "elconv help" for usage.\n`);
      return 2;
  }
}

export { cmdConvert } from './cmd-convert.js';
export { cmdDoctor } from './cmd-doctor.js';
export { cmdDeploy } from './cmd-deploy.js';
export { cmdQa } from './cmd-qa.js';
export { cmdSessionInit } from './cmd-session.js';
export { cmdTarget } from './cmd-target.js';
export { parseArgs } from './args.js';
