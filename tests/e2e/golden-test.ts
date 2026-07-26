/**
 * Golden-File Regression Test Infrastructure.
 * Compares actual conversion output against stored golden files.
 * If golden file doesn't exist, creates it (update mode).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export interface GoldenTestOptions {
  /** Update golden files instead of comparing */
  update?: boolean;
  /** Normalize output before comparison (sort keys, etc.) */
  normalize?: boolean;
  /** Tolerance for numeric values (floating point) */
  tolerance?: number;
}

export interface GoldenTestResult {
  passed: boolean;
  goldenPath: string;
  message: string;
  diff?: string;
}

/**
 * Normalize JSON for stable comparison.
 */
export function normalizeJson(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizeJson);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = normalizeJson((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Compare two JSON structures with tolerance.
 */
export function jsonEquals(
  actual: unknown,
  expected: unknown,
  tolerance = 0.001,
  path = '',
): { equal: boolean; diffs: string[] } {
  const diffs: string[] = [];

  function compare(a: unknown, e: unknown, p: string): void {
    if (a === e) return;

    if (typeof a === 'number' && typeof e === 'number') {
      if (Math.abs(a - e) > tolerance) {
        diffs.push(`${p}: ${a} ≠ ${e} (tolerance: ${tolerance})`);
      }
      return;
    }

    if (typeof a !== typeof e) {
      diffs.push(`${p}: type mismatch (${typeof a} vs ${typeof e})`);
      return;
    }

    if (a === null || e === null) {
      if (a !== e) diffs.push(`${p}: ${a} ≠ ${e}`);
      return;
    }

    if (Array.isArray(a) && Array.isArray(e)) {
      if (a.length !== e.length) {
        diffs.push(`${p}: array length ${a.length} ≠ ${e.length}`);
        return;
      }
      for (let i = 0; i < a.length; i++) {
        compare(a[i], e[i], `${p}[${i}]`);
      }
      return;
    }

    if (typeof a === 'object' && typeof e === 'object') {
      const aObj = a as Record<string, unknown>;
      const eObj = e as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(aObj), ...Object.keys(eObj)]);
      for (const key of allKeys) {
        if (!(key in aObj)) {
          diffs.push(`${p}.${key}: missing in actual`);
        } else if (!(key in eObj)) {
          diffs.push(`${p}.${key}: unexpected in actual`);
        } else {
          compare(aObj[key], eObj[key], `${p}.${key}`);
        }
      }
      return;
    }

    if (a !== e) {
      diffs.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(e)}`);
    }
  }

  compare(actual, expected, path || 'root');
  return { equal: diffs.length === 0, diffs };
}

/**
 * Run a golden-file test.
 */
export function runGoldenTest(
  name: string,
  actual: unknown,
  options: GoldenTestOptions = {},
): GoldenTestResult {
  const { update = false, normalize = true, tolerance = 0.001 } = options;

  const goldenDir = resolve(__dirname, 'golden');
  const goldenPath = resolve(goldenDir, `${name}.golden.json`);

  const output = normalize ? normalizeJson(actual) : actual;
  const outputJson = JSON.stringify(output, null, 2);

  // Update mode: write golden file
  if (update || !existsSync(goldenPath)) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, outputJson, 'utf-8');
    return {
      passed: true,
      goldenPath,
      message: update ? `Updated golden file: ${name}` : `Created golden file: ${name}`,
    };
  }

  // Compare mode
  try {
    const goldenContent = readFileSync(goldenPath, 'utf-8');
    const golden = JSON.parse(goldenContent);
    const expected = normalize ? normalizeJson(golden) : golden;

    const { equal, diffs } = jsonEquals(output, expected, tolerance);

    if (equal) {
      return { passed: true, goldenPath, message: `Golden test passed: ${name}` };
    }

    return {
      passed: false,
      goldenPath,
      message: `Golden test failed: ${name}`,
      diff: diffs.slice(0, 20).join('\n'),
    };
  } catch (err) {
    return {
      passed: false,
      goldenPath,
      message: `Failed to read golden file: ${err}`,
    };
  }
}

/**
 * List all golden files.
 */
export function listGoldenFiles(): string[] {
  const goldenDir = resolve(__dirname, 'golden');
  if (!existsSync(goldenDir)) return [];

  const { readdirSync } = require('node:fs');
  return readdirSync(goldenDir)
    .filter((f: string) => f.endsWith('.golden.json'))
    .map((f: string) => f.replace('.golden.json', ''));
}

/**
 * Delete a golden file (for regeneration).
 */
export function deleteGoldenFile(name: string): boolean {
  const goldenPath = resolve(__dirname, 'golden', `${name}.golden.json`);
  if (existsSync(goldenPath)) {
    const { unlinkSync } = require('node:fs');
    unlinkSync(goldenPath);
    return true;
  }
  return false;
}
