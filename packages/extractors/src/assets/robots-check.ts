/**
 * robots.txt checker (V2 Pre-Flight).
 *
 * Parses robots.txt and decides whether a given URL is allowed for our
 * generic user-agent (configurable). Honors Sitemap: directives for
 * optional future use. Caches results per host so multiple URL checks
 * against the same origin don't re-fetch.
 *
 * The check is conservative:
 *   - If robots.txt cannot be fetched (404, network error), we allow the URL
 *     (common convention: no robots.txt = no restrictions).
 *   - If robots.txt explicitly disallows our UA, we deny.
 *   - If robots.txt disallows a generic wildcard but not us, we allow.
 *   - Allow rules take precedence over Disallow for matching path lengths
 *     (this matches Google's interpretation, not the strict spec).
 *
 * Not intended to bypass robots.txt — we want to be a good citizen.
 */

import type { Page } from 'playwright';

export interface RobotsCheckOptions {
  /** User-Agent string we identify as (default: a contact-friendly name). */
  userAgent?: string;
  /** Fetch timeout in ms (default 5000). */
  timeoutMs?: number;
  /** Override the page request (for testing). */
  fetcher?: (url: string) => Promise<string | null>;
}

const DEFAULT_UA = 'site-clone-to-v3 (+https://github.com/Adilinu94/site-clone-to-v3)';

/**
 * Minimal robots.txt directive groups.
 * Rules is an ordered list as they appear; we resolve precedence ourselves.
 */
export interface ParsedRobots {
  raw: string;
  rules: Array<{
    userAgents: string[];
    allow: string[];
    disallow: string[];
  }>;
  sitemaps: string[];
}

interface CacheEntry {
  expiresAt: number;
  parsed: ParsedRobots | null;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Parse a robots.txt body into groups. Public for unit tests. */
export function parseRobotsTxt(body: string): ParsedRobots {
  const rules: ParsedRobots['rules'] = [];
  const sitemaps: string[] = [];
  let current: { userAgents: string[]; allow: string[]; disallow: string[] } | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    // Strip comments and inline comments
    const hashIdx = rawLine.indexOf('#');
    const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
    if (!line) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      // New UA group starts — but only flush if it's a *different* UA after
      // we already saw one (handles "User-Agent: *\nAllow: /\nUser-Agent: bot\n...")
      if (current && current.userAgents.length > 0) {
        rules.push(current);
      }
      current = { userAgents: [value.toLowerCase()], allow: [], disallow: [] };
    } else if (field === 'allow' && current) {
      current.allow.push(value);
    } else if (field === 'disallow' && current) {
      current.disallow.push(value);
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }
  if (current && current.userAgents.length > 0) rules.push(current);

  return { raw: body, rules, sitemaps };
}

/** Resolve the matching rule group for a given UA. */
function selectRuleGroup(parsed: ParsedRobots, ua: string): ParsedRobots['rules'][number] | null {
  const uaLower = ua.toLowerCase();
  // Specific UA match wins over wildcard
  let best: { group: ParsedRobots['rules'][number]; specificity: number } | null = null;
  for (const group of parsed.rules) {
    for (const listed of group.userAgents) {
      if (listed === '*') {
        if (!best || best.specificity < 0) best = { group, specificity: 0 };
      } else if (uaLower.includes(listed) || listed.includes(uaLower)) {
        if (!best || best.specificity < listed.length) {
          best = { group, specificity: listed.length };
        }
      }
    }
  }
  return best?.group ?? null;
}

/**
 * Match a path against a directive pattern.
 * Supports '*' wildcard and '$' end-anchor per Google spec.
 */
export function pathMatches(path: string, pattern: string): boolean {
  if (!pattern) return false;
  // Regex escape, then replace wildcards with .* and trailing $ with $
  const escaped = pattern.replace(/[.+?^=!:{}()|\[\]\\]/g, '\\$&');
  const regexBody = escaped.replace(/\*/g, '.*');
  const regex = new RegExp('^' + regexBody + (pattern.endsWith('$') ? '$' : ''));
  return regex.test(path);
}

/** Decide whether `urlPath` is allowed by the resolved group. */
export function isAllowed(parsed: ParsedRobots, ua: string, urlPath: string): boolean {
  const group = selectRuleGroup(parsed, ua);
  if (!group) return true;

  let allowLen = -1;
  let disallowLen = -1;

  for (const allow of group.allow) {
    if (pathMatches(urlPath, allow)) {
      const len = allow.replace(/\*/g, '').length;
      if (len > allowLen) allowLen = len;
    }
  }
  for (const disallow of group.disallow) {
    if (disallow === '') continue; // empty Disallow = allow all
    if (pathMatches(urlPath, disallow)) {
      const len = disallow.replace(/\*/g, '').length;
      if (len > disallowLen) disallowLen = len;
    }
  }

  return allowLen >= disallowLen;
}

/**
 * Fetch + parse robots.txt for `origin`, with caching.
 * Returns null if robots.txt is unreachable (we treat this as "no restrictions").
 */
export async function fetchRobotsTxt(
  origin: string,
  page: Page | null,
  options: RobotsCheckOptions = {},
): Promise<ParsedRobots | null> {
  const ua = options.userAgent ?? DEFAULT_UA;
  const cached = cache.get(origin);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.parsed;
  }

  const url = new URL('/robots.txt', origin).toString();
  let body: string | null;
  try {
    if (options.fetcher) {
      body = await options.fetcher(url);
    } else if (page) {
      const resp = await page.context().request.get(url, {
        timeout: options.timeoutMs ?? 5000,
        headers: { 'User-Agent': ua },
      });
      if (resp.status() >= 400) body = null;
      else body = await resp.text();
    } else {
      body = null;
    }
  } catch {
    body = null;
  }

  const parsed = body === null ? null : parseRobotsTxt(body);
  cache.set(origin, { expiresAt: Date.now() + CACHE_TTL_MS, parsed });
  return parsed;
}

/**
 * Top-level convenience: returns true if `url` may be crawled under robots.txt.
 */
export async function robotsAllowed(
  url: string,
  page: Page | null,
  options: RobotsCheckOptions = {},
): Promise<boolean> {
  let origin: string;
  let path: string;
  try {
    const u = new URL(url);
    origin = u.origin;
    path = u.pathname + u.search;
  } catch {
    return false;
  }
  const parsed = await fetchRobotsTxt(origin, page, options);
  if (!parsed) return true;
  const ua = options.userAgent ?? DEFAULT_UA;
  return isAllowed(parsed, ua, path);
}

/** Test-only: clear the cache. */
export function _resetRobotsCache(): void {
  cache.clear();
}