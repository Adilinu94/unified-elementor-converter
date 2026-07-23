import { describe, it, expect, beforeEach } from 'vitest';
import { createSession, advancePhase, completePhase, finishSession, setMetadata, isResumable, getSessionDuration, createRunArchive, recordRun, getRunsByTarget, getRunsByStatus, getLastRun, getSuccessRate, getAverageDuration, getAverageScore, serializeArchive, deserializeArchive, pruneArchive, resetRunIds, } from '@elconv/core';
describe('Session Manager', () => {
    it('creates session with UUID and active status', () => {
        const session = createSession('v3', 'url', 'https://example.com');
        expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(session.status).toBe('active');
        expect(session.target).toBe('v3');
        expect(session.currentPhase).toBe('init');
        expect(session.phasesCompleted).toEqual([]);
    });
    it('advances phase', () => {
        let session = createSession('v4', 'framer-xml', 'design.xml');
        session = advancePhase(session, 'extract');
        expect(session.currentPhase).toBe('extract');
    });
    it('completes phase and tracks history', () => {
        let session = createSession('v3', 'html-export', 'index.html');
        session = completePhase(session, 'extract');
        session = completePhase(session, 'transform');
        expect(session.phasesCompleted).toEqual(['extract', 'transform']);
    });
    it('finishes session with status', () => {
        let session = createSession('v4', 'url', 'https://test.dev');
        session = finishSession(session, 'completed');
        expect(session.status).toBe('completed');
    });
    it('sets metadata', () => {
        let session = createSession('v3', 'url', 'https://x.com');
        session = setMetadata(session, 'postId', 42);
        session = setMetadata(session, 'wordCount', 1500);
        expect(session.metadata.postId).toBe(42);
        expect(session.metadata.wordCount).toBe(1500);
    });
    it('checks resumability', () => {
        let session = createSession('v3', 'url', 'https://x.com');
        expect(isResumable(session)).toBe(false);
        session = completePhase(session, 'extract');
        expect(isResumable(session)).toBe(true);
        session = finishSession(session, 'failed');
        expect(isResumable(session)).toBe(false);
    });
    it('calculates session duration', () => {
        const session = createSession('v3', 'url', 'https://x.com');
        const duration = getSessionDuration(session);
        expect(duration).toBeGreaterThanOrEqual(0);
    });
});
describe('Run Archive', () => {
    beforeEach(() => resetRunIds());
    function makeRun(overrides = {}) {
        return {
            sessionId: 'sess-1',
            target: 'v3',
            sourceType: 'url',
            sourceRef: 'https://example.com',
            startedAt: '2026-01-01T00:00:00Z',
            completedAt: '2026-01-01T00:05:00Z',
            durationMs: 300000,
            status: 'success',
            phases: [{ name: 'extract', status: 'done', durationMs: 1000 }],
            guardScore: 92,
            artifacts: ['output.json'],
            ...overrides,
        };
    }
    it('creates empty archive', () => {
        const archive = createRunArchive();
        expect(archive.version).toBe(1);
        expect(archive.runs).toEqual([]);
    });
    it('records a run', () => {
        let archive = createRunArchive();
        archive = recordRun(archive, makeRun());
        expect(archive.runs).toHaveLength(1);
        expect(archive.runs[0].id).toMatch(/^run_/);
    });
    it('filters by target', () => {
        let archive = createRunArchive();
        archive = recordRun(archive, makeRun({ target: 'v3' }));
        archive = recordRun(archive, makeRun({ target: 'v4' }));
        archive = recordRun(archive, makeRun({ target: 'v3' }));
        expect(getRunsByTarget(archive, 'v3')).toHaveLength(2);
        expect(getRunsByTarget(archive, 'v4')).toHaveLength(1);
    });
    it('filters by status', () => {
        let archive = createRunArchive();
        archive = recordRun(archive, makeRun({ status: 'success' }));
        archive = recordRun(archive, makeRun({ status: 'failed', error: 'timeout' }));
        expect(getRunsByStatus(archive, 'success')).toHaveLength(1);
        expect(getRunsByStatus(archive, 'failed')).toHaveLength(1);
    });
    it('gets last run', () => {
        let archive = createRunArchive();
        expect(getLastRun(archive)).toBeNull();
        archive = recordRun(archive, makeRun({ sourceRef: 'first' }));
        archive = recordRun(archive, makeRun({ sourceRef: 'second' }));
        expect(getLastRun(archive)?.sourceRef).toBe('second');
    });
    it('calculates success rate', () => {
        let archive = createRunArchive();
        archive = recordRun(archive, makeRun({ status: 'success' }));
        archive = recordRun(archive, makeRun({ status: 'success' }));
        archive = recordRun(archive, makeRun({ status: 'failed' }));
        expect(getSuccessRate(archive)).toBe(67);
    });
    it('calculates average duration', () => {
        let archive = createRunArchive();
        archive = recordRun(archive, makeRun({ durationMs: 1000 }));
        archive = recordRun(archive, makeRun({ durationMs: 3000 }));
        expect(getAverageDuration(archive)).toBe(2000);
    });
    it('calculates average score', () => {
        let archive = createRunArchive();
        archive = recordRun(archive, makeRun({ guardScore: 90 }));
        archive = recordRun(archive, makeRun({ guardScore: 80 }));
        archive = recordRun(archive, makeRun({ guardScore: undefined }));
        expect(getAverageScore(archive)).toBe(85);
    });
    it('serializes and deserializes', () => {
        let archive = createRunArchive();
        archive = recordRun(archive, makeRun());
        const json = serializeArchive(archive);
        const restored = deserializeArchive(json);
        expect(restored).not.toBeNull();
        expect(restored.runs).toHaveLength(1);
        expect(restored.runs[0].target).toBe('v3');
    });
    it('returns null for invalid JSON', () => {
        expect(deserializeArchive('not json')).toBeNull();
        expect(deserializeArchive('{"version":2,"runs":[]}')).toBeNull();
    });
    it('prunes archive to max runs', () => {
        let archive = createRunArchive();
        for (let i = 0; i < 10; i++) {
            archive = recordRun(archive, makeRun({ sourceRef: `run-${i}` }));
        }
        const pruned = pruneArchive(archive, 3);
        expect(pruned.runs).toHaveLength(3);
        expect(pruned.runs[0].sourceRef).toBe('run-7');
    });
});
//# sourceMappingURL=session-archive.test.js.map