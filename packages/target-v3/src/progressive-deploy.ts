/**
 * Progressive Deploy Strategy (Phase 61).
 *
 * Instead of deploying all sections at once (all-or-nothing), deploys
 * section-by-section: deploy → verify → fix → next section.
 * This catches render issues early and prevents cascading failures.
 *
 * @module target-v3/progressive-deploy
 */

import type { V3Element } from './types.js';

// ============================================================================
// Types
// ============================================================================

export type DeployPhase = 'pending' | 'deployed' | 'verified' | 'fixed' | 'failed';

export interface SectionDeployState {
  sectionId: string;
  sectionRole: string;
  phase: DeployPhase;
  attempts: number;
  lastError?: string;
  cssComplement?: string;
  deployedAt?: string;
  verifiedAt?: string;
}

export interface ProgressiveDeployPlan {
  pageId: number;
  liveUrl: string;
  sections: SectionDeployState[];
  currentStep: number;
  totalSteps: number;
  status: 'idle' | 'in-progress' | 'complete' | 'blocked';
}

export interface DeployStepResult {
  sectionId: string;
  action: 'deploy' | 'verify' | 'fix' | 'skip';
  success: boolean;
  detail: string;
  nextAction: string;
}

export interface ProgressiveDeployReport {
  pageId: number;
  liveUrl: string;
  startTime: string;
  endTime: string;
  totalSections: number;
  deployedCount: number;
  fixedCount: number;
  failedCount: number;
  cssComplements: Array<{ sectionId: string; css: string }>;
  sectionResults: SectionDeployState[];
}

// ============================================================================
// Plan builder
// ============================================================================

/**
 * Create a progressive deploy plan from a V3 page's top-level sections.
 */
export function createDeployPlan(
  elements: V3Element[],
  pageId: number,
  liveUrl: string,
): ProgressiveDeployPlan {
  const sections: SectionDeployState[] = elements
    .filter((el) => el.elType === 'section' || el.elType === 'container')
    .map((el, idx) => ({
      sectionId: el.id,
      sectionRole: inferSectionRole(el, idx),
      phase: 'pending' as DeployPhase,
      attempts: 0,
    }));

  return {
    pageId,
    liveUrl,
    sections,
    currentStep: 0,
    totalSteps: sections.length * 2, // deploy + verify per section
    status: 'idle',
  };
}

/**
 * Get the next action to perform in the progressive deploy.
 */
export function getNextAction(plan: ProgressiveDeployPlan): {
  action: 'deploy' | 'verify' | 'fix' | 'complete' | 'blocked';
  section?: SectionDeployState;
  detail: string;
} {
  const pending = plan.sections.find((s) => s.phase === 'pending');
  if (pending) {
    return {
      action: 'deploy',
      section: pending,
      detail: `Deploy section "${pending.sectionRole}" (${pending.sectionId})`,
    };
  }

  const deployed = plan.sections.find((s) => s.phase === 'deployed');
  if (deployed) {
    return {
      action: 'verify',
      section: deployed,
      detail: `Verify render of "${deployed.sectionRole}" (${deployed.sectionId})`,
    };
  }

  const failed = plan.sections.find((s) => s.phase === 'failed' && s.attempts < 3);
  if (failed) {
    return {
      action: 'fix',
      section: failed,
      detail: `Fix section "${failed.sectionRole}" (attempt ${failed.attempts + 1}/3): ${failed.lastError}`,
    };
  }

  const blocked = plan.sections.find((s) => s.phase === 'failed' && s.attempts >= 3);
  if (blocked) {
    return {
      action: 'blocked',
      section: blocked,
      detail: `Section "${blocked.sectionRole}" failed after 3 attempts. Manual intervention needed.`,
    };
  }

  return { action: 'complete', detail: 'All sections deployed and verified.' };
}

/**
 * Update plan state after a deploy step.
 */
export function advancePlan(
  plan: ProgressiveDeployPlan,
  sectionId: string,
  result: 'success' | 'failure',
  detail?: string,
  cssComplement?: string,
): ProgressiveDeployPlan {
  const updated = structuredClone(plan);
  const section = updated.sections.find((s) => s.sectionId === sectionId);
  if (!section) return updated;

  section.attempts++;

  switch (section.phase) {
    case 'pending':
      section.phase = result === 'success' ? 'deployed' : 'failed';
      section.deployedAt = new Date().toISOString();
      if (result === 'failure') section.lastError = detail;
      break;
    case 'deployed':
      section.phase = result === 'success' ? 'verified' : 'failed';
      section.verifiedAt = new Date().toISOString();
      if (result === 'failure') section.lastError = detail;
      break;
    case 'failed':
      if (result === 'success') {
        section.phase = 'fixed';
        section.cssComplement = cssComplement;
      } else {
        section.lastError = detail;
      }
      break;
    default:
      break;
  }

  // Update overall status
  const allDone = updated.sections.every(
    (s) => s.phase === 'verified' || s.phase === 'fixed',
  );
  const anyBlocked = updated.sections.some(
    (s) => s.phase === 'failed' && s.attempts >= 3,
  );

  updated.status = allDone ? 'complete' : anyBlocked ? 'blocked' : 'in-progress';
  updated.currentStep = updated.sections.filter(
    (s) => s.phase !== 'pending',
  ).length;

  return updated;
}

// ============================================================================
// MCP call builders
// ============================================================================

/**
 * Build MCP calls for deploying a single section.
 */
export function buildSectionDeployCalls(
  section: V3Element,
  pageId: number,
): Array<{ ability: string; params: Record<string, unknown> }> {
  return [
    {
      ability: 'novamira-adrianv2/set-page-content',
      params: {
        post_id: pageId,
        content: JSON.stringify([section]),
        mode: 'append',
      },
    },
  ];
}

/**
 * Build MCP call to verify a section rendered correctly.
 */
export function buildSectionVerifyCall(
  liveUrl: string,
  sectionId: string,
): { ability: string; params: Record<string, unknown> } {
  return {
    ability: 'browser/execute-js',
    params: {
      url: liveUrl,
      code: `
        const el = document.querySelector('[data-id="${sectionId}"]');
        if (!el) return { found: false };
        const rect = el.getBoundingClientRect();
        return {
          found: true,
          visible: rect.height > 0 && rect.width > 0,
          height: rect.height,
          width: rect.width,
          childCount: el.children.length,
          hasContent: (el.textContent || '').trim().length > 0,
        };
      `,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function inferSectionRole(el: V3Element, index: number): string {
  const settings = el.settings ?? {};
  const cssClasses = (settings['css_classes'] as string) ?? '';
  const elementId = (settings['_element_id'] as string) ?? '';
  const combined = `${cssClasses} ${elementId}`.toLowerCase();

  if (combined.includes('hero')) return 'hero';
  if (combined.includes('header') || combined.includes('nav')) return 'header';
  if (combined.includes('stat')) return 'stats';
  if (combined.includes('service')) return 'services';
  if (combined.includes('footer')) return 'footer';
  if (combined.includes('contact') || combined.includes('cta')) return 'contact';
  if (combined.includes('team')) return 'team';
  if (combined.includes('about')) return 'about';
  if (combined.includes('process') || combined.includes('step')) return 'process';
  return `section-${index + 1}`;
}
