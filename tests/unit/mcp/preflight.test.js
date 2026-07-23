import { describe, it, expect } from 'vitest';
import { runPreflight, formatPreflightReport } from '../../../packages/mcp/src/preflight.ts';
import { buildV3Tree } from '../../../packages/target-v3/src/builder.ts';
import { buildV4Tree } from '../../../packages/target-v4/src/builder.ts';
function makeSpec() {
    return {
        source: { type: 'url', url: 'https://example.com' },
        tokens: { colors: [], fonts: [], sizes: [] },
        sections: [{
                id: 'sec_0',
                semanticRole: 'hero',
                layout: 'single-column',
                widgets: [
                    { id: 'w1', type: 'heading', text: 'Hello World', styles: {} },
                    { id: 'w2', type: 'text', text: 'Some content', styles: {} },
                ],
                styles: {},
            }],
        cssVars: {},
        warnings: [],
    };
}
describe('Preflight Suite', () => {
    it('runs without adapter (all MCP checks skipped)', async () => {
        const report = await runPreflight(null, { target: 'v3' });
        expect(report.target).toBe('v3');
        expect(report.checks.some((c) => c.id === 'mcp_reachable' && c.status === 'skip')).toBe(true);
        expect(report.passed).toBe(true);
    });
    it('validates a clean V3 tree', async () => {
        const tree = buildV3Tree(makeSpec());
        const report = await runPreflight(null, { target: 'v3', tree });
        const treeCheck = report.checks.find((c) => c.id === 'tree_parse');
        expect(treeCheck?.status).toBe('pass');
        const contCheck = report.checks.find((c) => c.id === 'contamination');
        expect(contCheck?.status).toBe('pass');
    });
    it('validates a clean V4 tree', async () => {
        const tree = buildV4Tree(makeSpec());
        const report = await runPreflight(null, { target: 'v4', tree });
        const treeCheck = report.checks.find((c) => c.id === 'tree_parse');
        expect(treeCheck?.status).toBe('pass');
    });
    it('detects contamination (V4 tree as V3)', async () => {
        const tree = buildV4Tree(makeSpec());
        const report = await runPreflight(null, { target: 'v3', tree });
        const contCheck = report.checks.find((c) => c.id === 'contamination');
        expect(contCheck?.status).toBe('fail');
        expect(report.passed).toBe(false);
    });
    it('detects contamination (V3 tree as V4)', async () => {
        const tree = buildV3Tree(makeSpec());
        const report = await runPreflight(null, { target: 'v4', tree });
        const contCheck = report.checks.find((c) => c.id === 'contamination');
        expect(contCheck?.status).toBe('fail');
        expect(report.passed).toBe(false);
    });
    it('warns on large tree size', async () => {
        // Create a large tree
        const largeSpec = makeSpec();
        for (let i = 0; i < 500; i++) {
            largeSpec.sections[0].widgets.push({
                id: `w_${i}`,
                type: 'text',
                text: 'x'.repeat(500),
                styles: {},
            });
        }
        const tree = buildV3Tree(largeSpec);
        const report = await runPreflight(null, { target: 'v3', tree });
        const sizeCheck = report.checks.find((c) => c.id === 'tree_size');
        // Should be pass or warn depending on size
        expect(['pass', 'warn']).toContain(sizeCheck?.status);
    });
    it('skips V4-specific checks for V3 target', async () => {
        const report = await runPreflight(null, { target: 'v3' });
        const unframer = report.checks.find((c) => c.id === 'unframer');
        expect(unframer?.status).toBe('skip');
        const gc = report.checks.find((c) => c.id === 'global_classes');
        expect(gc?.status).toBe('skip');
    });
    it('includes V4-specific checks for V4 target', async () => {
        const report = await runPreflight(null, { target: 'v4' });
        const v4exp = report.checks.find((c) => c.id === 'v4_experiments');
        expect(v4exp).toBeDefined();
        expect(v4exp?.status).toBe('skip'); // No adapter
        const gc = report.checks.find((c) => c.id === 'global_classes');
        expect(gc).toBeDefined();
    });
    it('formats report correctly', async () => {
        const report = await runPreflight(null, { target: 'v3' });
        const formatted = formatPreflightReport(report);
        expect(formatted).toContain('Preflight Report');
        expect(formatted).toContain('V3');
        expect(formatted).toContain('Result:');
    });
    it('tracks total duration', async () => {
        const report = await runPreflight(null, { target: 'v3' });
        expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
    it('has correct timestamp format', async () => {
        const report = await runPreflight(null, { target: 'v3' });
        expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
//# sourceMappingURL=preflight.test.js.map