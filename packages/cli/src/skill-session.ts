/**
 * Skill Session & Build Resume (Phase 71).
 *
 * Persists build state across MCP disconnects. Each build gets a session.json
 * that tracks progress, enabling `elconv session resume <domain>`.
 *
 * @module cli/skill-session
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface BuildSession {
  version: string;
  domain: string;
  framerProject: string;
  wpTarget: {
    siteUrl: string;
    postId: number;
    pageSlug: string;
  };
  wpcodeSnippets: Array<{ id: number; title: string; type: string }>;
  sections: SectionState[];
  cssRound: number;
  lastAction: string;
  lastUpdated: string;
  createdAt: string;
  status: 'active' | 'paused' | 'complete' | 'failed';
}

export interface SectionState {
  sectionId: string;
  role: string;
  status: 'pending' | 'deployed' | 'verified' | 'fixed' | 'failed';
  attempts: number;
  cssComplement?: string;
}

export interface ResumeSuggestion {
  nextStep: string;
  description: string;
  section?: string;
  command: string;
}

// ============================================================================
// Session persistence
// ============================================================================

const SESSION_DIR = '.elconv/sessions';

function getSessionPath(domain: string): string {
  return join(SESSION_DIR, `${domain.replace(/[^a-z0-9.-]/gi, '_')}.json`);
}

/**
 * Create a new build session.
 */
export function createSession(
  domain: string,
  framerProject: string,
  siteUrl: string,
  postId: number,
  sections: Array<{ sectionId: string; role: string }>,
): BuildSession {
  const session: BuildSession = {
    version: '1.0.0',
    domain,
    framerProject,
    wpTarget: { siteUrl, postId, pageSlug: '' },
    wpcodeSnippets: [],
    sections: sections.map((s) => ({
      sectionId: s.sectionId,
      role: s.role,
      status: 'pending',
      attempts: 0,
    })),
    cssRound: 0,
    lastAction: 'session-created',
    lastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    status: 'active',
  };

  saveSession(session);
  return session;
}

/**
 * Load an existing session by domain.
 */
export function loadSession(domain: string): BuildSession | null {
  const path = getSessionPath(domain);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as BuildSession;
  } catch {
    return null;
  }
}

/**
 * Save session to disk.
 */
export function saveSession(session: BuildSession): void {
  const path = getSessionPath(session.domain);
  const dir = join(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  session.lastUpdated = new Date().toISOString();
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8');
}

/**
 * Update a section's status in the session.
 */
export function updateSectionStatus(
  session: BuildSession,
  sectionId: string,
  status: SectionState['status'],
  cssComplement?: string,
): BuildSession {
  const section = session.sections.find((s) => s.sectionId === sectionId);
  if (section) {
    section.status = status;
    if (status === 'failed') section.attempts++;
    if (cssComplement) section.cssComplement = cssComplement;
  }
  session.lastAction = `section-${sectionId}-${status}`;
  saveSession(session);
  return session;
}

/**
 * Record a WPCode snippet in the session.
 */
export function recordSnippet(
  session: BuildSession,
  snippet: { id: number; title: string; type: string },
): BuildSession {
  session.wpcodeSnippets.push(snippet);
  session.lastAction = `snippet-created-${snippet.id}`;
  saveSession(session);
  return session;
}

/**
 * Increment CSS round counter.
 */
export function incrementCssRound(session: BuildSession): BuildSession {
  session.cssRound++;
  session.lastAction = `css-round-${session.cssRound}`;
  saveSession(session);
  return session;
}

// ============================================================================
// Resume logic
// ============================================================================

/**
 * Suggest the next step for resuming a build.
 */
export function suggestNextStep(session: BuildSession): ResumeSuggestion {
  // Find first pending section
  const pending = session.sections.find((s) => s.status === 'pending');
  if (pending) {
    return {
      nextStep: 'deploy-section',
      description: `Deploy section "${pending.role}" (${pending.sectionId})`,
      section: pending.sectionId,
      command: `elconv deploy --section ${pending.sectionId} --post-id ${session.wpTarget.postId}`,
    };
  }

  // Find first deployed (needs verification)
  const deployed = session.sections.find((s) => s.status === 'deployed');
  if (deployed) {
    return {
      nextStep: 'verify-section',
      description: `Verify render of "${deployed.role}" (${deployed.sectionId})`,
      section: deployed.sectionId,
      command: `elconv qa --section ${deployed.sectionId} --url ${session.wpTarget.siteUrl}`,
    };
  }

  // Find failed sections that can be retried
  const failed = session.sections.find((s) => s.status === 'failed' && s.attempts < 3);
  if (failed) {
    return {
      nextStep: 'fix-section',
      description: `Fix section "${failed.role}" (attempt ${failed.attempts + 1}/3)`,
      section: failed.sectionId,
      command: `elconv qa --fix --section ${failed.sectionId} --url ${session.wpTarget.siteUrl}`,
    };
  }

  // Check if CSS rounds needed
  const allVerified = session.sections.every((s) => s.status === 'verified' || s.status === 'fixed');
  if (allVerified && session.cssRound < 3) {
    return {
      nextStep: 'css-polish',
      description: `Run CSS polish round ${session.cssRound + 1}`,
      command: `elconv qa --css-round --url ${session.wpTarget.siteUrl}`,
    };
  }

  // All done
  return {
    nextStep: 'complete',
    description: 'Build complete! All sections deployed and verified.',
    command: `elconv qa --final --url ${session.wpTarget.siteUrl}`,
  };
}

/**
 * Get a human-readable session summary.
 */
export function sessionSummary(session: BuildSession): string {
  const total = session.sections.length;
  const done = session.sections.filter((s) => s.status === 'verified' || s.status === 'fixed').length;
  const failed = session.sections.filter((s) => s.status === 'failed').length;
  const pending = session.sections.filter((s) => s.status === 'pending').length;

  return [
    `Session: ${session.domain}`,
    `Status: ${session.status}`,
    `Progress: ${done}/${total} sections (${pending} pending, ${failed} failed)`,
    `CSS Rounds: ${session.cssRound}`,
    `WPCode Snippets: ${session.wpcodeSnippets.length}`,
    `Last Action: ${session.lastAction}`,
    `Updated: ${session.lastUpdated}`,
  ].join('\n');
}
