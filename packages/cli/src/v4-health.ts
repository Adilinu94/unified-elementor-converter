// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/health.js — UMBAUPLAN v2.0 Phase 7.3
 *
 * Health-Check-Endpoint für Uptime-Monitoring.
 *
 * Returns JSON-Status mit:
 *   - status (ok / degraded / down)
 *   - last_build
 *   - mcp_connection
 *   - plugin_health
 *   - elementor_version
 *   - workarounds_active
 *   - cache_hit_rate
 *   - error_count_last_24h
 *
 * USAGE:
 *   import { getHealthStatus } from './health.js';
 *   const status = await getHealthStatus({ cacheDir, mcpBridge });
 *
 *   // In HTTP-Server (cmd-serve.js):
 *   app.get('/health', async (req, res) => {
 *     res.json(await getHealthStatus({ ... }));
 *   });
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RECENT_BUILD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * @param {object} options
 * @param {string} options.cacheDir
 * @param {object} [options.mcpBridge] - Optional: { call(name, params) }
 * @returns {Promise<object>} health status
 */
export async function getHealthStatus({ cacheDir, mcpBridge }) {
  const status = {
    timestamp: new Date().toISOString(),
    status: 'ok',
    checks: {},
  };

  // 1. Cache-Hit-Rate
  const cacheStats = getCacheStats(cacheDir);
  status.checks.cache = cacheStats;
  status.cache_hit_rate = cacheStats.hit_rate;

  // 2. Last build
  const lastBuild = getLastBuildInfo(cacheDir);
  status.last_build = lastBuild;
  if (lastBuild && Date.now() - lastBuild.age_ms > RECENT_BUILD_WINDOW_MS) {
    status.status = 'degraded';
    status.checks.last_build = { warning: 'no build in 7 days' };
  }

  // 3. MCP connection
  if (mcpBridge?.call) {
    try {
      const res = await mcpBridge.call('novamira/adrians-greet', { name: 'health' });
      status.mcp_connection = { ok: true, response: res?.greeting || 'ok' };
    } catch (e) {
      status.mcp_connection = { ok: false, error: e.message };
      status.status = 'degraded';
    }
  } else {
    status.mcp_connection = { ok: null, note: 'no bridge provided' };
  }

  // 4. Plugin health
  if (mcpBridge?.call) {
    try {
      const v = await mcpBridge.call('novamira/version', {});
      status.plugin_health = { ok: true, version: v?.version || 'unknown' };
    } catch (e) {
      status.plugin_health = { ok: false, error: e.message };
    }
  } else {
    status.plugin_health = { ok: null };
  }

  // 5. Elementor version
  if (mcpBridge?.call) {
    try {
      const setup = await mcpBridge.call('novamira/elementor-check-setup', {});
      status.elementor_version = setup?.elementor?.version || null;
    } catch {
      status.elementor_version = null;
    }
  } else {
    status.elementor_version = null;
  }

  // 6. Error count last 24h
  status.error_count_last_24h = getErrorCount(cacheDir, 24 * 60 * 60 * 1000);

  // 7. Workarounds active (count of foundation-fallback + css-injector files)
  status.workarounds_active = getWorkaroundCount(cacheDir);

  return status;
}

function getCacheStats(cacheDir) {
  if (!existsSync(cacheDir)) {
    return { files: 0, size_kb: 0, hit_rate: 0 };
  }
  const framerDir = join(cacheDir, 'framer-source');
  if (!existsSync(framerDir)) {
    return { files: 0, size_kb: 0, hit_rate: 0 };
  }
  let count = 0;
  let size = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        count++;
        try { size += statSync(p).size; } catch { /* noop */ }
      }
    }
  };
  walk(framerDir);
  return { files: count, size_kb: Math.round(size / 1024), hit_rate: 0 };
}

function getLastBuildInfo(cacheDir) {
  if (!existsSync(cacheDir)) return null;
  // Look for replay-*.json files
  const files = readdirSync(cacheDir).filter(f => /^replay-\d+\.json$/.test(f));
  if (files.length === 0) return null;
  let newest = null;
  for (const f of files) {
    const p = join(cacheDir, f);
    try {
      const stat = statSync(p);
      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = { path: p, mtimeMs: stat.mtimeMs };
      }
    } catch { /* noop */ }
  }
  if (!newest) return null;
  const m = newest.path.match(/replay-(\d+)\.json/);
  return {
    post_id: m ? parseInt(m[1], 10) : null,
    age_ms: Date.now() - newest.mtimeMs,
    timestamp: new Date(newest.mtimeMs).toISOString(),
  };
}

function getErrorCount(cacheDir, windowMs) {
  if (!existsSync(cacheDir)) return 0;
  const errFile = join(cacheDir, 'errors-current.jsonl');
  if (!existsSync(errFile)) return 0;
  try {
    const content = readFileSync(errFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const cutoff = Date.now() - windowMs;
    return lines.filter(line => {
      try {
        const e = JSON.parse(line);
        return new Date(e.timestamp).getTime() > cutoff;
      } catch { return false; }
    }).length;
  } catch { return 0; }
}

function getWorkaroundCount(cacheDir) {
  if (!existsSync(cacheDir)) return 0;
  const files = readdirSync(cacheDir);
  let count = 0;
  if (files.some(f => f.startsWith('foundation-fallback-'))) count++;
  if (files.some(f => f.startsWith('image-map-'))) count++;
  return count;
}
