/**
 * Tests for the Novamira ability registry (Phase 100, BAUPLAN v5.0).
 *
 * The most important test is the CI drift-gate at the bottom: every ability
 * name referenced in production code MUST resolve to a live ability. This is
 * what prevents a repeat of the "46 dead ability references" situation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_ABILITIES,
  ALIAS_MAP,
  UNAVAILABLE_ABILITIES,
  isKnownAbility,
  isKnownUnavailable,
  tryResolveAbilityName,
  resolveAbilityName,
  diffAbilityRegistry,
  UnknownAbilityError,
} from '../../../packages/mcp/src/ability-registry.js';

describe('ability-registry — snapshot integrity', () => {
  it('contains the expected number of live abilities (263)', () => {
    expect(KNOWN_ABILITIES.length).toBe(263);
  });

  it('has no duplicate entries', () => {
    expect(new Set(KNOWN_ABILITIES).size).toBe(KNOWN_ABILITIES.length);
  });

  it('every entry is namespaced (contains a slash)', () => {
    for (const name of KNOWN_ABILITIES) {
      expect(name).toContain('/');
    }
  });

  it('every ALIAS_MAP target is itself a known ability', () => {
    for (const [legacy, target] of Object.entries(ALIAS_MAP)) {
      expect(isKnownAbility(target), `alias "${legacy}" → "${target}" must be live`).toBe(true);
    }
  });

  it('known-unavailable names are NOT accidentally also live', () => {
    for (const name of Object.keys(UNAVAILABLE_ABILITIES)) {
      expect(isKnownAbility(name), `${name} is marked unavailable but is live`).toBe(false);
    }
  });
});

describe('resolveAbilityName — legacy name mapping', () => {
  it('returns a live name unchanged', () => {
    expect(resolveAbilityName('novamira/execute-php')).toBe('novamira/execute-php');
    expect(resolveAbilityName('novamira-adrianv2/batch-build-page')).toBe(
      'novamira-adrianv2/batch-build-page',
    );
  });

  it('drops the legacy adrians- prefix', () => {
    expect(resolveAbilityName('novamira-adrianv2/adrians-media-upload')).toBe(
      'novamira-adrianv2/media-upload',
    );
    expect(resolveAbilityName('novamira-adrianv2/adrians-html-to-elementor-widget-plan')).toBe(
      'novamira-adrianv2/html-to-elementor-widget-plan',
    );
  });

  it('moves adrians- names from the old novamira namespace to adrianv2', () => {
    expect(resolveAbilityName('novamira/adrians-layout-audit')).toBe(
      'novamira-adrianv2/layout-audit',
    );
    expect(resolveAbilityName('novamira/adrians-visual-qa')).toBe('novamira-adrianv2/visual-qa');
    expect(resolveAbilityName('novamira/adrians-export-design-system')).toBe(
      'novamira-adrianv2/export-design-system',
    );
  });

  it('swaps namespaces for names that moved between them', () => {
    // execute-php lives only in the novamira/ namespace
    expect(resolveAbilityName('novamira-adrianv2/execute-php')).toBe('novamira/execute-php');
    // clear-document-cache lives only in novamira/
    expect(resolveAbilityName('novamira-adrianv2/elementor-clear-document-cache')).toBe(
      'novamira/elementor-clear-document-cache',
    );
    // audit-page-* moved to adrianv2
    expect(resolveAbilityName('novamira/audit-page-a11y')).toBe('novamira-adrianv2/audit-page-a11y');
    expect(resolveAbilityName('novamira/setup-v4-foundation')).toBe(
      'novamira-adrianv2/setup-v4-foundation',
    );
  });

  it('applies explicit aliases for non-mechanical renames', () => {
    expect(resolveAbilityName('novamira/upload')).toBe('novamira/create-upload-link');
    expect(resolveAbilityName('novamira-adrianv2/inject-calibrated-page')).toBe(
      'novamira-adrianv2/elementor-inject-calibrated-page',
    );
    expect(resolveAbilityName('novamira-adrianv2/set-page-content')).toBe(
      'novamira-adrianv2/batch-build-page',
    );
  });

  it('throws UnknownAbilityError with a suggestion for a typo', () => {
    let err: unknown;
    try {
      resolveAbilityName('novamira-adrianv2/batch-buildd-page');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnknownAbilityError);
    expect((err as UnknownAbilityError).suggestion).toBe('novamira-adrianv2/batch-build-page');
  });

  it('throws for a completely unknown ability', () => {
    expect(() => resolveAbilityName('novamira/there-is-no-such-thing-xyz')).toThrow(
      UnknownAbilityError,
    );
  });

  it('tryResolveAbilityName returns null instead of throwing', () => {
    expect(tryResolveAbilityName('novamira/there-is-no-such-thing-xyz')).toBeNull();
    expect(tryResolveAbilityName('novamira/upload')).toBe('novamira/create-upload-link');
  });
});

describe('diffAbilityRegistry', () => {
  it('reports inSync when live matches the snapshot exactly', () => {
    const drift = diffAbilityRegistry(KNOWN_ABILITIES);
    expect(drift.inSync).toBe(true);
    expect(drift.addedOnServer).toEqual([]);
    expect(drift.removedFromServer).toEqual([]);
    expect(drift.liveCount).toBe(KNOWN_ABILITIES.length);
  });

  it('detects a new server ability missing from the snapshot', () => {
    const drift = diffAbilityRegistry([...KNOWN_ABILITIES, 'novamira-adrianv2/brand-new-thing']);
    expect(drift.inSync).toBe(false);
    expect(drift.addedOnServer).toContain('novamira-adrianv2/brand-new-thing');
    expect(drift.removedFromServer).toEqual([]);
  });

  it('detects a snapshot ability that is gone from the server', () => {
    const reduced = KNOWN_ABILITIES.filter((n) => n !== 'novamira/execute-php');
    const drift = diffAbilityRegistry(reduced);
    expect(drift.inSync).toBe(false);
    expect(drift.removedFromServer).toContain('novamira/execute-php');
  });

  it('flags a previously-unavailable ability that became live', () => {
    const drift = diffAbilityRegistry([...KNOWN_ABILITIES, 'novamira/elementor-render-preview']);
    expect(drift.nowAvailable).toContain('novamira/elementor-render-preview');
  });
});

// ============================================================================
// CI DRIFT-GATE: no dead ability references in production code
// ============================================================================

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'tests') continue;
      collectTsFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('ability-registry — CI drift-gate (production code)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const packagesDir = join(here, '..', '..', '..', 'packages');
  // Match quoted 'novamira/...' or 'novamira-adrianv2/...' ability literals.
  const ABILITY_LITERAL = /['"`](novamira(?:-adrianv2)?\/[a-z0-9][a-z0-9-]*[a-z0-9])['"`]/g;

  it('every novamira/* ability literal in packages/ resolves to a live ability', () => {
    const files = collectTsFiles(packagesDir);
    const unresolved: Array<{ file: string; name: string }> = [];

    for (const file of files) {
      // The registry file itself contains all 263 names as data, not calls.
      if (file.endsWith('ability-registry.ts')) continue;
      const src = readFileSync(file, 'utf-8');
      let m: RegExpExecArray | null;
      while ((m = ABILITY_LITERAL.exec(src)) !== null) {
        const name = m[1];
        if (tryResolveAbilityName(name) === null && !isKnownUnavailable(name)) {
          unresolved.push({ file: file.replace(packagesDir, 'packages'), name });
        }
      }
    }

    expect(
      unresolved,
      `Unresolved ability references (fix the name or add an alias):\n${unresolved
        .map((u) => `  ${u.name}  (${u.file})`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
