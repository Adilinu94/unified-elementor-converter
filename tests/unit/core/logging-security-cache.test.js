import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger, loadCredentials, sanitizeUrl, sanitizeHtml, maskSecret, ExtractionCache, } from '@elconv/core';
describe('createLogger', () => {
    it('creates logger with methods', () => {
        const log = createLogger({ level: 'error', prefix: 'test' });
        expect(typeof log.debug).toBe('function');
        expect(typeof log.info).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
    });
    it('respects min level (debug silent when info)', () => {
        const log = createLogger({ level: 'info' });
        // should not throw
        log.debug('hidden');
        log.info('visible');
    });
});
describe('security', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'elconv-sec-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });
    it('loadCredentials reads .env file', () => {
        const envPath = join(dir, '.env');
        writeFileSync(envPath, 'WP_URL=https://example.com\nWP_USER=admin\n', 'utf8');
        const creds = loadCredentials(envPath);
        expect(creds.wpUrl).toBe('https://example.com');
        expect(creds.wpUser).toBe('admin');
    });
    it('sanitizeUrl accepts https', () => {
        expect(sanitizeUrl('https://example.com/path')).toContain('https://example.com');
    });
    it('sanitizeUrl rejects invalid protocol', () => {
        expect(() => sanitizeUrl('javascript:alert(1)')).toThrow();
    });
    it('sanitizeHtml strips script tags', () => {
        const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
        expect(out).toContain('<p>ok</p>');
        expect(out).not.toContain('<script>');
    });
    it('maskSecret masks values', () => {
        expect(maskSecret(undefined)).toBe('(not set)');
        expect(maskSecret('short')).toBe('****');
        expect(maskSecret('abcdefghijklmnop')).toBe('abcd...mnop');
    });
});
describe('ExtractionCache', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'elconv-cache-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });
    it('stores and retrieves values', () => {
        const cache = new ExtractionCache({ cacheDir: dir, ttlMs: 60_000 });
        expect(cache.get('https://a.com')).toBeNull();
        cache.set('https://a.com', { hostname: 'a.com' });
        expect(cache.get('https://a.com')).toEqual({ hostname: 'a.com' });
    });
    it('clear empties memory', () => {
        const cache = new ExtractionCache({ cacheDir: dir });
        cache.set('https://b.com', 1);
        cache.clear();
        // file still exists but memory cleared — get should reload from file
        expect(cache.get('https://b.com')).toBe(1);
    });
});
//# sourceMappingURL=logging-security-cache.test.js.map