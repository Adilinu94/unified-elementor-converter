/**
 * V4 Global Classes Generation (Phase 52).
 * Analyzes a V4 Widget-Tree and finds recurring style patterns →
 * suggests Global Classes for deduplication.
 * KRITISCH: V4-only — uses $$type, e-flexbox, Global Classes. NEVER V3.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/generate-global-classes.ts
 */

import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export type GcType = 'typography' | 'structure' | 'background' | 'other';

export interface StyleProps {
  [key: string]: unknown;
}

export interface GcVariant {
  breakpoint: string;
  props: StyleProps;
}

export interface GcVariableBinding {
  prop: string;
  gv_id?: string;
}

export interface McpCall {
  ability: string;
  params: Record<string, unknown>;
  status?: string;
}

export interface GcClass {
  name: string;
  type: string;
  reason: string;
  element_ids: string[];
  props: StyleProps;
  variants?: GcVariant[];
  variable_bindings?: GcVariableBinding[];
  mcp_calls: McpCall[];
}

export interface UngroupedElement {
  element_id: string;
  reason: string;
}

export interface GcPlan {
  meta: {
    totalElements: number;
    elementsWithStyles: number;
    uniqueTypographyPatterns: number;
    uniqueStructurePatterns: number;
    backgroundElements: number;
    suggestedClasses: number;
    potentialInlineStyleReduction: string;
    minDuplicatesThreshold: number;
    generatedAt: string;
  };
  suggested_classes: GcClass[];
  ungrouped_elements: UngroupedElement[];
  agentInstructions: string[];
}

export interface TreeElement {
  id: string;
  widget: string;
  props: StyleProps;
}

export interface GenerateGcOptions {
  minDuplicates?: number;
  localBgSet?: boolean;
}

// ============================================================================
// Property Categories
// ============================================================================

const TYPOGRAPHY_PROPS = new Set([
  'font-size', 'font-family', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-transform',
  'text-decoration', 'color',
]);

const STRUCTURE_PROPS = new Set([
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'row-gap', 'column-gap',
  'max-width', 'min-width', 'max-height', 'min-height',
  'width', 'height',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink',
  'justify-content', 'align-items', 'align-self',
  'display', 'position',
]);

const BACKGROUND_PROPS = new Set(['background', 'background-color']);

export function propCategory(prop: string): GcType {
  if (TYPOGRAPHY_PROPS.has(prop)) return 'typography';
  if (STRUCTURE_PROPS.has(prop)) return 'structure';
  if (BACKGROUND_PROPS.has(prop)) return 'background';
  return 'other';
}

// ============================================================================
// Hashing
// ============================================================================

export function hashSignature(obj: unknown): string {
  const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  const str = stableStringify(obj);
  return createHash('md5').update(str).digest('hex').slice(0, 12);
}

// ============================================================================
// Semantic Naming
// ============================================================================

function getPxNumber(wrapped: unknown): number {
  if (!wrapped) return NaN;
  const v = typeof wrapped === 'object'
    ? ((wrapped as Record<string, unknown>).value as Record<string, unknown>)?.size ?? (wrapped as Record<string, unknown>).value
    : wrapped;
  const match = String(v).match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : NaN;
}

export function suggestGcName(type: string, props: StyleProps, index: number): string {
  const parts = ['gc'];

  if (type === 'typography') {
    parts.push('text');
    const fontSize = props['font-size'];
    const n = getPxNumber(fontSize);
    if (n >= 48) parts.push('xl');
    else if (n >= 28) parts.push('lg');
    else if (n >= 18) parts.push('md');
    else if (n >= 14) parts.push('sm');
    else parts.push('xs');
  } else if (type === 'structure') {
    parts.push('layout');
    if (props['flex-direction'] === 'row') parts.push('row');
    else if (props['flex-direction'] === 'column') parts.push('col');
    if (props['justify-content']) parts.push('jc');
    if (props['align-items']) parts.push('ai');
  } else if (type === 'background') {
    parts.push('bg');
    const bg = String(props['background-color'] || props['background'] || '');
    if (bg.includes('#')) {
      const hex = bg.match(/#[0-9a-fA-F]{3,6}/)?.[0]?.slice(1) || '';
      parts.push(hex.slice(0, 6) || 'custom');
    }
  } else {
    parts.push('style');
  }

  parts.push(String(index));
  return parts.join('-');
}

// ============================================================================
// Main Generation
// ============================================================================

/**
 * Extract style props from a V4 tree element.
 */
export function extractStyleProps(element: Record<string, unknown>): StyleProps {
  const props: StyleProps = {};
  const styles = element.styles as Record<string, { props?: StyleProps }> | undefined;

  if (styles) {
    for (const styleDef of Object.values(styles)) {
      if (styleDef.props) {
        Object.assign(props, styleDef.props);
      }
    }
  }

  // Also check direct props
  const directProps = element.props as StyleProps | undefined;
  if (directProps) {
    Object.assign(props, directProps);
  }

  return props;
}

/**
 * Group elements by their style signature.
 */
export function groupBySignature(
  elements: TreeElement[],
): Map<string, { props: StyleProps; elements: string[] }> {
  const groups = new Map<string, { props: StyleProps; elements: string[] }>();

  for (const el of elements) {
    if (Object.keys(el.props).length === 0) continue;
    const sig = hashSignature(el.props);
    if (!groups.has(sig)) {
      groups.set(sig, { props: el.props, elements: [] });
    }
    groups.get(sig)!.elements.push(el.id);
  }

  return groups;
}

/**
 * Generate Global Classes plan from V4 tree elements.
 */
export function generateGlobalClasses(
  elements: TreeElement[],
  options: GenerateGcOptions = {},
): GcPlan {
  const minDups = options.minDuplicates ?? 2;
  const localBgSet = options.localBgSet ?? false;

  const groups = groupBySignature(elements);
  const suggestedClasses: GcClass[] = [];
  const ungroupedElements: UngroupedElement[] = [];

  let typographyPatterns = 0;
  let structurePatterns = 0;
  let backgroundElements = 0;
  let classIndex = 1;

  for (const group of groups.values()) {
    const isDuplicate = group.elements.length >= minDups;

    // Categorize props
    const propTypes = new Set(Object.keys(group.props).map(propCategory));
    const primaryType = propTypes.has('typography') ? 'typography'
      : propTypes.has('structure') ? 'structure'
      : propTypes.has('background') ? 'background'
      : 'other';

    if (primaryType === 'typography') typographyPatterns++;
    if (primaryType === 'structure') structurePatterns++;
    if (primaryType === 'background') backgroundElements += group.elements.length;

    // Background GC: always suggest (Bug 3 fix) unless localBgSet
    const shouldSuggest = isDuplicate || (primaryType === 'background' && !localBgSet);

    if (shouldSuggest) {
      const name = suggestGcName(primaryType, group.props, classIndex++);
      suggestedClasses.push({
        name,
        type: primaryType,
        reason: isDuplicate
          ? `${group.elements.length} elements share identical ${primaryType} styles`
          : 'Background color requires Global Class (Bug 3)',
        element_ids: group.elements,
        props: group.props,
        mcp_calls: [{
          ability: 'novamira-adrianv2/create-global-class',
          params: { name, props: group.props },
        }],
      });
    } else {
      for (const elId of group.elements) {
        ungroupedElements.push({
          element_id: elId,
          reason: `Only ${group.elements.length} occurrence(s), below threshold of ${minDups}`,
        });
      }
    }
  }

  const totalInlineProps = elements.reduce((sum, el) => sum + Object.keys(el.props).length, 0);
  const gcProps = suggestedClasses.reduce((sum, gc) => sum + Object.keys(gc.props).length * gc.element_ids.length, 0);
  const reduction = totalInlineProps > 0 ? `${Math.round((gcProps / totalInlineProps) * 100)}%` : '0%';

  return {
    meta: {
      totalElements: elements.length,
      elementsWithStyles: elements.filter((el) => Object.keys(el.props).length > 0).length,
      uniqueTypographyPatterns: typographyPatterns,
      uniqueStructurePatterns: structurePatterns,
      backgroundElements,
      suggestedClasses: suggestedClasses.length,
      potentialInlineStyleReduction: reduction,
      minDuplicatesThreshold: minDups,
      generatedAt: new Date().toISOString(),
    },
    suggested_classes: suggestedClasses,
    ungrouped_elements: ungroupedElements,
    agentInstructions: [
      'Execute MCP calls in order to create Global Classes',
      'After creation, assign GC IDs to elements via set-style-props',
      'Verify no inline styles remain for GC-covered properties',
    ],
  };
}
