// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/replay.js — UMBAUPLAN v2.0 Phase 6.4
 *
 * Pipeline-Replay-Mode: spielt einen gespeicherten Build-Trace 1:1 nach,
 * ohne Framer-Source oder WP-Connection. Ideal für Pipeline-Iteration.
 *
 * Replay-File Format (.framer-export-cache/replay-{post_id}.json):
 *   {
 *     post_id: number,
 *     timestamp: ISO,
 *     framer_url: string,
 *     v4Tree: object,           // V4-Tree von letztem Build
 *     tokenMapping: object,
 *     fontResolution: object,
 *     imageMap: object,
 *     workarounds: array,
 *     validation: { score, errors, warnings, passed }
 *   }
 *
 * USAGE:
 *   const replay = await loadReplay('.framer-export-cache/replay-123.json');
 *   const v4 = replay.v4Tree;  // direkt verfügbar
 *   const result = await runReplay({ replay, steps: ['validate', 'fix-styles'] });
 *
 * Ziel: Replay-Dauer < 30s statt 23min Full-Build.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const REPLAY_STEPS = {
  validate:           { script: 'validate-v4-tree.js',         args: f => [f] },
  'pre-build':        { script: 'framer-pre-build-validate.js', args: f => [f] },
  'fix-styles':       { script: 'post-build-auto-fix.js',       args: f => [f] },
  'patch-media-ids':  { script: 'patch-v4-tree-media-ids.js',   args: f => [f] },
  'auto-scale':       { script: 'auto-scale-responsive.js',     args: f => [f] },
  'generate-gc':      { script: 'generate-global-classes.js',   args: f => [f] },
  'cross-validate':   { script: 'cross-validate-sources.js',    args: f => [f] },
};

/**
 * Lädt ein Replay-File.
 *
 * @param {string} replayPath - Absoluter Pfad zu replay-{post_id}.json
 * @returns {object|null} Replay-Daten oder null
 */
export function loadReplay(replayPath) {
  if (!existsSync(replayPath)) return null;
  try {
    return JSON.parse(readFileSync(replayPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Speichert einen Build-State als Replay-File.
 *
 * @param {string} cacheDir - z.B. '.framer-export-cache'
 * @param {object} state - { post_id, framer_url, v4Tree, tokenMapping, ... }
 * @returns {string} Pfad zum Replay-File
 */
export function saveReplay(cacheDir, state) {
  if (!state?.post_id) throw new Error('saveReplay: state.post_id required');
  const filePath = join(cacheDir, `replay-${state.post_id}.json`);
  const payload = {
    post_id: state.post_id,
    timestamp: new Date().toISOString(),
    framer_url: state.framer_url || null,
    v4Tree: state.v4Tree,
    tokenMapping: state.tokenMapping || null,
    fontResolution: state.fontResolution || null,
    imageMap: state.imageMap || null,
    workarounds: state.workarounds || [],
    validation: state.validation || null,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

/**
 * Führt Replay-Steps gegen den V4-Tree aus.
 *
 * @param {object} opts
 * @param {object} opts.replay - geladene Replay-Daten
 * @param {string[]} [opts.steps=['validate']] - Replay-Schritte
 * @param {string} opts.pipelineDir - Absoluter Pfad zu scripts/
 * @returns {Promise<{steps: Array, v4Tree: object, validation: object|null}>}
 */
export async function runReplay({ replay, steps = ['validate'], pipelineDir }) {
  if (!replay?.v4Tree) throw new Error('runReplay: replay.v4Tree required');
  if (!pipelineDir) throw new Error('runReplay: pipelineDir required');

  // Write v4Tree to temp file for step-scripts to read
  const tmpFile = join(replay.cacheDir || '.framer-export-cache', `replay-tmp-${replay.post_id}.json`);
  writeFileSync(tmpFile, JSON.stringify(replay.v4Tree, null, 2), 'utf8');

  const results = [];
  let currentTree = replay.v4Tree;

  for (const step of steps) {
    const def = REPLAY_STEPS[step];
    if (!def) {
      results.push({ step, status: 'skipped', reason: 'unknown step' });
      continue;
    }
    const scriptPath = join(pipelineDir, def.script);
    const args = def.args(tmpFile);
    const t0 = Date.now();
    const r = spawnSync('node', [scriptPath, ...args], { stdio: 'pipe', encoding: 'utf8' });
    const duration = Date.now() - t0;

    results.push({
      step,
      script: def.script,
      status: r.status === 0 ? 'ok' : 'failed',
      duration_ms: duration,
      exitCode: r.status,
      stdout: r.stdout?.slice(0, 500),
      stderr: r.stderr?.slice(0, 500),
    });

    // Reload tree if step modifies it
    if (['fix-styles', 'patch-media-ids', 'auto-scale', 'generate-gc'].includes(step) && r.status === 0) {
      try {
        currentTree = JSON.parse(readFileSync(tmpFile, 'utf8'));
      } catch { /* keep previous tree */ }
    }
  }

  return {
    steps: results,
    v4Tree: currentTree,
    validation: results.find(r => r.step === 'validate' && r.status === 'ok') || null,
  };
}

/**
 * Listet alle verfügbaren Replay-Files.
 *
 * @param {string} cacheDir
 * @returns {Array<{post_id: number, path: string, age_ms: number}>}
 */
export function listReplays(cacheDir) {
  if (!existsSync(cacheDir)) return [];
  return readdirSync(cacheDir)
    .filter(f => f.startsWith('replay-') && f.endsWith('.json') && !f.includes('tmp'))
    .map(f => {
      const full = join(cacheDir, f);
      const stat = statSync(full);
      const m = f.match(/replay-(\d+)\.json/);
      return {
        post_id: m ? parseInt(m[1], 10) : null,
        path: full,
        age_ms: Date.now() - stat.mtimeMs,
      };
    })
    .filter(r => r.post_id != null)
    .sort((a, b) => b.age_ms - a.age_ms);
}
