/**
 * Component Resolver (Phase 68).
 *
 * Drills all componentIds in Framer Page-XML, resolves their structure,
 * and infers widget composition from naming conventions.
 *
 * @module extractors/framer/component-resolver
 */

// ============================================================================
// Types
// ============================================================================

export interface FramerComponentRef {
  componentId: string;
  instanceId: string;
  name: string;
  props: Record<string, unknown>;
}

export interface ResolvedComponent {
  componentId: string;
  name: string;
  inferredStructure: InferredWidget[];
  complexity: 'leaf' | 'variant' | 'complex';
  props: Record<string, unknown>;
}

export interface InferredWidget {
  type: 'image' | 'heading' | 'text' | 'button' | 'icon' | 'spacer' | 'container';
  role: string;
  settings: Record<string, unknown>;
}

export interface ComponentResolutionResult {
  resolved: ResolvedComponent[];
  unresolved: string[];
  totalInstances: number;
  uniqueComponents: number;
}

// ============================================================================
// Name-based structure inference
// ============================================================================

const NAME_PATTERNS: Array<{ pattern: RegExp; structure: InferredWidget[] }> = [
  {
    pattern: /service.?card|feature.?card/i,
    structure: [
      { type: 'image', role: 'icon', settings: {} },
      { type: 'heading', role: 'title', settings: { typography_font_size: { size: 22, unit: 'px' } } },
      { type: 'text', role: 'description', settings: {} },
    ],
  },
  {
    pattern: /team.?card|member.?card/i,
    structure: [
      { type: 'image', role: 'photo', settings: { border_radius: { top: '50%', right: '50%', bottom: '50%', left: '50%' } } },
      { type: 'heading', role: 'name', settings: {} },
      { type: 'text', role: 'role', settings: {} },
    ],
  },
  {
    pattern: /stat|counter|metric/i,
    structure: [
      { type: 'heading', role: 'value', settings: { typography_font_size: { size: 48, unit: 'px' } } },
      { type: 'text', role: 'label', settings: {} },
    ],
  },
  {
    pattern: /testimonial|review|quote/i,
    structure: [
      { type: 'text', role: 'quote', settings: {} },
      { type: 'image', role: 'avatar', settings: {} },
      { type: 'heading', role: 'author', settings: {} },
    ],
  },
  {
    pattern: /cta|call.?to.?action/i,
    structure: [
      { type: 'heading', role: 'title', settings: {} },
      { type: 'text', role: 'subtitle', settings: {} },
      { type: 'button', role: 'action', settings: {} },
    ],
  },
  {
    pattern: /step|process/i,
    structure: [
      { type: 'icon', role: 'number', settings: {} },
      { type: 'heading', role: 'title', settings: {} },
      { type: 'text', role: 'description', settings: {} },
    ],
  },
  {
    pattern: /pricing|plan/i,
    structure: [
      { type: 'heading', role: 'plan-name', settings: {} },
      { type: 'heading', role: 'price', settings: { typography_font_size: { size: 40, unit: 'px' } } },
      { type: 'text', role: 'features', settings: {} },
      { type: 'button', role: 'select', settings: {} },
    ],
  },
  {
    pattern: /faq|accordion/i,
    structure: [
      { type: 'heading', role: 'question', settings: {} },
      { type: 'text', role: 'answer', settings: {} },
    ],
  },
];

/**
 * Infer component structure from its name.
 */
export function inferStructure(name: string): InferredWidget[] {
  for (const { pattern, structure } of NAME_PATTERNS) {
    if (pattern.test(name)) return structure;
  }
  // Default: heading + text
  return [
    { type: 'heading', role: 'title', settings: {} },
    { type: 'text', role: 'content', settings: {} },
  ];
}

// ============================================================================
// Resolver
// ============================================================================

/**
 * Resolve all component references in a page.
 */
export function resolveComponents(
  refs: FramerComponentRef[],
  componentLibrary?: Map<string, InferredWidget[]>,
): ComponentResolutionResult {
  const resolved: ResolvedComponent[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    if (seen.has(ref.componentId)) continue;
    seen.add(ref.componentId);

    // Check library first
    const fromLibrary = componentLibrary?.get(ref.componentId);
    if (fromLibrary) {
      resolved.push({
        componentId: ref.componentId,
        name: ref.name,
        inferredStructure: fromLibrary,
        complexity: 'complex',
        props: ref.props,
      });
      continue;
    }

    // Infer from name
    const structure = inferStructure(ref.name);
    const complexity = structure.length <= 2 ? 'leaf' : structure.length <= 4 ? 'variant' : 'complex';

    resolved.push({
      componentId: ref.componentId,
      name: ref.name,
      inferredStructure: structure,
      complexity,
      props: ref.props,
    });
  }

  return {
    resolved,
    unresolved,
    totalInstances: refs.length,
    uniqueComponents: resolved.length,
  };
}

/**
 * Extract component references from Framer XML node props.
 */
export function extractComponentRefs(
  nodes: Array<{ id: string; name: string; props: Record<string, unknown> }>,
): FramerComponentRef[] {
  const refs: FramerComponentRef[] = [];
  for (const node of nodes) {
    const componentId = node.props['componentId'] as string | undefined;
    if (componentId) {
      refs.push({
        componentId,
        instanceId: node.id,
        name: node.name,
        props: node.props,
      });
    }
  }
  return refs;
}
