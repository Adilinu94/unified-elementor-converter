/**
 * CMS Resolver (Phase 68).
 *
 * Detects CMS-Collection instances in Framer pages and resolves them
 * via framer_getCMSItems. Produces structured data for template filling.
 *
 * @module extractors/framer/cms-resolver
 */

// ============================================================================
// Types
// ============================================================================

export interface CmsCollectionRef {
  collectionId: string;
  instanceNodeId: string;
  name: string;
  limit?: number;
}

export interface CmsItem {
  id: string;
  title: string;
  slug: string;
  fields: Record<string, unknown>;
}

export interface CmsResolutionResult {
  collectionId: string;
  collectionName: string;
  items: CmsItem[];
  totalCount: number;
  resolvedAt: string;
}

export interface CmsResolverReport {
  collections: CmsResolutionResult[];
  totalCollections: number;
  totalItems: number;
  unresolvedRefs: string[];
}

// ============================================================================
// Detection
// ============================================================================

/**
 * Detect CMS collection references in Framer page nodes.
 */
export function detectCmsCollections(
  nodes: Array<{ id: string; name: string; props: Record<string, unknown> }>,
): CmsCollectionRef[] {
  const refs: CmsCollectionRef[] = [];

  for (const node of nodes) {
    const collectionId = node.props['collectionId'] as string | undefined;
    const cmsSlug = node.props['cmsCollectionSlug'] as string | undefined;

    if (collectionId || cmsSlug) {
      refs.push({
        collectionId: collectionId ?? cmsSlug ?? '',
        instanceNodeId: node.id,
        name: node.name,
        limit: node.props['limit'] as number | undefined,
      });
    }
  }

  return refs;
}

// ============================================================================
// MCP call builder
// ============================================================================

/**
 * Build MCP call to fetch CMS items from Framer.
 */
export function buildCmsFetchCall(ref: CmsCollectionRef): {
  ability: string;
  params: Record<string, unknown>;
} {
  return {
    ability: 'framer/getCMSItems',
    params: {
      collectionId: ref.collectionId,
      limit: ref.limit ?? 20,
    },
  };
}

/**
 * Build all MCP calls needed to resolve CMS collections.
 */
export function buildAllCmsCalls(refs: CmsCollectionRef[]): Array<{
  ability: string;
  params: Record<string, unknown>;
  ref: CmsCollectionRef;
}> {
  return refs.map((ref) => ({
    ...buildCmsFetchCall(ref),
    ref,
  }));
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Process raw CMS response into structured resolution result.
 */
export function processCmsResponse(
  ref: CmsCollectionRef,
  rawItems: Array<Record<string, unknown>>,
): CmsResolutionResult {
  const items: CmsItem[] = rawItems.map((raw, idx) => ({
    id: (raw['id'] as string) ?? `item_${idx}`,
    title: (raw['title'] as string) ?? (raw['name'] as string) ?? `Item ${idx + 1}`,
    slug: (raw['slug'] as string) ?? `item-${idx}`,
    fields: raw,
  }));

  return {
    collectionId: ref.collectionId,
    collectionName: ref.name,
    items,
    totalCount: items.length,
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Build a full CMS resolver report from multiple collection results.
 */
export function buildCmsReport(
  results: CmsResolutionResult[],
  unresolvedRefs: string[],
): CmsResolverReport {
  return {
    collections: results,
    totalCollections: results.length,
    totalItems: results.reduce((sum, r) => sum + r.totalCount, 0),
    unresolvedRefs,
  };
}

// ============================================================================
// Template filling
// ============================================================================

/**
 * Fill a component template with CMS item data.
 * Replaces {{field_name}} placeholders with actual values.
 */
export function fillTemplateWithCmsData(
  template: string,
  item: CmsItem,
): string {
  let result = template;
  for (const [key, value] of Object.entries(item.fields)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), String(value ?? ''));
  }
  // Also replace title and slug
  result = result.replace(/\{\{title\}\}/g, item.title);
  result = result.replace(/\{\{slug\}\}/g, item.slug);
  return result;
}
