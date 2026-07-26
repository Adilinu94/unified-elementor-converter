/**
 * Phase 10 — Ability-Indirection-Layer.
 *
 * Decouples Builder-Output (V3-PageData, Section[], WidgetSpec) from raw
 * Novamira-MCP-Aufrufe. Maps Builder-Operations to Ability-Names via a
 * declared route-table, so the Builder doesn't import mcp-client directly.
 *
 * Routes are determined by operation-type + payload-shape; each route knows
 * which MCP-Ability-Name to call and how to map the payload into
 * ability-parameters. The indirection also computes a deterministic
 * idempotency-key so retries don't double-write.
 */
import { createHash } from 'node:crypto';

export type BuilderOperationKind =
  | 'create-page'
  | 'update-page'
  | 'add-section'
  | 'add-widget'
  | 'update-widget'
  | 'delete-widget'
  | 'apply-css'
  | 'upload-asset'
  | 'set-global-class';

export interface BuilderOperation {
  readonly kind: BuilderOperationKind;
  readonly payload: Record<string, unknown>;
  readonly context?: {
    readonly pageId?: string;
    readonly sectionId?: string;
    readonly widgetId?: string;
    readonly cssVarName?: string;
    readonly assetUrl?: string;
  };
}

export interface AbilityRoute {
  readonly abilityName: string;
  readonly parameterKeys: readonly string[];
  readonly requiresPageId: boolean;
  readonly idempotent: boolean;
}

const ROUTE_TABLE: Record<BuilderOperationKind, AbilityRoute> = {
  'create-page': {
    abilityName: 'novamira.create_page',
    parameterKeys: ['title', 'slug', 'template', 'status'],
    requiresPageId: false,
    idempotent: false,
  },
  'update-page': {
    abilityName: 'novamira.update_page',
    parameterKeys: ['pageId', 'title', 'status', 'meta'],
    requiresPageId: true,
    idempotent: true,
  },
  'add-section': {
    abilityName: 'novamira.add_section',
    parameterKeys: ['pageId', 'structure', 'settings'],
    requiresPageId: true,
    idempotent: false,
  },
  'add-widget': {
    abilityName: 'novamira.add_widget',
    parameterKeys: ['pageId', 'sectionId', 'widgetType', 'settings'],
    requiresPageId: true,
    idempotent: false,
  },
  'update-widget': {
    abilityName: 'novamira.update_widget',
    parameterKeys: ['pageId', 'sectionId', 'widgetId', 'settings'],
    requiresPageId: true,
    idempotent: true,
  },
  'delete-widget': {
    abilityName: 'novamira.delete_widget',
    parameterKeys: ['pageId', 'sectionId', 'widgetId'],
    requiresPageId: true,
    idempotent: true,
  },
  'apply-css': {
    abilityName: 'novamira.apply_css',
    parameterKeys: ['pageId', 'selector', 'css', 'cssVarName'],
    requiresPageId: true,
    idempotent: true,
  },
  'upload-asset': {
    abilityName: 'novamira.upload_asset',
    parameterKeys: ['pageId', 'assetUrl', 'filename'],
    requiresPageId: false,
    idempotent: true,
  },
  'set-global-class': {
    abilityName: 'novamira.set_global_class',
    parameterKeys: ['className', 'css'],
    requiresPageId: false,
    idempotent: true,
  },
};

export function getRouteForOperation(
  kind: BuilderOperationKind,
): AbilityRoute {
  return ROUTE_TABLE[kind];
}

export function buildAbilityParameters(
  route: AbilityRoute,
  operation: BuilderOperation,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const key of route.parameterKeys) {
    if (operation.context && key in operation.context) {
      const ctxValue = (operation.context as Record<string, unknown>)[key];
      if (ctxValue !== undefined) {
        params[key] = ctxValue;
        continue;
      }
    }
    if (key in operation.payload) {
      params[key] = operation.payload[key];
    }
  }
  return params;
}

export function validateOperation(
  operation: BuilderOperation,
): { valid: boolean; missingKeys: readonly string[] } {
  const route = ROUTE_TABLE[operation.kind];
  if (!route) {
    return { valid: false, missingKeys: ['<unknown-operation-kind>'] };
  }
  const missingKeys: string[] = [];
  if (route.requiresPageId && !operation.context?.pageId) {
    missingKeys.push('pageId');
  }
  for (const key of route.parameterKeys) {
    const inContext = operation.context && key in operation.context;
    const inPayload = key in operation.payload;
    if (!inContext && !inPayload) {
      missingKeys.push(key);
    }
  }
  return { valid: missingKeys.length === 0, missingKeys };
}

export function computeIdempotencyKey(
  operation: BuilderOperation,
): string {
  if (!getRouteForOperation(operation.kind).idempotent) {
    return `${operation.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const stablePayload = {
    kind: operation.kind,
    context: operation.context ?? {},
    payload: operation.payload,
  };
  const serialized = JSON.stringify(stablePayload, Object.keys(stablePayload).sort());
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

export interface AbilityCallDescriptor {
  readonly abilityName: string;
  readonly parameters: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly operation: BuilderOperationKind;
}

export function describeOperation(
  operation: BuilderOperation,
): AbilityCallDescriptor {
  const route = getRouteForOperation(operation.kind);
  const parameters = buildAbilityParameters(route, operation);
  const idempotencyKey = computeIdempotencyKey(operation);
  return {
    abilityName: route.abilityName,
    parameters,
    idempotencyKey,
    operation: operation.kind,
  };
}

export function listSupportedOperations(): readonly BuilderOperationKind[] {
  return Object.keys(ROUTE_TABLE) as BuilderOperationKind[];
}

export function getRouteTableSize(): number {
  return Object.keys(ROUTE_TABLE).length;
}