/**
 * elconv batch — Multi-page batch build (Phase 107, ported from the
 * V4-Pipeline `batch` wizard subcommand into a first-class CLI command).
 *
 * Reads a JSON manifest describing N pages and runs the convert pipeline for
 * each entry sequentially, then prints a summary. Entries are independent:
 * one failing page does not abort the rest (exit code reflects any failure).
 *
 * Manifest format (array of entries):
 *   [
 *     { "target": "v3", "html": "./a.html", "out": "./out/a.json" },
 *     { "target": "v4", "xml": "./b.xml",  "out": "./out/b.json" }
 *   ]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireFlag, boolFlag } from './args.js';
import { cmdConvert } from './cmd-convert.js';

export interface BatchEntry {
  target: 'v3' | 'v4';
  url?: string;
  html?: string;
  xml?: string;
  out?: string;
  /** Skip guard validation for this entry (mirrors convert --skip-guards). */
  skipGuards?: boolean;
}

export interface BatchEntryResult {
  index: number;
  source: string;
  target: string;
  exitCode: number;
  ok: boolean;
}

/** Parse + validate the manifest. Throws with a precise message on bad input. */
export function parseBatchManifest(raw: string): BatchEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`manifest is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('manifest must be a non-empty JSON array of entries');
  }
  return data.map((entry, i) => {
    const e = entry as Record<string, unknown>;
    if (e.target !== 'v3' && e.target !== 'v4') {
      throw new Error(`entry ${i}: "target" must be "v3" or "v4"`);
    }
    if (!e.url && !e.html && !e.xml) {
      throw new Error(`entry ${i}: needs one of "url", "html" or "xml"`);
    }
    return {
      target: e.target,
      url: typeof e.url === 'string' ? e.url : undefined,
      html: typeof e.html === 'string' ? e.html : undefined,
      xml: typeof e.xml === 'string' ? e.xml : undefined,
      out: typeof e.out === 'string' ? e.out : undefined,
      skipGuards: e.skipGuards === true,
    };
  });
}

function entrySource(e: BatchEntry): string {
  return e.url ?? e.html ?? e.xml ?? '<none>';
}

export async function cmdBatch(flags: Record<string, string | boolean>): Promise<number> {
  const manifestPath = requireFlag(flags, 'manifest');
  const continueOnError = !boolFlag(flags, 'stop-on-error');

  let entries: BatchEntry[];
  try {
    entries = parseBatchManifest(readFileSync(resolve(manifestPath), 'utf-8'));
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 2;
  }

  process.stdout.write(`\n📦 elconv batch — ${entries.length} page(s)\n`);

  const results: BatchEntryResult[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    process.stdout.write(`\n[${i + 1}/${entries.length}] ${e.target.toUpperCase()} ← ${entrySource(e)}\n`);

    const convertFlags: Record<string, string | boolean> = { target: e.target };
    if (e.url) convertFlags['url'] = e.url;
    if (e.html) convertFlags['html'] = e.html;
    if (e.xml) convertFlags['xml'] = e.xml;
    if (e.out) convertFlags['out'] = e.out;
    if (e.skipGuards) convertFlags['skip-guards'] = true;

    let code: number;
    try {
      code = await cmdConvert(convertFlags);
    } catch (err) {
      process.stderr.write(`  ✗ ${(err as Error).message}\n`);
      code = 1;
    }
    results.push({ index: i, source: entrySource(e), target: e.target, exitCode: code, ok: code === 0 });

    if (code !== 0 && !continueOnError) {
      process.stderr.write(`\nStopping after failure (remove --stop-on-error to continue past failures).\n`);
      break;
    }
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${'─'.repeat(50)}\n  Batch summary: ${results.length - failed.length} ok, ${failed.length} failed`);
  if (results.length < entries.length) {
    process.stdout.write(` (${entries.length - results.length} not run)`);
  }
  process.stdout.write(`\n`);
  for (const r of results) {
    process.stdout.write(`    ${r.ok ? '✅' : '❌'} [${r.index + 1}] ${r.target} ${r.source}\n`);
  }
  process.stdout.write(`${'─'.repeat(50)}\n\n`);

  return failed.length > 0 || results.length < entries.length ? 1 : 0;
}
