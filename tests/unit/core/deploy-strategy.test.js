import { describe, it, expect } from 'vitest';
import { chooseDeployStrategy, measureTreeBytes, STRATEGY_THRESHOLDS, } from '../../../packages/core/src/deploy-strategy.ts';
describe('chooseDeployStrategy', () => {
    it('small tree → direct', () => {
        expect(chooseDeployStrategy(100_000)).toBe('direct');
    });
    it('exactly at directMax → upload-php', () => {
        expect(chooseDeployStrategy(STRATEGY_THRESHOLDS.directMaxBytes)).toBe('upload-php');
    });
    it('medium tree → upload-php', () => {
        expect(chooseDeployStrategy(800_000)).toBe('upload-php');
    });
    it('large tree → split', () => {
        expect(chooseDeployStrategy(1_500_000)).toBe('split');
    });
    it('forced strategy overrides', () => {
        expect(chooseDeployStrategy(100, 'split')).toBe('split');
        expect(chooseDeployStrategy(2_000_000, 'direct')).toBe('direct');
    });
    it('zero bytes → direct', () => {
        expect(chooseDeployStrategy(0)).toBe('direct');
    });
});
describe('measureTreeBytes', () => {
    it('measures JSON byte length', () => {
        const tree = [{ id: '1', elType: 'container' }];
        const bytes = measureTreeBytes(tree);
        expect(bytes).toBe(Buffer.byteLength(JSON.stringify(tree), 'utf-8'));
    });
    it('empty array has small size', () => {
        expect(measureTreeBytes([])).toBe(2); // "[]"
    });
    it('unicode content measured correctly', () => {
        const tree = [{ text: 'Überschrift mit Sonderzeichen äöü' }];
        const bytes = measureTreeBytes(tree);
        expect(bytes).toBeGreaterThan(JSON.stringify(tree).length);
    });
});
//# sourceMappingURL=deploy-strategy.test.js.map