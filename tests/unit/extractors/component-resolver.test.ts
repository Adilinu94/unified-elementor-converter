import { describe, it, expect } from 'vitest';
import {
  formatComponentResolutionReport,
  inferStructure,
  inferStructureWithSource,
  resolveComponents,
  extractComponentRefs,
  type FramerComponentRef,
} from '@elconv/extractors';

describe('inferStructure', () => {
  it('matches known naming patterns (case-insensitive, with optional separator)', () => {
    expect(inferStructure('ServiceCard')[0]!.type).toBe('image');
    expect(inferStructure('feature-card').map((w) => w.role)).toEqual(['icon', 'title', 'description']);
    expect(inferStructure('STAT COUNTER')[0]!.role).toBe('value');
    expect(inferStructure('Pricing Plan').map((w) => w.role)).toContain('select');
  });

  it('falls back to a generic heading+text structure for an unrecognized name', () => {
    const structure = inferStructure('RandomComponentXYZ');
    expect(structure).toEqual([
      { type: 'heading', role: 'title', settings: {} },
      { type: 'text', role: 'content', settings: {} },
    ]);
  });
});

describe('inferStructureWithSource', () => {
  it('names the pattern that fired, so a report can say why a name was read that way', () => {
    const result = inferStructureWithSource('ServiceCard');
    expect(result.source).toBe('name-pattern');
    expect(result.matchedPattern).toBeDefined();
    // The pattern is real, not a label: it must still match the name it fired on.
    expect(new RegExp(result.matchedPattern!, 'i').test('ServiceCard')).toBe(true);
  });

  it('reports the evidence-free fallback as generic-fallback with no pattern', () => {
    const result = inferStructureWithSource('RandomComponentXYZ');
    expect(result.source).toBe('generic-fallback');
    expect(result.matchedPattern).toBeUndefined();
  });

  it('returns a fresh structure so a caller cannot mutate the shared table', () => {
    // A spread alone would copy the array but share every widget object, so one
    // resolved component's edit would rewrite the pattern table for all later
    // calls. `settings` matters too: ServiceCard's title carries a real
    // typography_font_size object.
    const first = inferStructureWithSource('UnknownA').structure;
    first[0]!.role = 'mutated';
    expect(inferStructureWithSource('UnknownB').structure[0]!.role).toBe('title');

    const card = inferStructureWithSource('ServiceCard').structure;
    card[1]!.settings.typography_font_size = { size: 999, unit: 'px' };
    expect(inferStructureWithSource('ServiceCard').structure[1]!.settings.typography_font_size)
      .toEqual({ size: 22, unit: 'px' });
  });
});

describe('resolveComponents', () => {
  function ref(componentId: string, name: string, instanceId = `i-${componentId}`): FramerComponentRef {
    return { componentId, instanceId, name, props: {} };
  }

  it('deduplicates multiple instances of the same component, keeping totalInstances as the raw count', () => {
    const result = resolveComponents([ref('c1', 'ServiceCard'), ref('c1', 'ServiceCard', 'i2')]);
    expect(result.resolved).toHaveLength(1);
    expect(result.uniqueComponents).toBe(1);
    expect(result.totalInstances).toBe(2);
  });

  it('prefers a component-library entry over name-based inference, marking it complexity:complex', () => {
    const library = new Map([['c1', [{ type: 'image' as const, role: 'x', settings: {} }]]]);
    const result = resolveComponents([ref('c1', 'AnyName')], library);
    expect(result.resolved[0]!.complexity).toBe('complex');
    expect(result.resolved[0]!.inferredStructure).toEqual(library.get('c1'));
  });

  it('classifies complexity by inferred structure length: <=2 leaf, <=4 variant, >4 complex', () => {
    const leaf = resolveComponents([ref('c1', 'FAQ Accordion')]); // 2 widgets
    expect(leaf.resolved[0]!.complexity).toBe('leaf');
    const variant = resolveComponents([ref('c2', 'ServiceCard')]); // 3 widgets
    expect(variant.resolved[0]!.complexity).toBe('variant');
    const complex = resolveComponents([ref('c3', 'Pricing Plan')]); // 4 widgets -> still <=4 -> variant, not complex
    expect(complex.resolved[0]!.complexity).toBe('variant');
  });

  it('unresolved always stays empty — inferStructure has an unconditional fallback, nothing can fail to resolve', () => {
    const result = resolveComponents([ref('c1', 'CompletelyUnknownThing')]);
    expect(result.unresolved).toEqual([]);
    expect(result.resolved[0]!.inferredStructure.length).toBeGreaterThan(0);
  });

  it('distinguishes a library structure from a guessed one', () => {
    // Before structureSource existed these two were indistinguishable
    // downstream, which is why the DoD requirement could not be met.
    const library = new Map([['c1', [{ type: 'image' as const, role: 'x', settings: {} }]]]);
    const result = resolveComponents([ref('c1', 'ServiceCard'), ref('c2', 'ServiceCard')], library);
    const fromLibrary = result.resolved.find((c) => c.componentId === 'c1')!;
    const guessedOne = result.resolved.find((c) => c.componentId === 'c2')!;
    expect(fromLibrary.structureSource).toBe('library');
    expect(guessedOne.structureSource).toBe('name-pattern');
    expect(result.guessed.map((c) => c.componentId)).toEqual(['c2']);
  });

  it('counts instances per component before deduplication', () => {
    // A guess on a component used eleven times is a different finding from a
    // guess on one used once.
    const result = resolveComponents([
      ref('c1', 'ServiceCard', 'i1'),
      ref('c1', 'ServiceCard', 'i2'),
      ref('c1', 'ServiceCard', 'i3'),
      ref('c2', 'OneOff'),
    ]);
    expect(result.resolved.find((c) => c.componentId === 'c1')!.instanceCount).toBe(3);
    expect(result.resolved.find((c) => c.componentId === 'c2')!.instanceCount).toBe(1);
  });

  it('leaves guessed empty when every component came from the library', () => {
    const library = new Map([['c1', [{ type: 'image' as const, role: 'x', settings: {} }]]]);
    expect(resolveComponents([ref('c1', 'A')], library).guessed).toEqual([]);
  });
});

describe('formatComponentResolutionReport', () => {
  function ref(componentId: string, name: string, instanceId = `i-${componentId}`): FramerComponentRef {
    return { componentId, instanceId, name, props: {} };
  }

  it('names every guessed component, its instance count and its basis', () => {
    const result = resolveComponents([ref('c1', 'ServiceCard'), ref('c2', 'MysteryThing')]);
    const lines = formatComponentResolutionReport(result).join('\n');
    expect(lines).toContain('ServiceCard');
    expect(lines).toContain('c1');
    expect(lines).toContain('MysteryThing');
    // The evidence-free case must say so, not merely appear in the list.
    expect(lines).toContain('NO evidence');
  });

  it('orders by instance count, so the component carrying most of the page comes first', () => {
    const lines = formatComponentResolutionReport(resolveComponents([
      ref('c1', 'OneOff'),
      ref('c2', 'Everywhere', 'i1'),
      ref('c2', 'Everywhere', 'i2'),
      ref('c2', 'Everywhere', 'i3'),
    ]));
    expect(lines[1]).toContain('Everywhere');
    expect(lines[2]).toContain('OneOff');
  });

  it('states how many instances the guesses cover, not just how many components', () => {
    const lines = formatComponentResolutionReport(resolveComponents([
      ref('c1', 'Card', 'i1'),
      ref('c1', 'Card', 'i2'),
    ])).join('\n');
    expect(lines).toContain('2 of 2 instance(s)');
  });

  it('returns no lines when nothing was guessed, so a caller can append unconditionally', () => {
    const library = new Map([['c1', [{ type: 'image' as const, role: 'x', settings: {} }]]]);
    expect(formatComponentResolutionReport(resolveComponents([ref('c1', 'A')], library))).toEqual([]);
  });
});

describe('extractComponentRefs', () => {
  it('extracts only nodes that have a componentId prop', () => {
    const refs = extractComponentRefs([
      { id: '1', name: 'A', props: { componentId: 'comp-1' } },
      { id: '2', name: 'B', props: {} },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ componentId: 'comp-1', instanceId: '1', name: 'A' });
  });

  it('returns an empty array when no nodes have a componentId', () => {
    expect(extractComponentRefs([{ id: '1', name: 'A', props: {} }])).toEqual([]);
  });
});
