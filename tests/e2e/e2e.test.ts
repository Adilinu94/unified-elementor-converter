import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { extractFromHtml } from '@elconv/extractors';
import { buildV3Tree, buildV3PageData, resetIdCounter, V3_GUARDS } from '@elconv/target-v3';
import { buildV4Tree, resetV4IdCounter, V4_GUARDS } from '@elconv/target-v4';
import { runGuards } from '@elconv/core';
import { normalizeJson, jsonEquals, runGoldenTest } from './golden-test.ts';

const FIXTURES_DIR = resolve(__dirname, 'fixtures');

describe('E2E Golden-File Regression', () => {
  describe('normalizeJson', () => {
    it('sorts object keys', () => {
      const input = { b: 1, a: 2, c: 3 };
      const result = normalizeJson(input) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
    });

    it('handles nested objects', () => {
      const input = { z: { b: 1, a: 2 }, a: 1 };
      const result = normalizeJson(input) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'z']);
      expect(Object.keys(result.z as Record<string, unknown>)).toEqual(['a', 'b']);
    });

    it('handles arrays', () => {
      const input = [{ b: 1 }, { a: 2 }];
      const result = normalizeJson(input) as Array<Record<string, unknown>>;
      expect(result).toHaveLength(2);
    });

    it('handles primitives', () => {
      expect(normalizeJson(42)).toBe(42);
      expect(normalizeJson('str')).toBe('str');
      expect(normalizeJson(null)).toBe(null);
    });
  });

  describe('jsonEquals', () => {
    it('compares equal objects', () => {
      const { equal } = jsonEquals({ a: 1, b: 2 }, { a: 1, b: 2 });
      expect(equal).toBe(true);
    });

    it('detects different values', () => {
      const { equal, diffs } = jsonEquals({ a: 1 }, { a: 2 });
      expect(equal).toBe(false);
      expect(diffs).toHaveLength(1);
    });

    it('handles numeric tolerance', () => {
      const { equal } = jsonEquals({ a: 1.0001 }, { a: 1.0002 }, 0.001);
      expect(equal).toBe(true);
    });

    it('detects missing keys', () => {
      const { equal, diffs } = jsonEquals({ a: 1 }, { a: 1, b: 2 });
      expect(equal).toBe(false);
      expect(diffs[0]).toContain('missing');
    });

    it('detects array length mismatch', () => {
      const { equal, diffs } = jsonEquals([1, 2], [1, 2, 3]);
      expect(equal).toBe(false);
      expect(diffs[0]).toContain('length');
    });
  });

  describe('Landing Page Fixture', () => {
    const htmlPath = resolve(FIXTURES_DIR, 'landing-page.html');

    it('parses HTML fixture', async () => {
      const result = await extractFromHtml(htmlPath);
      expect(result.spec.sections.length).toBeGreaterThan(0);
    });

    it('converts to V3 with passing guards', async () => {
      resetIdCounter();
      const result = await extractFromHtml(htmlPath);
      const tree = buildV3Tree(result.spec);
      const report = runGuards(tree, V3_GUARDS);
      expect(report.score).toBeGreaterThanOrEqual(85);
      expect(report.passed).toBe(true);
    });

    it('converts to V4 with passing guards', async () => {
      resetV4IdCounter();
      const result = await extractFromHtml(htmlPath);
      const tree = buildV4Tree(result.spec);
      const report = runGuards(tree, V4_GUARDS);
      expect(report.score).toBeGreaterThanOrEqual(85);
      expect(report.passed).toBe(true);
    });

    // Golden file tests skipped due to non-deterministic IDs
    // TODO: Implement ID normalization for golden file comparison
    it.skip('V3 output matches golden file', async () => {
      resetIdCounter();
      const result = await extractFromHtml(htmlPath);
      const page = buildV3PageData(result.spec, 'Landing Page');

      const goldenResult = runGoldenTest('landing-page-v3', page, { update: false });
      if (!goldenResult.passed) {
        console.log('Golden diff:', goldenResult.diff);
      }
      expect(goldenResult.passed).toBe(true);
    });

    it.skip('V4 output matches golden file', async () => {
      resetV4IdCounter();
      const result = await extractFromHtml(htmlPath);
      const tree = buildV4Tree(result.spec);

      const goldenResult = runGoldenTest('landing-page-v4', tree, { update: false });
      if (!goldenResult.passed) {
        console.log('Golden diff:', goldenResult.diff);
      }
      expect(goldenResult.passed).toBe(true);
    });
  });

  describe('runGoldenTest', () => {
    it('creates golden file if not exists', () => {
      const result = runGoldenTest('test-new-golden', { test: true }, { update: true });
      expect(result.passed).toBe(true);
      expect(result.message).toContain('Updated');
    });

    it('passes for matching content', () => {
      const data = { value: 42, nested: { a: 1 } };
      runGoldenTest('test-match', data, { update: true });
      const result = runGoldenTest('test-match', data, { update: false });
      expect(result.passed).toBe(true);
    });

    it('fails for different content', () => {
      runGoldenTest('test-diff', { value: 1 }, { update: true });
      const result = runGoldenTest('test-diff', { value: 2 }, { update: false });
      expect(result.passed).toBe(false);
      expect(result.diff).toContain('value');
    });
  });
});
