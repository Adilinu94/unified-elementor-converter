/**
 * elconv convert — Extract source → build target tree → validate → output.
 * KRITISCH: Target-Routing mit Anti-Contamination-Check.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SourceSpec } from '@elconv/core';
import { assertNoContamination, runGuards, formatGuardReport } from '@elconv/core';
import { extractFromHtml, extractFromFramerXml } from '@elconv/extractors';
import { buildV3Tree, V3_GUARDS } from '@elconv/target-v3';
import { buildV4Tree, V4_GUARDS } from '@elconv/target-v4';
import { requireFlag, optionalFlag, boolFlag } from './args.ts';

export interface ConvertOptions {
  target: 'v3' | 'v4';
  url?: string;
  xml?: string;
  html?: string;
  out?: string;
  skipGuards?: boolean;
}

export async function cmdConvert(flags: Record<string, string | boolean>): Promise<number> {
  const target = requireFlag(flags, 'target') as 'v3' | 'v4';
  if (target !== 'v3' && target !== 'v4') {
    process.stderr.write(`Error: --target must be "v3" or "v4", got "${target}"\n`);
    return 2;
  }

  const url = optionalFlag(flags, 'url');
  const xml = optionalFlag(flags, 'xml');
  const html = optionalFlag(flags, 'html');
  const out = optionalFlag(flags, 'out');
  const skipGuards = boolFlag(flags, 'skip-guards');

  if (!url && !xml && !html) {
    process.stderr.write('Error: one of --url, --xml, or --html is required\n');
    return 2;
  }

  // 1. Extract → SourceSpec
  let spec: SourceSpec;
  try {
    if (html) {
      const result = await extractFromHtml(resolve(html));
      spec = result.spec;
    } else if (xml) {
      const result = await extractFromFramerXml(resolve(xml));
      spec = result.spec;
    } else {
      // URL extraction would use Playwright — not yet implemented
      process.stderr.write('Error: --url extraction requires Playwright (not yet implemented). Use --html or --xml.\n');
      return 2;
    }
  } catch (err) {
    process.stderr.write(`Extraction failed: ${(err as Error).message}\n`);
    return 1;
  }

  // 2. Build target-specific tree
  let tree: unknown[];
  if (target === 'v3') {
    tree = buildV3Tree(spec);
  } else {
    tree = buildV4Tree(spec);
  }

  // 3. ANTI-CONTAMINATION CHECK (KRITISCH — immer ausführen!)
  try {
    assertNoContamination(tree, target);
  } catch (err) {
    process.stderr.write(`CONTAMINATION DETECTED: ${(err as Error).message}\n`);
    return 1;
  }

  // 4. Run target guards
  if (!skipGuards) {
    const guards = target === 'v3' ? V3_GUARDS : V4_GUARDS;
    const report = runGuards(tree, guards);
    if (!report.passed) {
      process.stderr.write(`Guard score ${report.score}/100 (threshold: ${report.threshold})\n`);
      process.stderr.write(formatGuardReport(report) + '\n');
      return 1;
    }
    process.stderr.write(`Guards passed: ${report.score}/100\n`);
  }

  // 5. Write output
  const json = JSON.stringify(tree, null, 2);
  if (out) {
    const outPath = resolve(out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, json, 'utf-8');
    process.stdout.write(`✓ ${target.toUpperCase()} tree written to ${outPath} (${Buffer.byteLength(json)} bytes)\n`);
  } else {
    process.stdout.write(json + '\n');
  }

  return 0;
}
