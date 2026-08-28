/**
 * elconv batch — Multi-page batch build (Phase 107, ported from the
 * V4-Pipeline `batch` wizard subcommand into a first-class CLI command;
 * completed as the V10 batch orchestrator in Phase 113).
 *
 * Reads a JSON manifest describing N pages and runs the convert pipeline for
 * each entry, then prints a summary. Entries are independent: one failing
 * page does not abort the rest (exit code reflects any failure).
 *
 * Orchestration (Phase 113): `--concurrency <n>` runs entries in parallel via
 * @elconv/mcp's BatchScheduler (with `--retry <n>` exponential-backoff
 * retries); `--rate-limit <per-minute>` spaces out entry STARTS; `--resume`
 * skips entries whose `out` file already exists. `--stop-on-error` implies
 * sequential execution (an in-flight parallel batch cannot be aborted cleanly).
 *
 * Manifest format (array of entries):
 *   [
 *     { "target": "v3", "html": "./a.html", "out": "./out/a.json" },
 *     { "target": "v4", "xml": "./b.xml",  "out": "./out/b.json" }
 *   ]
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireFlag, optionalFlag, boolFlag } from './args.js';
import { cmdConvert } from './cmd-convert.js';
import { BatchScheduler } from '@elconv/mcp';
import { ProgressTracker } from '@elconv/core';

export interface BatchEntry {
  target: 'v3' | 'v4';
  url?: string;
  html?: string;
  xml?: string;
  out?: string;
  /** Skip guard validation for this entry (mirrors convert --skip-guards). */
  skipGuards?: boolean;
  /** Skip the control-schema gate for this entry (mirrors convert --skip-schema-gate). */
  skipSchemaGate?: boolean;
}

export interface BatchEntryResult {
  index: number;
  source: string;
  target: string;
  exitCode: number;
  ok: boolean;
  skipped?: boolean;
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
      skipSchemaGate: e.skipSchemaGate === true,
    };
  });
}

function entrySource(e: BatchEntry): string {
  return e.url ?? e.html ?? e.xml ?? '<none>';
}

function entryConvertFlags(e: BatchEntry): Record<string, string | boolean> {
  const convertFlags: Record<string, string | boolean> = { target: e.target };
  if (e.url) convertFlags['url'] = e.url;
  if (e.html) convertFlags['html'] = e.html;
  if (e.xml) convertFlags['xml'] = e.xml;
  if (e.out) convertFlags['out'] = e.out;
  if (e.skipGuards) convertFlags['skip-guards'] = true;
  if (e.skipSchemaGate) convertFlags['skip-schema-gate'] = true;
  return convertFlags;
}

async function runEntry(e: BatchEntry): Promise<number> {
  try {
    return await cmdConvert(entryConvertFlags(e));
  } catch (err) {
    process.stderr.write(`  ✗ ${(err as Error).message}\n`);
    return 1;
  }
}

export async function cmdBatch(flags: Record<string, string | boolean>): Promise<number> {
  const manifestPath = requireFlag(flags, 'manifest');
  const stopOnError = boolFlag(flags, 'stop-on-error');
  const continueOnError = !stopOnError;
  const requestedConcurrency = Math.max(1, Number(optionalFlag(flags, 'concurrency') ?? '1') || 1);
  // An in-flight parallel batch cannot be aborted cleanly — fail-fast means sequential.
  const concurrency = stopOnError ? 1 : requestedConcurrency;
  const ratePerMinute = Math.max(0, Number(optionalFlag(flags, 'rate-limit') ?? '0') || 0);
  const retries = Math.max(0, Number(optionalFlag(flags, 'retry') ?? '0') || 0);
  const resume = boolFlag(flags, 'resume');

  let entries: BatchEntry[];
  try {
    entries = parseBatchManifest(readFileSync(resolve(manifestPath), 'utf-8'));
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 2;
  }

  process.stdout.write(`\n📦 elconv batch — ${entries.length} page(s), concurrency ${concurrency}`);
  if (ratePerMinute > 0) process.stdout.write(`, rate-limit ${ratePerMinute}/min`);
  if (retries > 0) process.stdout.write(`, retry ${retries}`);
  process.stdout.write(`\n`);
  if (stopOnError && requestedConcurrency > 1) {
    process.stdout.write('  (stop-on-error forces sequential execution)\n');
  }

  const progress = new ProgressTracker({
    total: entries.length,
    sink: (line) => process.stdout.write(`  ⏱  ${line}\n`),
  });
  progress.start();

  // --resume: skip entries whose output already exists from a previous run.
  const skipped = new Set<number>();
  if (resume) {
    for (let i = 0; i < entries.length; i++) {
      const out = entries[i].out;
      if (out && existsSync(resolve(out))) skipped.add(i);
    }
    if (skipped.size > 0) {
      process.stdout.write(`  ↺ resume: skipping ${skipped.size} entr${skipped.size === 1 ? 'y' : 'ies'} with existing output\n`);
    }
  }

  const results: BatchEntryResult[] = [];

  if (concurrency === 1) {
    // Sequential path — preserves strict ordering and honors --stop-on-error.
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (skipped.has(i)) {
        results.push({ index: i, source: entrySource(e), target: e.target, exitCode: 0, ok: true, skipped: true });
        progress.advance(entrySource(e));
        continue;
      }
      process.stdout.write(`\n[${i + 1}/${entries.length}] ${e.target.toUpperCase()} ← ${entrySource(e)}\n`);

      let code = await runEntry(e);
      for (let attempt = 1; code !== 0 && attempt <= retries; attempt++) {
        process.stdout.write(`  ↻ retry ${attempt}/${retries}\n`);
        code = await runEntry(e);
      }
      results.push({ index: i, source: entrySource(e), target: e.target, exitCode: code, ok: code === 0 });
      progress.advance(entrySource(e));

      if (code !== 0 && !continueOnError) {
        process.stderr.write(`\nStopping after failure (remove --stop-on-error to continue past failures).\n`);
        break;
      }
    }
  } else {
    // Parallel path (Phase 113): BatchScheduler gives a worker pool + retries
    // with exponential backoff; a shared gate spaces out task STARTS so a
    // rate limit (starts per minute) holds even while entries run in parallel.
    const scheduler = new BatchScheduler({ name: 'elconv-batch', concurrency, maxRetries: retries });
    const minStartGapMs = ratePerMinute > 0 ? Math.ceil(60_000 / ratePerMinute) : 0;
    let gate: Promise<void> = Promise.resolve();
    const acquireStartSlot = (): Promise<void> => {
      const mySlot = gate;
      gate = gate.then(() => new Promise((r) => setTimeout(r, minStartGapMs)));
      return mySlot;
    };

    const settled = await scheduler.scheduleAll(
      entries.map((e, i) => ({
        fn: async () => {
          if (skipped.has(i)) return { index: i, code: 0, skippedEntry: true };
          await acquireStartSlot();
          process.stdout.write(`\n[${i + 1}/${entries.length}] ${e.target.toUpperCase()} ← ${entrySource(e)}\n`);
          const code = await runEntry(e);
          // Throw on failure so BatchScheduler's retry/backoff engages.
          if (code !== 0) throw new Error(`entry ${i} exited ${code}`);
          return { index: i, code, skippedEntry: false };
        },
        options: { ability: `convert:${entrySource(e)}` },
      })),
    );

    settled.forEach((outcome, i) => {
      const e = entries[i];
      const ok = outcome.status === 'fulfilled';
      results.push({
        index: i,
        source: entrySource(e),
        target: e.target,
        exitCode: ok ? 0 : 1,
        ok,
        skipped: ok && (outcome.value as { skippedEntry: boolean }).skippedEntry,
      });
      progress.advance(entrySource(e));
    });
    results.sort((a, b) => a.index - b.index);
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${'─'.repeat(50)}\n  Batch summary: ${results.length - failed.length} ok, ${failed.length} failed`);
  if (results.length < entries.length) {
    process.stdout.write(` (${entries.length - results.length} not run)`);
  }
  process.stdout.write(`\n`);
  for (const r of results) {
    process.stdout.write(`    ${r.ok ? '✅' : '❌'} [${r.index + 1}] ${r.target} ${r.source}${r.skipped ? ' (resumed, skipped)' : ''}\n`);
  }
  process.stdout.write(`${'─'.repeat(50)}\n\n`);

  return failed.length > 0 || results.length < entries.length ? 1 : 0;
}
