/**
 * Tests for CV4:breakpoint-variants in the QA cross-validator.
 *
 * P5 (BAUPLAN-v6.0 §11.2) added the distinction this file locks in: a section
 * with `tablet_padding` is NOT "desktop-only", it is mis-wired — the override
 * exists in `_elementor_data` but Elementor never renders it. Before the fix
 * both cases produced the same report, so a fully broken responsive tree read
 * as a benign info-level finding.
 */

import { describe, it, expect } from 'vitest';
import { crossValidateV3 } from '@elconv/qa';
import type { DesignTokens } from '@elconv/core';

const NO_TOKENS: DesignTokens = {
  colors: [],
  fonts: [],
  spacing: [],
  radii: [],
  shadows: [],
} as unknown as DesignTokens;

interface TestElement {
  id: string;
  elType?: string;
  widgetType?: string;
  settings?: Record<string, unknown>;
  elements?: TestElement[];
}

function section(id: string, settings: Record<string, unknown>): TestElement {
  return { id, elType: 'section', settings, elements: [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cv4 = (tree: TestElement[]) =>
  crossValidateV3(NO_TOKENS, tree as any, 'https://example.test').checks.find(
    (c) => c.name === 'CV4:breakpoint-variants',
  )!;

describe('CV4:breakpoint-variants', () => {
  it('skips when the tree has no sections', () => {
    expect(cv4([]).status).toBe('skip');
  });

  it('passes when every section has a suffixed override', () => {
    const result = cv4([
      section('s1', { padding_tablet: '20px' }),
      section('s2', { padding_mobile: '10px' }),
    ]);
    expect(result.status).toBe('pass');
    expect(result.driftCount).toBe(0);
  });

  it('reports prefix misuse as an error, not as "desktop-only"', () => {
    const result = cv4([section('s1', { tablet_padding: '20px' })]);
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('error');
    expect(result.message).toContain('Elementor ignores these overrides');
    expect(result.details?.[0]).toContain('tablet_padding');
  });

  it('prioritises prefix misuse over the missing-override finding', () => {
    // s1 is mis-wired, s2 genuinely has nothing. The mis-wiring must win,
    // because it is the actionable defect.
    const result = cv4([section('s1', { mobile_padding: '4px' }), section('s2', {})]);
    expect(result.severity).toBe('error');
    expect(result.driftCount).toBe(1);
  });

  it('still reports a genuinely desktop-only tree as a warning', () => {
    const result = cv4([section('s1', {}), section('s2', {})]);
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('desktop-only');
  });

  it('does not count Elementor hide_tablet switchers as responsive overrides', () => {
    const result = cv4([section('s1', { hide_tablet: 'yes' })]);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('desktop-only');
  });

  it('marks the run as failed when prefix misuse is present', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = crossValidateV3(NO_TOKENS, [section('s1', { tablet_padding: '1px' })] as any);
    expect(report.passed).toBe(false);
  });
});
