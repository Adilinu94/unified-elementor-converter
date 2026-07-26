#!/usr/bin/env node
import { runPipeline, type PipelineOptions } from '../analysis/pipeline.js';

interface CliArgs {
  command: 'run' | 'dry-run' | 'help';
  url?: string;
  outputDir?: string;
  syncToMcp?: boolean;
  mcpUrl?: string;
  mcpAuth?: string;
  stages?: number[];
  postId?: number;
  extractor?: 'local' | 'browserbase';
  help?: boolean;
}

function printHelp(): void {
  console.log(`
site-clone-to-v3 — Clone any URL to Elementor V3 (or V4)

Usage:
  clone run --url <url> [--output-dir <path>] [--sync-to-mcp] [--mcp-url <url>] [--stages 1,2,3,4,5,6]
  clone dry-run --url <url> [--output-dir <path>] [--stages 1,2,3,4,5,6]
  clone help

Options:
  --url <url>           Source URL to clone (required)
  --output-dir <path>   Where to write artifacts (default: ./pipeline-outputs/<timestamp>)
  --sync-to-mcp         Push design tokens to WordPress via MCP
  --mcp-url <url>       MCP endpoint URL (default: Novamira-adrianv2 default)
  --mcp-auth <user:pass> Basic auth for MCP
  --post-id <id>        Elementor post ID to inject into (auto-activates --sync-to-mcp)
  --extractor <mode>    Browser backend: local (default) | browserbase (cloud CDP)
  --stages <n,n,...>    Run only these stages (1=extract, 2=classify, 3=assets, 4=tokens, 5=build, 6=animations)

Examples:
  clone run --url https://example.com --output-dir ./clone
  clone dry-run --url https://example.com --stages 1,2
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: 'help' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case 'run':
        args.command = 'run';
        break;
      case 'dry-run':
        args.command = 'dry-run';
        break;
      case 'help':
      case '--help':
      case '-h':
        args.command = 'help';
        break;
      case '--url':
        args.url = argv[++i];
        break;
      case '--output-dir':
        args.outputDir = argv[++i];
        break;
      case '--sync-to-mcp':
        args.syncToMcp = true;
        break;
      case '--mcp-url':
        args.mcpUrl = argv[++i];
        break;
      case '--mcp-auth':
        args.mcpAuth = argv[++i];
        break;
      case '--post-id':
        args.postId = parseInt(argv[++i], 10);
        break;
      case '--extractor': {
        const val = argv[++i];
        if (val !== 'local' && val !== 'browserbase') {
          console.error(`Unknown extractor "${val}". Use: local | browserbase`);
          process.exit(1);
        }
        args.extractor = val;
        break;
      }
      case '--stages':
        args.stages = (argv[++i] ?? '')
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n >= 1 && n <= 6);
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help' || !args.url) {
    printHelp();
    return;
  }

  const outputDir = args.outputDir ?? `./pipeline-outputs/${Date.now()}`;
  const options: PipelineOptions = {
    url: args.url,
    outputDir,
    dryRun: args.command === 'dry-run',
    syncToMcp: args.syncToMcp ?? (args.postId !== undefined),
    mcpUrl: args.mcpUrl,
    mcpAuth: args.mcpAuth,
    postId: args.postId,
    extractor: args.extractor,
    skipStages: args.stages
      ? [1, 2, 3, 4, 5, 6].filter((n) => !args.stages!.includes(n))
      : undefined,
  };

  console.log(`[clone] ${args.command} ${args.url}`);
  console.log(`[clone] output: ${outputDir}`);

  const result = await runPipeline(args.url, options);

  console.log(`\n[clone] ✓ ${result.stages.length} stages completed in ${
    result.stages.reduce((sum, s) => sum + s.durationMs, 0)
  }ms`);
  for (const s of result.stages) {
    console.log(`  - ${s.name}: ${s.status} (${s.durationMs}ms) — ${JSON.stringify(s.summary)}`);
  }
  console.log(`\n[clone] Artifacts:`);
  for (const [k, v] of Object.entries(result.artifacts)) {
    console.log(`  - ${k}: ${v}`);
  }
}

main().catch((err) => {
  console.error('[clone] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
