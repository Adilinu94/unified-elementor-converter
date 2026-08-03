/** Machine-readable fidelity decisions for every non-trivial conversion choice. */

export type FidelityDecisionKind =
  | 'native'
  | 'css-fallback'
  | 'js-fallback'
  | 'static-approximation'
  | 'unsupported';

export type FidelityScope = 'node' | 'section' | 'page' | 'site';
export type FidelitySeverity = 'info' | 'warning' | 'error' | 'critical';
export type FidelityApproval = 'not-required' | 'pending' | 'approved' | 'rejected';

export interface FidelityDecisionRecord {
  sourceId: string;
  code: string;
  scope: FidelityScope;
  decision: FidelityDecisionKind;
  capability: string;
  evidenceIds: string[];
  confidence: number;
  severity: FidelitySeverity;
  lostBehavior?: string[];
  approval: FidelityApproval;
  blocking: boolean;
  qaChecks: string[];
}

export interface FidelityValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateFidelityDecisions(value: unknown): FidelityValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(value)) return { valid: false, errors: ['decisions must be an array'], warnings };

  value.forEach((raw, index) => {
    const path = `decisions[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const field of ['sourceId', 'code', 'capability']) {
      if (typeof raw[field] !== 'string' || raw[field] === '') errors.push(`${path}.${field} is required`);
    }
    if (!isScope(raw.scope)) errors.push(`${path}.scope is invalid`);
    if (!isDecisionKind(raw.decision)) errors.push(`${path}.decision is invalid`);
    if (!isSeverity(raw.severity)) errors.push(`${path}.severity is invalid`);
    if (!isApproval(raw.approval)) errors.push(`${path}.approval is invalid`);
    if (!Array.isArray(raw.evidenceIds) || raw.evidenceIds.some((id) => typeof id !== 'string' || !id)) {
      errors.push(`${path}.evidenceIds must be an array of non-empty strings`);
    }
    if (!Array.isArray(raw.qaChecks) || raw.qaChecks.some((check) => typeof check !== 'string' || !check)) {
      errors.push(`${path}.qaChecks must be an array of non-empty strings`);
    }
    if (raw.lostBehavior !== undefined && (!Array.isArray(raw.lostBehavior) || raw.lostBehavior.some((item) => typeof item !== 'string' || !item))) {
      errors.push(`${path}.lostBehavior must be an array of non-empty strings`);
    }
    if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
      errors.push(`${path}.confidence must be between 0 and 1`);
    }
    if (typeof raw.blocking !== 'boolean') errors.push(`${path}.blocking must be boolean`);
    if (raw.approval === 'rejected') {
      warnings.push(`${path} is rejected and blocks the affected scope`);
    }
    if (raw.blocking === true && raw.approval === 'pending') {
      warnings.push(`${path} blocks automatic continuation pending approval`);
    }
    if (raw.decision === 'unsupported' && raw.severity !== 'critical' && raw.blocking !== true) {
      warnings.push(`${path} is unsupported but not marked critical/blocking`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

/** Whether all decisions allow an automatic build to continue. */
export function canContinueWithFidelityDecisions(decisions: FidelityDecisionRecord[]): boolean {
  return decisions.every((decision) => decision.approval !== 'rejected'
    && (!decision.blocking || decision.approval === 'approved'));
}

function isScope(value: unknown): boolean {
  return ['node', 'section', 'page', 'site'].includes(value as string);
}

function isDecisionKind(value: unknown): boolean {
  return ['native', 'css-fallback', 'js-fallback', 'static-approximation', 'unsupported'].includes(value as string);
}

function isSeverity(value: unknown): boolean {
  return ['info', 'warning', 'error', 'critical'].includes(value as string);
}

function isApproval(value: unknown): boolean {
  return ['not-required', 'pending', 'approved', 'rejected'].includes(value as string);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
