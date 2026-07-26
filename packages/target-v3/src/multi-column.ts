/**
 * V3 Multi-Column Builder
 *
 * Pure helpers for translating column/ratio/gap specs into numeric widths
 * and CSS for V3 multi-column sections. No DOM dependency.
 * Ported from site-clone-to-v3/src/builder/v3-multi-column.ts
 */

import type { ResponsiveOverrides } from './types.js';

export type ColumnRatio =
  | '50-50'
  | '33-34-33'
  | '25-25-25-25'
  | '20-20-20-20-20'
  | '16-17-17-17-16-17'
  | '70-30'
  | '30-70'
  | string;

export interface GapSpec {
  unit: 'px' | 'rem' | 'em' | '%';
  value: number;
}

export interface MultiColumnLayout {
  columns: number;
  ratio: string;
  gap?: GapSpec;
  responsive?: ResponsiveOverrides;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const MIN_COLUMNS = 1;
const MAX_COLUMNS = 6;

export function normalizeMultiColumn(input: { columns: number; ratio?: string; gap?: GapSpec }): {
  columns: number;
  ratio: string;
  gap: GapSpec;
} {
  const columns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.floor(input.columns)));
  const defaultRatios: Record<number, string> = {
    1: '100',
    2: '50-50',
    3: '33-34-33',
    4: '25-25-25-25',
    5: '20-20-20-20-20',
    6: '16-17-17-17-16-17',
  };
  return {
    columns,
    ratio: input.ratio ?? defaultRatios[columns] ?? '50-50',
    gap: input.gap ?? { unit: 'px', value: 20 },
  };
}

export function resolveColumnRatios(ratio: string, columns: number): number[] {
  const parts = ratio
    .split('-')
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n));

  if (parts.length === 0 || parts.reduce((s, n) => s + n, 0) === 0) {
    const equal = Math.round((100 / columns) * 100) / 100;
    return Array.from({ length: columns }, (_, i) => {
      if (i === columns - 1) {
        return Math.round((100 - equal * (columns - 1)) * 100) / 100;
      }
      return equal;
    });
  }

  if (parts.length === columns) {
    return parts.map((n) => Number(n.toFixed(2)));
  }

  const sum = parts.reduce((s, n) => s + n, 0);
  return Array.from({ length: columns }, (_, i) =>
    i < parts.length
      ? Number(((parts[i] / sum) * 100).toFixed(2))
      : Number(0),
  );
}

export function distributeColumns(
  columns: number,
  ratio: string,
  responsive?: ResponsiveOverrides,
): number[] {
  void responsive;
  return resolveColumnRatios(ratio, columns);
}

export function generateColumnCss(
  columns: number,
  ratio: string,
  gap?: GapSpec,
): string {
  const widths = resolveColumnRatios(ratio, columns);
  const widthsStr = widths.map((w) => `${w}%`).join(' ');
  const gapLine = gap && gap.value > 0 ? ` gap: ${gap.value}${gap.unit};` : '';
  return `display: grid; grid-template-columns: ${widthsStr};${gapLine}`;
}

export function validateMultiColumnLayout(layout: MultiColumnLayout): ValidationResult {
  const errors: string[] = [];
  if (layout.columns < MIN_COLUMNS || layout.columns > MAX_COLUMNS) {
    errors.push(`columns must be between ${MIN_COLUMNS} and ${MAX_COLUMNS} (got ${layout.columns})`);
  }
  if (!layout.ratio || layout.ratio.split('-').some((p) => p.trim() === '')) {
    errors.push('ratio must not contain empty parts');
  }
  const parts = (layout.ratio ?? '').split('-').map((p) => Number.parseInt(p, 10)).filter((n) => Number.isFinite(n));
  if (parts.length > 0 && parts.reduce((s, n) => s + n, 0) <= 0) {
    errors.push('ratio parts must sum to a positive number');
  }
  return { ok: errors.length === 0, errors };
}
