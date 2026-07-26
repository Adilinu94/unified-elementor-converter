import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseRobotsTxt,
  pathMatches,
  isAllowed,
  fetchRobotsTxt,
  robotsAllowed,
  _resetRobotsCache,
} from '@elconv/extractors';

describe('robots-check', () => {
  beforeEach(() => {
    _resetRobotsCache();
  });

  describe('parseRobotsTxt', () => {
    it('parses a basic robots.txt with one UA group', () => {
      const body = [
        'User-Agent: *',
        'Disallow: /admin/',
        'Allow: /',
        '',
        'Sitemap: https://example.com/sitemap.xml',
      ].join('\n');
      const parsed = parseRobotsTxt(body);
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.rules[0].userAgents).toEqual(['*']);
      expect(parsed.rules[0].disallow).toEqual(['/admin/']);
      expect(parsed.rules[0].allow).toEqual(['/']);
      expect(parsed.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    });

    it('parses multiple UA groups', () => {
      const body = [
        'User-Agent: Googlebot',
        'Disallow: /private/',
        '',
        'User-Agent: *',
        'Disallow: /admin/',
      ].join('\n');
      const parsed = parseRobotsTxt(body);
      expect(parsed.rules).toHaveLength(2);
      expect(parsed.rules[0].userAgents).toEqual(['googlebot']);
      expect(parsed.rules[1].userAgents).toEqual(['*']);
    });

    it('strips comments and blank lines', () => {
      const body = '# top comment\n\nUser-Agent: * # inline comment\nDisallow: /x/';
      const parsed = parseRobotsTxt(body);
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.rules[0].disallow).toEqual(['/x/']);
    });
  });

  describe('pathMatches', () => {
    it('matches literal paths', () => {
      expect(pathMatches('/admin/', '/admin/')).toBe(true);
      expect(pathMatches('/admin/foo', '/admin/')).toBe(true);
      expect(pathMatches('/public', '/admin/')).toBe(false);
    });
    it('supports * wildcard', () => {
      expect(pathMatches('/admin/users/123', '/admin/*')).toBe(true);
      expect(pathMatches('/public/users/123', '/admin/*')).toBe(false);
    });
    it('supports $ end-anchor', () => {
      expect(pathMatches('/page.pdf', '/*.pdf$')).toBe(true);
      expect(pathMatches('/page.pdf?x=1', '/*.pdf$')).toBe(false);
    });
  });

  describe('isAllowed', () => {
    it('returns true when no rule matches', () => {
      const parsed = parseRobotsTxt('User-Agent: *\nDisallow: /admin/');
      expect(isAllowed(parsed, 'my-bot', '/public')).toBe(true);
    });

    it('returns false when path matches a Disallow rule', () => {
      const parsed = parseRobotsTxt('User-Agent: *\nDisallow: /admin/');
      expect(isAllowed(parsed, 'my-bot', '/admin/users')).toBe(false);
    });

    it('prefers longer Allow match over Disallow', () => {
      const body = 'User-Agent: *\nDisallow: /admin/\nAllow: /admin/public';
      const parsed = parseRobotsTxt(body);
      expect(isAllowed(parsed, 'my-bot', '/admin/public')).toBe(true);
      expect(isAllowed(parsed, 'my-bot', '/admin/private')).toBe(false);
    });

    it('empty Disallow = allow everything for that group', () => {
      const parsed = parseRobotsTxt('User-Agent: *\nDisallow:');
      expect(isAllowed(parsed, 'my-bot', '/anything')).toBe(true);
    });
  });

  describe('robotsAllowed with fetcher override', () => {
    it('returns true when robots.txt returns 404 (no restrictions)', async () => {
      const result = await fetchRobotsTxt('https://no-robots.example.com', null, {
        fetcher: async () => null, // simulates 404
      });
      expect(result).toBeNull();
      expect(await robotsAllowed('https://no-robots.example.com/anything', null, {
        fetcher: async () => null,
      })).toBe(true);
    });

    it('returns false when robots.txt disallows path', async () => {
      const fetcher = async () =>
        'User-Agent: *\nDisallow: /private/\n';
      const allowed = await robotsAllowed('https://example.com/private/secret', null, { fetcher });
      expect(allowed).toBe(false);
    });

    it('caches parsed robots.txt per origin (5 min TTL)', async () => {
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return 'User-Agent: *\nDisallow: /admin/\n';
      };
      await robotsAllowed('https://cached.example.com/a', null, { fetcher });
      await robotsAllowed('https://cached.example.com/b', null, { fetcher });
      await robotsAllowed('https://cached.example.com/c', null, { fetcher });
      expect(calls).toBe(1);
    });

    it('returns false for malformed URL', async () => {
      const result = await robotsAllowed('not a url', null, {
        fetcher: async () => 'User-Agent: *\nDisallow: /',
      });
      expect(result).toBe(false);
    });
  });
});