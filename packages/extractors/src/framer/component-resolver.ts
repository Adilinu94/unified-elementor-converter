/**
 * Component Resolver (Phase 68).
 *
 * Drills all componentIds in Framer Page-XML, resolves their structure,
 * and infers widget composition from naming conventions.
 *
 * ## Guessed structure must be named as guessed
 *
 * `inferStructure` matches a component NAME against a pattern table and, when
 * nothing matches, returns a generic heading+text pair. Both are guesses, and
 * the second is a guess with no evidence behind it at all — a component called
 * `RandomComponentXYZ` becomes a heading and a paragraph because that is the
 * fallback, not because anything was measured.
 *
 * The Definition of Done requires every guessed component to appear by name in
 * the run report, and it could not: `ResolvedComponent` recorded only the
 * resulting structure, so a library-backed resolution and a blind fallback were
 * indistinguishable downstream. `structureSource` now separates the three cases
 * and `formatComponentResolutionReport` renders them, so a reader sees which
 * components were invented rather than read.
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

/**
 * Where a component's structure came from.
 *
 * The ordering is the confidence ordering, and the distinction is the whole
 * point of the field:
 *
 *   - `library` — a real structure was supplied for this exact `componentId`.
 *     Not a guess.
 *   - `name-pattern` — the NAME matched a known pattern (`ServiceCard` →
 *     icon/title/description). A guess, but an evidenced one, and
 *     `matchedPattern` records which rule fired.
 *   - `generic-fallback` — nothing matched. The heading+text pair is a
 *     placeholder with no evidence, and it MUST be reported as such.
 */
export type ComponentStructureSource = 'library' | 'name-pattern' | 'generic-fallback';

export interface ResolvedComponent {
  componentId: string;
  name: string;
  inferredStructure: InferredWidget[];
  complexity: 'leaf' | 'variant' | 'complex';
  props: Record<string, unknown>;
  /** How the structure was arrived at — see `ComponentStructureSource`. */
  structureSource: ComponentStructureSource;
  /**
   * The pattern that matched, as its source text. Present only for
   * `structureSource: 'name-pattern'`, so a report can state WHY a name was
   * read the way it was.
   */
  matchedPattern?: string;
  /** How many instances of this component the page contains. */
  instanceCount: number;
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
  /**
   * Components whose structure was guessed, by name — the list the Definition
   * of Done asks for. Derived from `resolved`, not tracked separately, so it
   * cannot fall out of step.
   */
  guessed: ResolvedComponent[];
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

/** The generic placeholder used when no name pattern matches. */
const GENERIC_FALLBACK_STRUCTURE: readonly InferredWidget[] = [
  { type: 'heading', role: 'title', settings: {} },
  { type: 'text', role: 'content', settings: {} },
];

/**
 * Copy a structure so a caller cannot mutate the shared table entry.
 *
 * A spread alone is not enough: it copies the array but every `InferredWidget`
 * stays the same object, so writing to one resolved component's widget would
 * change the pattern table for every later call and for every other component
 * matching the same pattern. `settings` needs the same treatment for the same
 * reason — `ServiceCard`'s title carries a real `typography_font_size` object.
 */
function cloneStructure(structure: readonly InferredWidget[]): InferredWidget[] {
  return structure.map((widget) => ({ ...widget, settings: { ...widget.settings } }));
}

/**
 * Infer component structure from its name, saying how it was arrived at.
 *
 * Separated from `inferStructure` because the SOURCE is what the report needs
 * and the structure alone cannot carry it: the generic fallback is a legal
 * `name-pattern` result in shape, and only the resolver knows it fired because
 * nothing matched.
 */
export function inferStructureWithSource(name: string): {
  structure: InferredWidget[];
  source: 'name-pattern' | 'generic-fallback';
  matchedPattern?: string;
} {
  for (const { pattern, structure } of NAME_PATTERNS) {
    if (pattern.test(name)) {
      return { structure: cloneStructure(structure), source: 'name-pattern', matchedPattern: pattern.source };
    }
  }
  return { structure: cloneStructure(GENERIC_FALLBACK_STRUCTURE), source: 'generic-fallback' };
}

/**
 * Infer component structure from its name.
 *
 * Kept as the structure-only form for callers that do not report. Prefer
 * `inferStructureWithSource` when the answer will reach a user.
 */
export function inferStructure(name: string): InferredWidget[] {
  return inferStructureWithSource(name).structure;
}

// ============================================================================
// Resolver
// ============================================================================

/**
 * Resolve all component references in a page.
 *
 * Instances are counted before deduplication, so a component used eleven times
 * reports `instanceCount: 11` — a guessed structure on a component that appears
 * once and one that carries a third of the page are very different findings.
 */
export function resolveComponents(
  refs: FramerComponentRef[],
  componentLibrary?: Map<string, InferredWidget[]>,
): ComponentResolutionResult {
  const resolved: ResolvedComponent[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  const instanceCounts = new Map<string, number>();
  for (const ref of refs) {
    instanceCounts.set(ref.componentId, (instanceCounts.get(ref.componentId) ?? 0) + 1);
  }

  for (const ref of refs) {
    if (seen.has(ref.componentId)) continue;
    seen.add(ref.componentId);
    const instanceCount = instanceCounts.get(ref.componentId) ?? 1;

    // Check library first
    const fromLibrary = componentLibrary?.get(ref.componentId);
    if (fromLibrary) {
      resolved.push({
        componentId: ref.componentId,
        name: ref.name,
        inferredStructure: fromLibrary,
        complexity: 'complex',
        props: ref.props,
        structureSource: 'library',
        instanceCount,
      });
      continue;
    }

    // Infer from name
    const { structure, source, matchedPattern } = inferStructureWithSource(ref.name);
    const complexity = structure.length <= 2 ? 'leaf' : structure.length <= 4 ? 'variant' : 'complex';

    resolved.push({
      componentId: ref.componentId,
      name: ref.name,
      inferredStructure: structure,
      complexity,
      props: ref.props,
      structureSource: source,
      ...(matchedPattern !== undefined ? { matchedPattern } : {}),
      instanceCount,
    });
  }

  return {
    resolved,
    unresolved,
    totalInstances: refs.length,
    uniqueComponents: resolved.length,
    guessed: resolved.filter((component) => component.structureSource !== 'library'),
  };
}

/**
 * Render the resolution as report lines that name every guessed component.
 *
 * Returns an empty array when nothing was guessed, so a caller can append the
 * lines unconditionally without emitting an empty section.
 *
 * Ordered by instance count: the components carrying the most of the page come
 * first, because that is the order in which a reader should care about them.
 */
export function formatComponentResolutionReport(result: ComponentResolutionResult): string[] {
  if (result.guessed.length === 0) return [];

  const byImpact = [...result.guessed].sort((a, b) => b.instanceCount - a.instanceCount);
  const guessedInstances = byImpact.reduce((sum, component) => sum + component.instanceCount, 0);

  const lines = [
    `${result.guessed.length} of ${result.uniqueComponents} component(s) had no library entry, so their `
      + `structure was GUESSED (${guessedInstances} of ${result.totalInstances} instance(s) affected):`,
  ];
  for (const component of byImpact) {
    const basis = component.structureSource === 'name-pattern'
      ? `name matched /${component.matchedPattern}/`
      : 'NO evidence — generic heading+text placeholder';
    const widgets = component.inferredStructure.map((widget) => widget.role).join(', ');
    lines.push(
      `  - "${component.name}" (${component.componentId}, ${component.instanceCount}x): ${basis} → ${widgets}`,
    );
  }
  return lines;
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
