import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionManager } from '../../../packages/mcp/src/transaction.ts';
import { planChunkedDeploy, getResumeIndex, canResume, deployProgress, isDeployComplete, getFailedChunks, CHUNK_SIZE, } from '../../../packages/mcp/src/chunked-deploy.ts';
describe('TransactionManager', () => {
    let tm;
    beforeEach(() => {
        tm = new TransactionManager();
    });
    it('begins a transaction with unique ID', () => {
        const tx1 = tm.begin('v3', 42);
        const tx2 = tm.begin('v4', 43);
        expect(tx1.id).not.toBe(tx2.id);
        expect(tx1.status).toBe('pending');
        expect(tx1.target).toBe('v3');
        expect(tx1.postId).toBe(42);
    });
    it('retrieves transaction by ID', () => {
        const tx = tm.begin('v3', 1);
        expect(tm.get(tx.id)).toBe(tx);
        expect(tm.get('nonexistent')).toBeUndefined();
    });
    it('tracks status transitions', () => {
        const tx = tm.begin('v3', 1);
        expect(tx.status).toBe('pending');
        tm.markInProgress(tx.id);
        expect(tm.get(tx.id).status).toBe('in-progress');
        tm.commit(tx.id);
        expect(tm.get(tx.id).status).toBe('committed');
    });
    it('adds checkpoints', () => {
        const tx = tm.begin('v3', 1);
        tm.addCheckpoint(tx.id, 20, true);
        tm.addCheckpoint(tx.id, 20, true);
        tm.addCheckpoint(tx.id, 15, false);
        const stored = tm.get(tx.id);
        expect(stored.checkpoints).toHaveLength(3);
        expect(stored.checkpoints[0].index).toBe(0);
        expect(stored.checkpoints[2].verified).toBe(false);
    });
    it('gets last verified checkpoint', () => {
        const tx = tm.begin('v3', 1);
        tm.addCheckpoint(tx.id, 20, true);
        tm.addCheckpoint(tx.id, 20, true);
        tm.addCheckpoint(tx.id, 15, false);
        const last = tm.getLastVerifiedCheckpoint(tx.id);
        expect(last?.index).toBe(1);
    });
    it('handles rollback', () => {
        const tx = tm.begin('v3', 1);
        tm.markInProgress(tx.id);
        tm.rollback(tx.id);
        expect(tm.get(tx.id).status).toBe('rolled-back');
    });
    it('lists all transactions', () => {
        tm.begin('v3', 1);
        tm.begin('v4', 2);
        expect(tm.list()).toHaveLength(2);
    });
    it('throws on checkpoint for unknown transaction', () => {
        expect(() => tm.addCheckpoint('unknown', 20, true)).toThrow('not found');
    });
});
describe('Chunked Deploy', () => {
    it('plans chunks correctly', () => {
        const tree = Array.from({ length: 50 }, (_, i) => ({ id: i }));
        const plan = planChunkedDeploy(tree);
        expect(plan.totalElements).toBe(50);
        expect(plan.chunkCount).toBe(3); // 20 + 20 + 10
        expect(plan.chunks[0]).toHaveLength(20);
        expect(plan.chunks[1]).toHaveLength(20);
        expect(plan.chunks[2]).toHaveLength(10);
    });
    it('handles empty tree', () => {
        const plan = planChunkedDeploy([]);
        expect(plan.totalElements).toBe(0);
        expect(plan.chunkCount).toBe(0);
        expect(plan.chunks).toHaveLength(0);
    });
    it('handles tree smaller than chunk size', () => {
        const tree = Array.from({ length: 5 }, (_, i) => ({ id: i }));
        const plan = planChunkedDeploy(tree);
        expect(plan.chunkCount).toBe(1);
        expect(plan.chunks[0]).toHaveLength(5);
    });
    it('supports custom chunk size', () => {
        const tree = Array.from({ length: 25 }, (_, i) => ({ id: i }));
        const plan = planChunkedDeploy(tree, 10);
        expect(plan.chunkCount).toBe(3);
        expect(plan.chunkSize).toBe(10);
    });
    it('calculates resume index', () => {
        const results = [
            { chunkIndex: 0, elementCount: 20, success: true, verified: true },
            { chunkIndex: 1, elementCount: 20, success: true, verified: true },
            { chunkIndex: 2, elementCount: 10, success: false, verified: false, error: 'timeout' },
        ];
        expect(getResumeIndex(results)).toBe(2);
    });
    it('returns 0 when no verified checkpoints', () => {
        const results = [
            { chunkIndex: 0, elementCount: 20, success: false, verified: false },
        ];
        expect(getResumeIndex(results)).toBe(0);
    });
    it('detects resumable deploys', () => {
        const resumable = [
            { chunkIndex: 0, elementCount: 20, success: true, verified: true },
            { chunkIndex: 1, elementCount: 20, success: false, verified: false },
        ];
        const notResumable = [
            { chunkIndex: 0, elementCount: 20, success: false, verified: false },
        ];
        expect(canResume(resumable)).toBe(true);
        expect(canResume(notResumable)).toBe(false);
    });
    it('calculates progress', () => {
        const results = [
            { chunkIndex: 0, elementCount: 20, success: true, verified: true },
            { chunkIndex: 1, elementCount: 20, success: true, verified: true },
            { chunkIndex: 2, elementCount: 10, success: false, verified: false },
        ];
        expect(deployProgress(results, 3)).toBe(67);
    });
    it('validates deploy completion', () => {
        const complete = [
            { chunkIndex: 0, elementCount: 20, success: true, verified: true },
            { chunkIndex: 1, elementCount: 20, success: true, verified: true },
        ];
        const incomplete = [
            { chunkIndex: 0, elementCount: 20, success: true, verified: true },
            { chunkIndex: 1, elementCount: 20, success: false, verified: false },
        ];
        expect(isDeployComplete(complete, 2)).toBe(true);
        expect(isDeployComplete(incomplete, 2)).toBe(false);
        expect(isDeployComplete(complete, 3)).toBe(false);
    });
    it('finds failed chunks', () => {
        const results = [
            { chunkIndex: 0, elementCount: 20, success: true, verified: true },
            { chunkIndex: 1, elementCount: 20, success: false, verified: false, error: 'timeout' },
            { chunkIndex: 2, elementCount: 10, success: false, verified: false, error: 'network' },
        ];
        const failed = getFailedChunks(results);
        expect(failed).toHaveLength(2);
        expect(failed[0].chunkIndex).toBe(1);
    });
    it('CHUNK_SIZE is 20', () => {
        expect(CHUNK_SIZE).toBe(20);
    });
});
//# sourceMappingURL=deploy.test.js.map