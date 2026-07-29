import { describe, it, expect } from 'vitest';
import {
  detectCmsCollections,
  buildCmsFetchCall,
  buildAllCmsCalls,
  processCmsResponse,
  buildCmsReport,
  fillTemplateWithCmsData,
  type CmsCollectionRef,
} from '@elconv/extractors';

describe('detectCmsCollections', () => {
  it('detects nodes with either collectionId or cmsCollectionSlug', () => {
    const refs = detectCmsCollections([
      { id: '1', name: 'A', props: { collectionId: 'col-1' } },
      { id: '2', name: 'B', props: { cmsCollectionSlug: 'blog-posts' } },
      { id: '3', name: 'C', props: {} },
    ]);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.collectionId).toBe('col-1');
    expect(refs[1]!.collectionId).toBe('blog-posts');
  });

  it('prefers collectionId over cmsCollectionSlug when both are present', () => {
    const refs = detectCmsCollections([{ id: '1', name: 'A', props: { collectionId: 'col-1', cmsCollectionSlug: 'slug' } }]);
    expect(refs[0]!.collectionId).toBe('col-1');
  });

  it('carries through an optional limit prop', () => {
    const refs = detectCmsCollections([{ id: '1', name: 'A', props: { collectionId: 'c', limit: 5 } }]);
    expect(refs[0]!.limit).toBe(5);
  });
});

describe('buildCmsFetchCall / buildAllCmsCalls', () => {
  it('defaults limit to 20 when not specified', () => {
    const call = buildCmsFetchCall({ collectionId: 'c1', instanceNodeId: 'n1', name: 'X' });
    expect(call.params.limit).toBe(20);
  });

  it('uses the ref-provided limit when set', () => {
    const call = buildCmsFetchCall({ collectionId: 'c1', instanceNodeId: 'n1', name: 'X', limit: 3 });
    expect(call.params.limit).toBe(3);
  });

  it('builds one call per ref, each retaining its original ref', () => {
    const refs: CmsCollectionRef[] = [{ collectionId: 'c1', instanceNodeId: 'n1', name: 'X' }];
    const calls = buildAllCmsCalls(refs);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ref).toBe(refs[0]);
  });
});

describe('processCmsResponse', () => {
  const ref: CmsCollectionRef = { collectionId: 'c1', instanceNodeId: 'n1', name: 'Blog Posts' };

  it('maps raw items, falling back through title -> name -> "Item N" and slug -> "item-N"', () => {
    const result = processCmsResponse(ref, [{ title: 'Hello' }, { name: 'Fallback Name' }, {}]);
    expect(result.items[0]).toMatchObject({ title: 'Hello', slug: 'item-0' });
    expect(result.items[1]).toMatchObject({ title: 'Fallback Name' });
    expect(result.items[2]).toMatchObject({ title: 'Item 3', slug: 'item-2' });
  });

  it('keeps every raw field accessible via item.fields', () => {
    const result = processCmsResponse(ref, [{ title: 'X', customField: 42 }]);
    expect(result.items[0]!.fields.customField).toBe(42);
  });

  it('totalCount matches the item array length', () => {
    const result = processCmsResponse(ref, [{}, {}, {}]);
    expect(result.totalCount).toBe(3);
  });
});

describe('buildCmsReport', () => {
  it('sums totalItems across all collections and passes through unresolvedRefs', () => {
    const results = [
      processCmsResponse({ collectionId: 'c1', instanceNodeId: 'n1', name: 'A' }, [{}, {}]),
      processCmsResponse({ collectionId: 'c2', instanceNodeId: 'n2', name: 'B' }, [{}]),
    ];
    const report = buildCmsReport(results, ['unresolved-ref-1']);
    expect(report.totalCollections).toBe(2);
    expect(report.totalItems).toBe(3);
    expect(report.unresolvedRefs).toEqual(['unresolved-ref-1']);
  });
});

describe('fillTemplateWithCmsData', () => {
  it('replaces {{field}} placeholders from item.fields, plus dedicated title/slug', () => {
    const item = { id: '1', title: 'Post Title', slug: 'post-title', fields: { author: 'Jane' } };
    const result = fillTemplateWithCmsData('{{title}} by {{author}} ({{slug}})', item);
    expect(result).toBe('Post Title by Jane (post-title)');
  });

  it('replaces a missing field value with an empty string rather than leaving the placeholder or "undefined"', () => {
    const item = { id: '1', title: 'T', slug: 's', fields: { author: undefined } };
    const result = fillTemplateWithCmsData('by {{author}}', item);
    expect(result).toBe('by ');
  });

  it('leaves placeholders with no matching field untouched', () => {
    const item = { id: '1', title: 'T', slug: 's', fields: {} };
    expect(fillTemplateWithCmsData('{{nonexistent}}', item)).toBe('{{nonexistent}}');
  });

  it('replaces every occurrence of a repeated placeholder (global, not just the first)', () => {
    const item = { id: '1', title: 'T', slug: 's', fields: { x: 'Y' } };
    expect(fillTemplateWithCmsData('{{x}} and {{x}} again', item)).toBe('Y and Y again');
  });
});
