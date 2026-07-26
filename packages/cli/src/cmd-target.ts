/**
 * elconv target — Manage named WordPress targets.
 * Stores target configs in .elconv/targets.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface WpTarget {
  name: string;
  mcpUrl: string;
  siteUrl: string;
  description?: string;
}

const TARGETS_DIR = resolve('.elconv');
const TARGETS_FILE = resolve(TARGETS_DIR, 'targets.json');

function loadTargets(): WpTarget[] {
  if (!existsSync(TARGETS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(TARGETS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTargets(targets: WpTarget[]): void {
  mkdirSync(TARGETS_DIR, { recursive: true });
  writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2), 'utf-8');
}

export async function cmdTarget(subcommand: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
  switch (subcommand) {
    case 'list': {
      const targets = loadTargets();
      if (targets.length === 0) {
        process.stdout.write('No targets configured. Use: elconv target add --name <n> --mcp-url <url> --site-url <url>\n');
        return 0;
      }
      process.stdout.write('\nConfigured targets:\n');
      for (const t of targets) {
        process.stdout.write(`  • ${t.name}\n    MCP: ${t.mcpUrl}\n    Site: ${t.siteUrl}\n`);
        if (t.description) process.stdout.write(`    Desc: ${t.description}\n`);
      }
      process.stdout.write('\n');
      return 0;
    }

    case 'add': {
      const name = flags['name'] as string;
      const mcpUrl = flags['mcp-url'] as string;
      const siteUrl = flags['site-url'] as string;
      if (!name || !mcpUrl || !siteUrl) {
        process.stderr.write('Error: --name, --mcp-url, and --site-url are required\n');
        return 2;
      }
      const targets = loadTargets();
      if (targets.some((t) => t.name === name)) {
        process.stderr.write(`Error: target "${name}" already exists\n`);
        return 1;
      }
      targets.push({ name, mcpUrl, siteUrl, description: flags['description'] as string | undefined });
      saveTargets(targets);
      process.stdout.write(`✓ Target "${name}" added\n`);
      return 0;
    }

    case 'remove': {
      const name = flags['name'] as string;
      if (!name) {
        process.stderr.write('Error: --name is required\n');
        return 2;
      }
      const targets = loadTargets();
      const filtered = targets.filter((t) => t.name !== name);
      if (filtered.length === targets.length) {
        process.stderr.write(`Error: target "${name}" not found\n`);
        return 1;
      }
      saveTargets(filtered);
      process.stdout.write(`✓ Target "${name}" removed\n`);
      return 0;
    }

    default:
      process.stderr.write('Usage: elconv target <add|list|remove> [options]\n');
      return 2;
  }
}
