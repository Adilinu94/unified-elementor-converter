/** Generic multi-page/routing and deployment contract. */

export type SitePageKind = 'static' | 'dynamic-template' | '404' | 'redirect';
export type SitePageStatus = 'discovered' | 'extracted' | 'planned' | 'built' | 'verified' | 'blocked';
export type SiteDeploymentMode = 'atomic' | 'partial-with-explicit-scope';
export type SiteDeploymentStatus = 'planned' | 'deploying' | 'verified' | 'rolled-back' | 'blocked';
export type RollbackStatus = 'available' | 'restored' | 'failed';

export interface SiteSharedComponent {
  sourceComponentId: string;
  kind: 'header' | 'footer' | 'template' | 'component';
  targetPostId?: number;
  targetTemplateId?: number;
  version: string;
  status: 'planned' | 'built' | 'verified' | 'blocked';
  snapshotId?: string;
  rollbackStatus?: RollbackStatus;
}

export interface SitePageManifestEntry {
  sourceRoute: string;
  targetSlug: string;
  targetPostId?: number;
  kind: SitePageKind;
  sharedComponentIds: string[];
  requiredAssetIds: string[];
  status: SitePageStatus;
  snapshotId?: string;
  rollbackStatus?: RollbackStatus;
}

export interface SiteDeploymentManifest {
  schemaVersion: '1.0';
  sourceOrigin: string;
  deployment: {
    targetProfileId: string;
    transactionMode: SiteDeploymentMode;
    rollbackGroupId: string;
    status: SiteDeploymentStatus;
  };
  pages: SitePageManifestEntry[];
  sharedComponents: SiteSharedComponent[];
  unresolvedRoutes: string[];
}

export interface SiteManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSiteDeploymentManifest(value: unknown): SiteManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['site manifest must be an object'], warnings };
  if (value.schemaVersion !== '1.0') errors.push('schemaVersion must be 1.0');
  if (typeof value.sourceOrigin !== 'string' || value.sourceOrigin === '') errors.push('sourceOrigin is required');

  const deployment = value.deployment;
  if (!isRecord(deployment)) {
    errors.push('deployment is required');
  } else {
    for (const field of ['targetProfileId', 'rollbackGroupId']) {
      if (typeof deployment[field] !== 'string' || deployment[field] === '') errors.push(`deployment.${field} is required`);
    }
    if (!isDeploymentMode(deployment.transactionMode)) errors.push('deployment.transactionMode is invalid');
    if (!isDeploymentStatus(deployment.status)) errors.push('deployment.status is invalid');
  }

  if (!Array.isArray(value.pages)) errors.push('pages must be an array');
  else {
    const slugs = new Set<string>();
    const componentIds = new Set(
      Array.isArray(value.sharedComponents)
        ? value.sharedComponents.filter(isRecord).map((component) => component.sourceComponentId).filter((id): id is string => typeof id === 'string')
        : [],
    );
    value.pages.forEach((page, index) => {
      const path = `pages[${index}]`;
      if (!isRecord(page)) {
        errors.push(`${path} must be an object`);
        return;
      }
      for (const field of ['sourceRoute', 'targetSlug']) {
        if (typeof page[field] !== 'string' || page[field] === '') errors.push(`${path}.${field} is required`);
      }
      if (!isPageKind(page.kind)) errors.push(`${path}.kind is invalid`);
      if (!isPageStatus(page.status)) errors.push(`${path}.status is invalid`);
      if (page.rollbackStatus !== undefined && !isRollbackStatus(page.rollbackStatus)) errors.push(`${path}.rollbackStatus is invalid`);
      if (typeof page.targetSlug === 'string') {
        const normalizedSlug = normalizeSlug(page.targetSlug);
        if (slugs.has(normalizedSlug)) errors.push(`duplicate targetSlug: ${normalizedSlug}`);
        slugs.add(normalizedSlug);
      }
      if (!Array.isArray(page.sharedComponentIds)) errors.push(`${path}.sharedComponentIds must be an array`);
      else page.sharedComponentIds.forEach((id, componentIndex) => {
        if (typeof id !== 'string' || !componentIds.has(id)) {
          errors.push(`${path}.sharedComponentIds[${componentIndex}] references an unknown component`);
        }
      });
      if (!Array.isArray(page.requiredAssetIds)) errors.push(`${path}.requiredAssetIds must be an array`);
      if (page.status === 'built' || page.status === 'verified') {
        if (!isPositiveFiniteInteger(page.targetPostId)) {
          errors.push(`${path}.targetPostId is required after build`);
        }
        if (typeof page.snapshotId !== 'string' || page.snapshotId === '') {
          errors.push(`${path}.snapshotId is required after build`);
        }
      }
    });
  }

  if (!Array.isArray(value.sharedComponents)) errors.push('sharedComponents must be an array');
  else {
    const componentIds = new Set<string>();
    value.sharedComponents.forEach((component, index) => {
    const path = `sharedComponents[${index}]`;
    if (!isRecord(component)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (typeof component.sourceComponentId !== 'string' || component.sourceComponentId === '') {
      errors.push(`${path}.sourceComponentId is required`);
    } else if (componentIds.has(component.sourceComponentId)) {
      errors.push(`duplicate sourceComponentId: ${component.sourceComponentId}`);
    } else {
      componentIds.add(component.sourceComponentId);
    }
    if (!isSharedComponentKind(component.kind)) errors.push(`${path}.kind is invalid`);
    if (typeof component.version !== 'string' || component.version === '') errors.push(`${path}.version is required`);
    if (!isSharedComponentStatus(component.status)) errors.push(`${path}.status is invalid`);
    if (component.rollbackStatus !== undefined && !isRollbackStatus(component.rollbackStatus)) {
      errors.push(`${path}.rollbackStatus is invalid`);
    }
    if (component.status === 'built' || component.status === 'verified') {
      if ((component.targetPostId !== undefined && !isPositiveFiniteInteger(component.targetPostId))
        || (component.targetTemplateId !== undefined && !isPositiveFiniteInteger(component.targetTemplateId))) {
        errors.push(`${path} target IDs must be positive finite integers`);
      }
      if (typeof component.targetPostId !== 'number' && typeof component.targetTemplateId !== 'number') {
        errors.push(`${path} needs targetPostId or targetTemplateId after build`);
      }
      if (typeof component.snapshotId !== 'string' || component.snapshotId === '') {
        errors.push(`${path}.snapshotId is required after build`);
      }
    }
    });
  }

  if (!Array.isArray(value.unresolvedRoutes)) {
    errors.push('unresolvedRoutes must be an array');
  } else if (deployment && isRecord(deployment) && deployment.transactionMode === 'atomic' && value.unresolvedRoutes.length > 0) {
    warnings.push('atomic deployment has unresolved routes and should remain blocked until scope is explicitly approved');
  }
  return { valid: errors.length === 0, errors, warnings };
}

function normalizeSlug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  return normalized || 'home';
}

function isDeploymentMode(value: unknown): boolean {
  return ['atomic', 'partial-with-explicit-scope'].includes(value as string);
}

function isDeploymentStatus(value: unknown): boolean {
  return ['planned', 'deploying', 'verified', 'rolled-back', 'blocked'].includes(value as string);
}

function isSharedComponentKind(value: unknown): boolean {
  return ['header', 'footer', 'template', 'component'].includes(value as string);
}

function isSharedComponentStatus(value: unknown): boolean {
  return ['planned', 'built', 'verified', 'blocked'].includes(value as string);
}

function isPageKind(value: unknown): boolean {
  return ['static', 'dynamic-template', '404', 'redirect'].includes(value as string);
}

function isPageStatus(value: unknown): boolean {
  return ['discovered', 'extracted', 'planned', 'built', 'verified', 'blocked'].includes(value as string);
}

function isRollbackStatus(value: unknown): boolean {
  return ['available', 'restored', 'failed'].includes(value as string);
}

function isPositiveFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
