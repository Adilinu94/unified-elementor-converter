import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTargets, saveTargets, getTarget, addTarget, removeTarget, resolveAuth, buildAuthHeader, } from '../../../packages/mcp/src/targets.ts';
describe('targets', () => {
    let tempDir;
    let configPath;
    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'elconv-targets-'));
        configPath = join(tempDir, 'targets.json');
    });
    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });
    it('loadTargets returns empty for missing file', () => {
        const store = loadTargets(join(tempDir, 'nonexistent.json'));
        expect(store.targets).toEqual({});
    });
    it('addTarget + getTarget roundtrip', () => {
        const target = {
            mcpEndpoint: 'https://wp.test/mcp',
            authEnv: 'WP_TEST_AUTH',
            defaultTemplate: 'elementor_canvas',
            label: 'Test Site',
        };
        addTarget('test', target, configPath);
        const loaded = getTarget('test', configPath);
        expect(loaded.mcpEndpoint).toBe('https://wp.test/mcp');
        expect(loaded.label).toBe('Test Site');
    });
    it('getTarget throws for missing target', () => {
        expect(() => getTarget('nope', configPath)).toThrow('Target "nope" not found');
    });
    it('removeTarget deletes entry', () => {
        addTarget('temp', {
            mcpEndpoint: 'https://x.test',
            authEnv: 'X',
            defaultTemplate: 'default',
        }, configPath);
        expect(removeTarget('temp', configPath)).toBe(true);
        expect(() => getTarget('temp', configPath)).toThrow();
    });
    it('removeTarget returns false for missing', () => {
        expect(removeTarget('ghost', configPath)).toBe(false);
    });
    it('resolveAuth reads from env', () => {
        process.env.TEST_AUTH_VAR = 'admin:secret123';
        const target = {
            mcpEndpoint: 'https://x.test',
            authEnv: 'TEST_AUTH_VAR',
            defaultTemplate: 'default',
        };
        expect(resolveAuth(target)).toBe('admin:secret123');
        delete process.env.TEST_AUTH_VAR;
    });
    it('resolveAuth throws when env missing', () => {
        const target = {
            mcpEndpoint: 'https://x.test',
            authEnv: 'NONEXISTENT_ENV_VAR_XYZ',
            defaultTemplate: 'default',
        };
        expect(() => resolveAuth(target)).toThrow('not set');
    });
    it('buildAuthHeader produces Basic base64', () => {
        process.env.TEST_AUTH_HEADER = 'user:pass';
        const target = {
            mcpEndpoint: 'https://x.test',
            authEnv: 'TEST_AUTH_HEADER',
            defaultTemplate: 'default',
        };
        const header = buildAuthHeader(target);
        expect(header).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
        delete process.env.TEST_AUTH_HEADER;
    });
    it('saveTargets + loadTargets preserves multiple targets', () => {
        const store = {
            targets: {
                site1: { mcpEndpoint: 'https://a.test', authEnv: 'A', defaultTemplate: 'default' },
                site2: { mcpEndpoint: 'https://b.test', authEnv: 'B', defaultTemplate: 'elementor_canvas' },
            },
        };
        saveTargets(store, configPath);
        const loaded = loadTargets(configPath);
        expect(Object.keys(loaded.targets)).toHaveLength(2);
        expect(loaded.targets['site2'].mcpEndpoint).toBe('https://b.test');
    });
});
//# sourceMappingURL=targets.test.js.map