import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();

vi.mock('node:fs', () => ({
  existsSync: vi.fn((p: string) => files.has(p) || p.endsWith('sessions')),
  readFileSync: vi.fn((p: string) => {
    if (!files.has(p)) throw new Error('ENOENT');
    return files.get(p)!;
  }),
  writeFileSync: vi.fn((p: string, data: string) => {
    files.set(p, data);
  }),
  mkdirSync: vi.fn(),
}));

import {
  createSession,
  loadSession,
  saveSession,
  updateSectionStatus,
  recordSnippet,
  incrementCssRound,
  suggestNextStep,
  sessionSummary,
} from '../../../packages/cli/src/skill-session.js';

beforeEach(() => files.clear());

const SECTIONS = [{ sectionId: 's1', role: 'hero' }, { sectionId: 's2', role: 'stats' }];

describe('createSession / loadSession / saveSession', () => {
  it('creates a session with all sections pending and 0 attempts', () => {
    const session = createSession('example.com', 'proj', 'https://x.com', 1, SECTIONS);
    expect(session.sections).toEqual([
      { sectionId: 's1', role: 'hero', status: 'pending', attempts: 0 },
      { sectionId: 's2', role: 'stats', status: 'pending', attempts: 0 },
    ]);
  });

  it('round-trips through save/load for the same domain', () => {
    createSession('example.com', 'proj', 'https://x.com', 1, SECTIONS);
    const loaded = loadSession('example.com');
    expect(loaded?.domain).toBe('example.com');
  });

  it('returns null for a domain with no saved session', () => {
    expect(loadSession('nonexistent.com')).toBeNull();
  });

  it('sanitizes the domain into a safe filename (no path traversal)', () => {
    const session = createSession('../../etc/passwd', 'proj', 'https://x.com', 1, []);
    saveSession(session);
    // Loading via the exact same (unsanitized) domain string must still work —
    // the sanitization is deterministic and applied identically both ways.
    expect(loadSession('../../etc/passwd')?.domain).toBe('../../etc/passwd');
  });
});

describe('updateSectionStatus', () => {
  it('updates the target section\'s status', () => {
    const session = createSession('d.com', 'proj', 'https://x.com', 1, SECTIONS);
    updateSectionStatus(session, 's1', 'deployed');
    expect(session.sections.find((s) => s.sectionId === 's1')!.status).toBe('deployed');
  });

  it('does nothing (no throw) for an unknown sectionId', () => {
    const session = createSession('d.com', 'proj', 'https://x.com', 1, SECTIONS);
    expect(() => updateSectionStatus(session, 'unknown', 'deployed')).not.toThrow();
  });

  it('records an optional cssComplement', () => {
    const session = createSession('d.com', 'proj', 'https://x.com', 1, SECTIONS);
    updateSectionStatus(session, 's1', 'fixed', '.hero{color:red}');
    expect(session.sections[0]!.cssComplement).toBe('.hero{color:red}');
  });

  it('only counts an "attempt" when the section actually fails, not on every status transition', () => {
    // Regression test for a real bug: attempts++ ran on every call regardless
    // of the target status, so a normal pending->deployed->verified sequence
    // (zero real failures) already used up 2 of the 3 allowed retry attempts
    // — a section could hit suggestNextStep's "attempts < 3" retry cap after
    // just ONE actual failure.
    const session = createSession('d.com', 'proj', 'https://x.com', 1, [{ sectionId: 's1', role: 'hero' }]);
    updateSectionStatus(session, 's1', 'deployed');
    updateSectionStatus(session, 's1', 'verified');
    updateSectionStatus(session, 's1', 'failed'); // the only real failure
    expect(session.sections[0]!.attempts).toBe(1);
  });

  it('increments attempts again on a second real failure', () => {
    const session = createSession('d.com', 'proj', 'https://x.com', 1, [{ sectionId: 's1', role: 'hero' }]);
    updateSectionStatus(session, 's1', 'failed');
    updateSectionStatus(session, 's1', 'pending'); // retry started
    updateSectionStatus(session, 's1', 'failed'); // failed again
    expect(session.sections[0]!.attempts).toBe(2);
  });
});

describe('recordSnippet / incrementCssRound', () => {
  it('appends a snippet to wpcodeSnippets', () => {
    const session = createSession('d.com', 'proj', 'https://x.com', 1, []);
    recordSnippet(session, { id: 1, title: 'X', type: 'css' });
    expect(session.wpcodeSnippets).toEqual([{ id: 1, title: 'X', type: 'css' }]);
  });

  it('increments cssRound by exactly 1 per call', () => {
    const session = createSession('d.com', 'proj', 'https://x.com', 1, []);
    incrementCssRound(session);
    incrementCssRound(session);
    expect(session.cssRound).toBe(2);
  });
});

describe('suggestNextStep', () => {
  function withStatuses(statuses: Array<{ id: string; status: 'pending' | 'deployed' | 'verified' | 'fixed' | 'failed'; attempts?: number }>) {
    const session = createSession('d.com', 'proj', 'https://x.com', 5, statuses.map((s) => ({ sectionId: s.id, role: s.id })));
    for (const s of statuses) {
      const sec = session.sections.find((x) => x.sectionId === s.id)!;
      sec.status = s.status;
      sec.attempts = s.attempts ?? 0;
    }
    return session;
  }

  it('prioritizes the first pending section over everything else', () => {
    const session = withStatuses([{ id: 'a', status: 'failed', attempts: 1 }, { id: 'b', status: 'pending' }]);
    expect(suggestNextStep(session)).toMatchObject({ nextStep: 'deploy-section', section: 'b' });
  });

  it('suggests verifying a deployed section when nothing is pending', () => {
    const session = withStatuses([{ id: 'a', status: 'deployed' }]);
    expect(suggestNextStep(session)).toMatchObject({ nextStep: 'verify-section', section: 'a' });
  });

  it('suggests fixing a failed section with attempts remaining', () => {
    const session = withStatuses([{ id: 'a', status: 'failed', attempts: 1 }]);
    expect(suggestNextStep(session)).toMatchObject({ nextStep: 'fix-section', section: 'a' });
  });

  it('does NOT suggest fixing a failed section that has exhausted its 3 attempts', () => {
    const session = withStatuses([{ id: 'a', status: 'failed', attempts: 3 }]);
    expect(suggestNextStep(session).nextStep).not.toBe('fix-section');
  });

  it('suggests a css-polish round when all sections are verified/fixed and cssRound < 3', () => {
    const session = withStatuses([{ id: 'a', status: 'verified' }, { id: 'b', status: 'fixed' }]);
    expect(suggestNextStep(session).nextStep).toBe('css-polish');
  });

  it('reports complete when all verified and 3 css rounds are done', () => {
    const session = withStatuses([{ id: 'a', status: 'verified' }]);
    session.cssRound = 3;
    expect(suggestNextStep(session).nextStep).toBe('complete');
  });
});

describe('sessionSummary', () => {
  it('formats section counts and CSS rounds into a readable summary', () => {
    const session = createSession('d.com', 'proj', 'https://x.com', 1, SECTIONS);
    updateSectionStatus(session, 's1', 'verified');
    const summary = sessionSummary(session);
    expect(summary).toContain('Progress: 1/2 sections');
    expect(summary).toContain('Session: d.com');
  });
});
