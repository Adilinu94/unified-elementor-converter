/**
 * V3 Setting Validator & Render-Compat Check (Phase 59).
 *
 * Iterates a V3 element tree and checks every setting against the
 * v3-v4-render-compat table. Produces a render-risk report that warns
 * about settings that will silently fail under the V4 engine.
 *
 * Auto-companion: suggests required companion settings (e.g. typography_typography:"custom").
 *
 * @module target-v3/setting-validator
 */

import type { V3Element } from './types.js';
import compatTable from '../references/v3-v4-render-compat.json';

// ============================================================================
// Types
// ============================================================================

export type RenderSeverity = 'critical' | 'high' | 'medium' | 'none';
export type V4Behavior = 'renders' | 'silently-ignored' | 'stripped' | 'partial';

export interface CompatEntry {
  setting: string;
  widget: string;
  requires: Record<string, unknown>;
  v4Behavior: V4Behavior;
  severity: RenderSeverity;
  fallback: string | null;
  notes: string;
}

export interface RenderRiskFinding {
  elementId: string;
  elType: string;
  widgetType?: string;
  setting: string;
  severity: RenderSeverity;
  v4Behavior: V4Behavior;
  message: string;
  fix?: string;
  fallback?: string | null;
}

export interface RenderRiskReport {
  timestamp: string;
  totalElements: number;
  totalSettings: number;
  findings: RenderRiskFinding[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  autoCompanions: AutoCompanion[];
  score: number; // 0-100, higher = safer
}

export interface AutoCompanion {
  elementId: string;
  setting: string;
  companionSetting: string;
  companionValue: unknown;
  reason: string;
}

// ============================================================================
// Compat table access
// ============================================================================

const COMPAT_ENTRIES: CompatEntry[] = (compatTable as { settings: CompatEntry[] }).settings;

const COMPAT_MAP = new Map<string, CompatEntry>();
for (const entry of COMPAT_ENTRIES) {
  COMPAT_MAP.set(entry.setting, entry);
}

/** Get all documented compat entries. */
export function getCompatEntries(): CompatEntry[] {
  return [...COMPAT_ENTRIES];
}

/** Get compat entry for a specific setting. */
export function getCompatEntry(setting: string): CompatEntry | undefined {
  return COMPAT_MAP.get(setting);
}

// ============================================================================
// Validator
// ============================================================================

/**
 * Validate an entire V3 element tree against the render-compat table.
 * Returns a report with all findings and auto-companion suggestions.
 */
export function validateTree(elements: V3Element[]): RenderRiskReport {
  const findings: RenderRiskFinding[] = [];
  const autoCompanions: AutoCompanion[] = [];
  let totalElements = 0;
  let totalSettings = 0;

  function walk(el: V3Element): void {
    totalElements++;
    const settings = el.settings ?? {};
    const settingKeys = Object.keys(settings);
    totalSettings += settingKeys.length;

    for (const key of settingKeys) {
      const entry = COMPAT_MAP.get(key);
      if (!entry) continue;
      if (entry.v4Behavior === 'renders') continue;

      // Check if widget type matches
      const widgetMatch = el.widgetType
        ? entry.widget.includes(el.widgetType)
        : entry.widget.includes(el.elType);

      if (!widgetMatch && !entry.widget.includes(el.elType)) continue;

      // Check if required companions are present
      const missingCompanions = checkCompanions(settings, entry);

      const finding: RenderRiskFinding = {
        elementId: el.id,
        elType: el.elType,
        widgetType: el.widgetType,
        setting: key,
        severity: entry.severity,
        v4Behavior: entry.v4Behavior,
        message: buildMessage(entry, missingCompanions),
        fallback: entry.fallback,
      };

      if (missingCompanions.length > 0) {
        finding.fix = `Add missing companion: ${missingCompanions.map((c) => `${c.key}=${JSON.stringify(c.value)}`).join(', ')}`;
        for (const comp of missingCompanions) {
          autoCompanions.push({
            elementId: el.id,
            setting: key,
            companionSetting: comp.key,
            companionValue: comp.value,
            reason: entry.notes,
          });
        }
      } else if (entry.v4Behavior === 'stripped') {
        finding.fix = entry.fallback ?? undefined;
      }

      findings.push(finding);
    }

    // Recurse children
    if (el.elements) {
      for (const child of el.elements) {
        walk(child);
      }
    }
  }

  for (const el of elements) {
    walk(el);
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;
  const mediumCount = findings.filter((f) => f.severity === 'medium').length;

  // Score: start at 100, subtract per finding
  const score = Math.max(0, 100 - criticalCount * 15 - highCount * 8 - mediumCount * 3);

  return {
    timestamp: new Date().toISOString(),
    totalElements,
    totalSettings,
    findings,
    criticalCount,
    highCount,
    mediumCount,
    autoCompanions,
    score,
  };
}

/**
 * Apply auto-companions to a V3 tree (mutates a copy).
 * Returns the fixed tree + list of applied fixes.
 */
export function applyAutoCompanions(elements: V3Element[]): {
  tree: V3Element[];
  applied: AutoCompanion[];
} {
  const report = validateTree(elements);
  const applied: AutoCompanion[] = [];
  const tree = structuredClone(elements);

  const companionMap = new Map<string, AutoCompanion[]>();
  for (const comp of report.autoCompanions) {
    const list = companionMap.get(comp.elementId) ?? [];
    list.push(comp);
    companionMap.set(comp.elementId, list);
  }

  function walk(el: V3Element): void {
    const companions = companionMap.get(el.id);
    if (companions && el.settings) {
      for (const comp of companions) {
        if (!(comp.companionSetting in el.settings)) {
          el.settings[comp.companionSetting] = comp.companionValue;
          applied.push(comp);
        }
      }
    }
    if (el.elements) {
      for (const child of el.elements) {
        walk(child);
      }
    }
  }

  for (const el of tree) {
    walk(el);
  }

  return { tree, applied };
}

// ============================================================================
// Helpers
// ============================================================================

interface MissingCompanion {
  key: string;
  value: unknown;
}

function checkCompanions(settings: Record<string, unknown>, entry: CompatEntry): MissingCompanion[] {
  const missing: MissingCompanion[] = [];
  for (const [key, value] of Object.entries(entry.requires)) {
    if (!(key in settings)) {
      missing.push({ key, value });
    } else if (typeof value === 'string' && settings[key] !== value) {
      missing.push({ key, value });
    }
  }
  return missing;
}

function buildMessage(entry: CompatEntry, missing: MissingCompanion[]): string {
  if (entry.v4Behavior === 'stripped') {
    return `Setting "${entry.setting}" is STRIPPED by V4 engine. ${entry.notes}`;
  }
  if (missing.length > 0) {
    return `Setting "${entry.setting}" will be SILENTLY IGNORED without: ${missing.map((m) => m.key).join(', ')}. ${entry.notes}`;
  }
  return `Setting "${entry.setting}" has ${entry.v4Behavior} behavior under V4. ${entry.notes}`;
}
