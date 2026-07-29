import { describe, it, expect } from 'vitest';
import { inferStructure, resolveComponents, extractComponentRefs, type FramerComponentRef } from '@elconv/extractors';

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
