/**
 * V3/V4 Isolation Test — Verifies strict package-level separation.
 * DoD requirement: "Ein dedizierter Test verifiziert die V3/V4-Isolation aktiv
 * (Cross-Import schlägt fehl / Contamination-Check greift)"
 *
 * This test performs static analysis on source files to ensure:
 * 1. target-v3 NEVER imports from @elconv/target-v4
 * 2. target-v4 NEVER imports from @elconv/target-v3
 * 3. core NEVER imports from either target package
 * 4. Runtime contamination detection works correctly
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  assertNoContamination,
  findContamination,
} from '../../../packages/core/src/contamination.ts';

// ============================================================================
// Static Import Analysis
// ============================================================================

const PACKAGES_ROOT = join(__dirname, '..', '..', '..', 'packages');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      files.push(...collectTsFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function findImportsOf(files: string[], forbiddenPackage: string): Array<{ file: string; line: string }> {
  const violations: Array<{ file: string; line: string }> = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      // Check for import statements
      if (
        (line.includes('import') || line.includes('from') || line.includes('require')) &&
        line.includes(forbiddenPackage)
      ) {
        violations.push({
          file: relative(PACKAGES_ROOT, file),
          line: trimmed,
        });
      }
    }
  }

  return violations;
}

describe('V3/V4 Package Isolation (Static Analysis)', () => {
  it('target-v3 NEVER imports from @elconv/target-v4', () => {
    const v3Files = collectTsFiles(join(PACKAGES_ROOT, 'target-v3', 'src'));
    const violations = findImportsOf(v3Files, '@elconv/target-v4');

    expect(violations).toEqual([]);
  });

  it('target-v4 NEVER imports from @elconv/target-v3', () => {
    const v4Files = collectTsFiles(join(PACKAGES_ROOT, 'target-v4', 'src'));
    const violations = findImportsOf(v4Files, '@elconv/target-v3');

    expect(violations).toEqual([]);
  });

  it('core NEVER imports from target-v3 or target-v4', () => {
    const coreFiles = collectTsFiles(join(PACKAGES_ROOT, 'core', 'src'));
    const v3Violations = findImportsOf(coreFiles, '@elconv/target-v3');
    const v4Violations = findImportsOf(coreFiles, '@elconv/target-v4');

    expect(v3Violations).toEqual([]);
    expect(v4Violations).toEqual([]);
  });

  it('extractors NEVER imports from target-v3 or target-v4', () => {
    const extFiles = collectTsFiles(join(PACKAGES_ROOT, 'extractors', 'src'));
    const v3Violations = findImportsOf(extFiles, '@elconv/target-v3');
    const v4Violations = findImportsOf(extFiles, '@elconv/target-v4');

    expect(v3Violations).toEqual([]);
    expect(v4Violations).toEqual([]);
  });

  it('qa NEVER imports from target-v3 or target-v4', () => {
    const qaFiles = collectTsFiles(join(PACKAGES_ROOT, 'qa', 'src'));
    const v3Violations = findImportsOf(qaFiles, '@elconv/target-v3');
    const v4Violations = findImportsOf(qaFiles, '@elconv/target-v4');

    expect(v3Violations).toEqual([]);
    expect(v4Violations).toEqual([]);
  });
});

// ============================================================================
// Runtime Contamination Detection
// ============================================================================

describe('V3/V4 Contamination Detection (Runtime)', () => {
  it('rejects V4 atomic types in V3 tree', () => {
    const v4InV3 = [
      { id: 'x1', type: 'e-flexbox', elType: 'e-flexbox', settings: {} },
    ];
    expect(() => assertNoContamination(v4InV3, 'v3')).toThrow();
  });

  it('rejects $$type markers in V3 tree', () => {
    const dollarType = [
      { id: 'x2', settings: { color: { '$$type': 'color', value: '#ff0000' } } },
    ];
    expect(() => assertNoContamination(dollarType, 'v3')).toThrow();
  });

  it('rejects V3 section/column in V4 tree', () => {
    const v3InV4 = [
      { id: 'x3', elType: 'section', isInner: false, settings: {} },
    ];
    expect(() => assertNoContamination(v3InV4, 'v4')).toThrow();
  });

  it('accepts clean V3 tree', () => {
    const cleanV3 = [
      {
        id: 's1',
        elType: 'container',
        settings: { flex_direction: 'column' },
        elements: [
          { id: 'w1', elType: 'widget', widgetType: 'heading', settings: { title: 'Hello' } },
        ],
      },
    ];
    expect(() => assertNoContamination(cleanV3, 'v3')).not.toThrow();
  });

  it('accepts clean V4 tree', () => {
    const cleanV4 = [
      {
        id: 'fb1',
        type: 'e-flexbox',
        elType: 'e-flexbox',
        widgetType: 'e-flexbox',
        settings: {},
        styles: {},
      },
    ];
    expect(() => assertNoContamination(cleanV4, 'v4')).not.toThrow();
  });

  it('findContamination returns all V4 markers found in V3 tree', () => {
    const mixed = [
      {
        id: 'bad',
        type: 'e-heading',
        widget: 'e-button',
        style: { '$$type': 'size' },
        ref: 'global-color-variable',
      },
    ];
    const violations = findContamination(mixed, 'v3');
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });
});
