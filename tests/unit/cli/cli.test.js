import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { parseArgs } from '../../../packages/cli/src/args.ts';
import { main } from '../../../packages/cli/src/index.ts';
const FIXTURES = resolve(import.meta.dirname, '../extractors/fixtures');
describe('parseArgs', () => {
    it('parses command and flags', () => {
        const result = parseArgs(['node', 'elconv', 'convert', '--target', 'v3', '--html', 'test.html']);
        expect(result.command).toBe('convert');
        expect(result.flags['target']).toBe('v3');
        expect(result.flags['html']).toBe('test.html');
    });
    it('parses --flag=value syntax', () => {
        const result = parseArgs(['node', 'elconv', 'convert', '--target=v4']);
        expect(result.flags['target']).toBe('v4');
    });
    it('parses boolean flags', () => {
        const result = parseArgs(['node', 'elconv', 'deploy', '--dry-run', '--force']);
        expect(result.flags['dry-run']).toBe(true);
        expect(result.flags['force']).toBe(true);
    });
    it('parses subcommands', () => {
        const result = parseArgs(['node', 'elconv', 'target', 'list']);
        expect(result.command).toBe('target');
        expect(result.subcommand).toBe('list');
    });
    it('handles empty args', () => {
        const result = parseArgs(['node', 'elconv']);
        expect(result.command).toBe('');
    });
});
describe('CLI main router', () => {
    let stdoutSpy;
    let stderrSpy;
    beforeEach(() => {
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(() => {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
    });
    it('shows help with no command', async () => {
        const code = await main(['node', 'elconv']);
        expect(code).toBe(0);
        expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('elconv'));
    });
    it('shows version', async () => {
        const code = await main(['node', 'elconv', 'version']);
        expect(code).toBe(0);
        expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('0.1.0'));
    });
    it('returns 2 for unknown command', async () => {
        const code = await main(['node', 'elconv', 'foobar']);
        expect(code).toBe(2);
    });
    it('convert --target v3 --html produces V3 tree', async () => {
        const code = await main(['node', 'elconv', 'convert', '--target', 'v3', '--html', resolve(FIXTURES, 'sample.html')]);
        expect(code).toBe(0);
        const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
        const tree = JSON.parse(output);
        expect(Array.isArray(tree)).toBe(true);
        expect(tree.length).toBeGreaterThan(0);
        // V3 tree should have elType
        expect(tree[0]).toHaveProperty('elType');
    });
    it('convert --target v4 --xml produces V4 tree', async () => {
        const code = await main(['node', 'elconv', 'convert', '--target', 'v4', '--xml', resolve(FIXTURES, 'sample-framer.xml')]);
        expect(code).toBe(0);
        const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
        const tree = JSON.parse(output);
        expect(Array.isArray(tree)).toBe(true);
        expect(tree.length).toBeGreaterThan(0);
    });
    it('convert requires --target', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
        await expect(main(['node', 'elconv', 'convert', '--html', 'test.html'])).rejects.toThrow('exit');
        exitSpy.mockRestore();
    });
    it('convert rejects invalid target', async () => {
        const code = await main(['node', 'elconv', 'convert', '--target', 'v5', '--html', 'test.html']);
        expect(code).toBe(2);
    });
    it('doctor runs without MCP', async () => {
        const code = await main(['node', 'elconv', 'doctor', '--target', 'v3']);
        expect(code).toBe(0);
        const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
        expect(output).toContain('doctor');
    });
    it('deploy --dry-run works without MCP', async () => {
        // First create a tree file
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const tmpDir = resolve(import.meta.dirname, '.tmp');
        mkdirSync(tmpDir, { recursive: true });
        const treePath = resolve(tmpDir, 'test-tree.json');
        // Generate a V3 tree first
        await main(['node', 'elconv', 'convert', '--target', 'v3', '--html', resolve(FIXTURES, 'sample.html'), '--out', treePath]);
        stdoutSpy.mockClear();
        const code = await main(['node', 'elconv', 'deploy', '--target', 'v3', '--tree', treePath, '--post-id', '42', '--dry-run']);
        expect(code).toBe(0);
        const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
        expect(output).toContain('DRY RUN');
        expect(output).toContain('direct');
    });
    it('qa requires --url', async () => {
        const code = await main(['node', 'elconv', 'qa']);
        expect(code).toBe(2);
    });
});
//# sourceMappingURL=cli.test.js.map