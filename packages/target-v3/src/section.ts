/**
 * V3 Section Model
 *
 * Implements the V3 Section data-structure with multi-column support,
 * inner-section composition, and responsive breakpoint overrides.
 * Ported from site-clone-to-v3/src/builder/v3-section.ts
 */

import type { ResponsiveOverrides, ResponsiveBreakpoint } from './types.js';

export type SectionStructureType =
  | 'full-width'
  | 'boxed'
  | 'content'
  | 'multi-column'
  | 'inner-section';

export interface SectionBase {
  id: string;
  structure: SectionStructureType;
  columns?: number;
  responsive?: ResponsiveOverrides;
  innerSections?: InnerSectionSpec[];
  parentSectionId?: string;
}

export interface InnerSectionSpec {
  id: string;
  parentId: string;
  columns?: number;
  structure?: 'inner-section';
}

export interface MultiColumnSpec {
  id: string;
  columns: number;
  ratio: string;
  gap: { unit: 'px' | 'rem' | 'em' | '%'; value: number };
}

export interface BuiltSection extends SectionBase {
  columns: number;
  responsive: ResponsiveOverrides;
  innerSections: InnerSectionSpec[];
}

export function buildSection(input: SectionBase): BuiltSection {
  const columns = input.columns ?? (input.structure === 'multi-column' ? 2 : 1);
  return {
    id: input.id,
    structure: input.structure,
    columns,
    responsive: input.responsive ?? {},
    innerSections: input.innerSections ?? [],
    parentSectionId: input.parentSectionId,
  };
}

export function buildInnerSection(
  parentId: string,
  input: { id: string; columns?: number },
): InnerSectionSpec {
  return {
    id: input.id,
    parentId,
    columns: input.columns ?? 1,
    structure: 'inner-section',
  };
}

export function buildMultiColumnSection(
  id: string,
  input: { columns: number; ratio?: string; gap?: { unit: 'px' | 'rem' | 'em' | '%'; value: number } },
): MultiColumnSpec {
  const defaultRatios: Record<number, string> = {
    1: '100',
    2: '50-50',
    3: '33-34-33',
    4: '25-25-25-25',
    5: '20-20-20-20-20',
    6: '16-17-17-17-16-17',
  };
  return {
    id,
    columns: input.columns,
    ratio: input.ratio ?? defaultRatios[input.columns] ?? '50-50',
    gap: input.gap ?? { unit: 'px', value: 20 },
  };
}

export function isMultiColumnSection(section: BuiltSection): boolean {
  return section.structure === 'multi-column' || section.columns > 1;
}

export function isInnerSection(section: BuiltSection): boolean {
  return section.structure === 'inner-section' && Boolean(section.parentSectionId);
}

export function isResponsiveSection(section: BuiltSection): boolean {
  return Object.keys(section.responsive).length > 0;
}

export function buildResponsiveOverrides(
  section: BuiltSection,
): Record<ResponsiveBreakpoint, number> {
  const out: Partial<Record<ResponsiveBreakpoint, number>> = {};
  for (const bp of Object.keys(section.responsive) as ResponsiveBreakpoint[]) {
    const override = section.responsive[bp];
    if (override && typeof override.columns === 'number') {
      out[bp] = override.columns;
    }
  }
  return out as Record<ResponsiveBreakpoint, number>;
}
