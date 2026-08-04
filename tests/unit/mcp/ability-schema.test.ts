import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ABILITY_SCHEMA_ID,
  ABILITY_SCHEMA_VERSION,
  abilityJsonSchemaDocument,
  abilityNamespace,
  abilityNamespaceCounts,
  buildAbilityRegistrySnapshot,
} from '@elconv/mcp';
import {
  KNOWN_ABILITIES,
  ALIAS_MAP,
  UNAVAILABLE_ABILITIES,
  isKnownAbility,
} from '../../../packages/mcp/src/ability-registry.js';

/**
 * Ability-Schema Codegen (O-12 follow-up).
 *
 * The versioned `novamira-abilities.schema.json` is derived from the ability
 * registry (KNOWN_ABILITIES / ALIAS_MAP / UNAVAILABLE_ABILITIES — the frozen
 * snapshot of the live server). These tests pin the generated document, the
 * committed schema file (drift guard), the registry snapshot payload and the
 * registry back to the live-abilities .txt capture — so the schema, the
 * registry and the discovery file can never silently fall out of sync.
 */

describe('abilityJsonSchemaDocument — versioned schema codegen', () => {
  it('carries the schema id, draft and version metadata', () => {
    const doc = abilityJsonSchemaDocument();
    expect(doc.$id).toBe(ABILITY_SCHEMA_ID);
    expect(doc.$schema).toContain('draft/2020-12');
    expect(doc.version).toBe(ABILITY_SCHEMA_VERSION);
    expect(doc.title).toBe('Novamira ability registry snapshot');
    expect(doc.type).toBe('object');
  });

  it('enumerates every known ability exactly once', () => {
    const doc = abilityJsonSchemaDocument();
    const defs = (doc.$defs ?? {}) as Record<string, { enum?: string[] }>;
    const enumNames = defs.abilityName?.enum ?? [];
    expect(enumNames).toHaveLength(KNOWN_ABILITIES.length);
    expect(new Set(enumNames).size).toBe(KNOWN_ABILITIES.length);
    expect(enumNames).toEqual([...KNOWN_ABILITIES]);
  });

  it('every enum entry is a live known ability and vice versa', () => {
    const doc = abilityJsonSchemaDocument();
    const defs = (doc.$defs ?? {}) as Record<string, { enum?: string[] }>;
    const enumNames = defs.abilityName?.enum ?? [];
    for (const name of enumNames) expect(isKnownAbility(name)).toBe(true);
    for (const name of KNOWN_ABILITIES) expect(enumNames).toContain(name);
  });

  it('describes the registry snapshot root with the machine gate', () => {
    const doc = abilityJsonSchemaDocument();
    const properties = (doc.properties ?? {}) as Record<string, { const?: unknown }>;
    expect(properties.schemaVersion).toMatchObject({ const: 1 });
    expect(properties.$schema).toMatchObject({ const: ABILITY_SCHEMA_ID });
    expect((doc.required as string[]).sort()).toEqual([
      '$schema',
      'aliases',
      'knownAbilities',
      'schemaVersion',
      'unavailableAbilities',
    ]);
  });

  it('is deterministic (same document on every call)', () => {
    expect(JSON.stringify(abilityJsonSchemaDocument())).toBe(
      JSON.stringify(abilityJsonSchemaDocument()),
    );
  });
});

describe('abilityNamespace / abilityNamespaceCounts', () => {
  it('splits an ability name into its namespace', () => {
    expect(abilityNamespace('novamira-adrianv2/batch-build-page')).toBe('novamira-adrianv2');
    expect(abilityNamespace('novamira/execute-php')).toBe('novamira');
    expect(abilityNamespace('mcp-adapter/discover-abilities')).toBe('mcp-adapter');
    expect(abilityNamespace('unprefixed')).toBe('');
  });

  it('counts per namespace and sums to the registry size', () => {
    const counts = abilityNamespaceCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(KNOWN_ABILITIES.length);
    expect(counts['mcp-adapter']).toBe(1);
  });

  it('returns keys in sorted order (determinism guarantee)', () => {
    const counts = abilityNamespaceCounts();
    expect(Object.keys(counts)).toEqual(Object.keys(counts).sort());
  });

  it('counts a custom list deterministically', () => {
    expect(abilityNamespaceCounts(['novamira/a', 'novamira-adrianv2/b'])).toEqual({
      'novamira': 1,
      'novamira-adrianv2': 1,
    });
  });
});

describe('buildAbilityRegistrySnapshot — payload the schema describes', () => {
  it('is self-describing and matches the registry', () => {
    const snapshot = buildAbilityRegistrySnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.$schema).toBe(ABILITY_SCHEMA_ID);
    expect(snapshot.knownAbilities).toEqual(KNOWN_ABILITIES);
    expect(snapshot.aliases).toEqual(ALIAS_MAP);
    expect(snapshot.unavailableAbilities).toEqual(UNAVAILABLE_ABILITIES);
    expect(snapshot.namespaceCounts).toEqual(abilityNamespaceCounts());
  });

  it('the snapshot validates against the generated document root', () => {
    const snapshot = buildAbilityRegistrySnapshot() as Record<string, unknown>;
    const doc = abilityJsonSchemaDocument();
    const properties = (doc.properties ?? {}) as Record<string, { required?: string[]; uniqueItems?: boolean }>;
    const required = doc.required as string[];
    for (const key of required) {
      expect(snapshot[key], `snapshot is missing required ${key}`).toBeDefined();
    }
    // knownAbilities must be a unique, non-empty array (schema contract).
    const known = snapshot.knownAbilities as unknown[];
    expect(Array.isArray(known)).toBe(true);
    expect(known.length).toBeGreaterThanOrEqual(1);
    expect(new Set(known).size).toBe(known.length);
    expect(properties.knownAbilities).toMatchObject({ uniqueItems: true });
  });
});

describe('committed schema file — drift guard', () => {
  it('schemas/novamira-abilities.schema.json matches the generated document', () => {
    const committed = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../../schemas/novamira-abilities.schema.json'), 'utf8'),
    ) as Record<string, unknown>;
    // Regenerate if it drifts:
    //   node --import tsx scripts/export-ability-schema.ts
    expect(committed).toEqual(abilityJsonSchemaDocument());
  });
});

describe('registry ↔ live-abilities .txt capture — drift guard', () => {
  it('the .txt discovery file contains exactly the KNOWN_ABILITIES set', () => {
    const txt = readFileSync(
      resolve(import.meta.dirname, '../../../docs/NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt'),
      'utf8',
    );
    const lines = txt.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect(lines).toHaveLength(KNOWN_ABILITIES.length);
    expect(new Set(lines)).toEqual(new Set(KNOWN_ABILITIES));
  });
});
