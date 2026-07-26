import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mapDesignTokens, type MappedTokens, type V4Variable } from './token-mapping.js';
import type { McpAdapter } from '../mcp/mcp-adapter.js';
import type { DesignTokens } from '../analyzer/index.js';

export interface SyncOptions {
  dryRun?: boolean;
  cachePath?: string;
  minScore?: number;
  forceFresh?: boolean;
}

export interface SyncResult {
  tokens: MappedTokens;
  artifactPath: string;
  newVariables: V4Variable[];
  newClasses: Array<{ id: string; label: string; selector: string }>;
  reusedVariables: number;
  reusedClasses: number;
  cacheHits: number;
}

export interface TokenSyncCache {
  variables: Record<string, string>;
  classes: Record<string, string>;
  lastSyncedAt: string;
}

export async function loadCache(cachePath: string): Promise<TokenSyncCache> {
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    return JSON.parse(raw) as TokenSyncCache;
  } catch {
    return { variables: {}, classes: {}, lastSyncedAt: new Date(0).toISOString() };
  }
}

export async function writeCache(cachePath: string, cache: TokenSyncCache): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

export async function syncTokens(
  tokens: DesignTokens,
  mcp: McpAdapter,
  outputDir: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const cachePath = options.cachePath ?? path.join(outputDir, 'sync-cache.json');
  const cache = options.forceFresh
    ? { variables: {}, classes: {}, lastSyncedAt: new Date(0).toISOString() }
    : await loadCache(cachePath);

  const existingVariables = Object.entries(cache.variables).map(([id, label]) => ({
    id,
    label,
    value: label,
  }));

  const mapped = mapDesignTokens(tokens, {
    prefix: 'sv',
    existingVariables,
  });

  const newVariables: V4Variable[] = [];
  const reusedVariableIds: string[] = [];

  for (const v of mapped.variables) {
    if (v.existingId) {
      reusedVariableIds.push(v.existingId);
      v.synced = true;
    } else if (cache.variables[v.id]) {
      v.existingId = cache.variables[v.id];
      v.synced = true;
      reusedVariableIds.push(cache.variables[v.id]);
    } else {
      newVariables.push(v);
    }
  }

  const newClasses: Array<{ id: string; label: string; selector: string }> = [];
  const reusedClassIds: string[] = [];

  for (const c of mapped.classes) {
    if (cache.classes[c.id]) {
      reusedClassIds.push(cache.classes[c.id]);
    } else {
      newClasses.push(c);
    }
  }

  if (!options.dryRun && newVariables.length > 0) {
    const foundation = await mcp.callTool('mcp-adapter-execute-ability', {
      ability_name: 'novamira-adrianv2/setup-v4-foundation',
      parameters: {
        create_missing: true,
        variables: newVariables.map((v) => ({ label: v.label, type: v.type, value: v.value })),
      },
    });

    const data = parseDataFromContent(foundation);
    const idMap = (data?.variables ?? {}) as Record<string, string>;
    for (const v of newVariables) {
      const realId = idMap[v.label] ?? idMap[v.id];
      if (realId) {
        v.existingId = String(realId);
        v.synced = true;
        cache.variables[v.id] = String(realId);
      }
    }
  }

  if (!options.dryRun && newClasses.length > 0) {
    for (const c of newClasses) {
      const applyResult = await mcp.callTool('mcp-adapter-execute-ability', {
        ability_name: 'novamira-adrianv2/create-global-class',
        parameters: { label: c.label, selector: c.selector },
      });
      const data = parseDataFromContent(applyResult);
      const realId = data?.id ?? data?.class_id;
      if (realId) {
        c.id = String(realId);
        cache.classes[c.id] = String(realId);
      }
    }
  }

  cache.lastSyncedAt = new Date().toISOString();
  if (!options.dryRun) {
    await writeCache(cachePath, cache);
  }

  const artifactPath = path.join(outputDir, 'synced-tokens.json');
  const artifact = {
    syncedAt: cache.lastSyncedAt,
    variables: mapped.variables.map((v) => ({ ...v })),
    classes: mapped.classes,
    newVariables: newVariables.map((v) => v.id),
    newClasses: newClasses.map((c) => c.id),
    reusedVariableCount: reusedVariableIds.length,
    reusedClassCount: reusedClassIds.length,
  };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf-8');

  return {
    tokens: mapped,
    artifactPath,
    newVariables,
    newClasses,
    reusedVariables: reusedVariableIds.length,
    reusedClasses: reusedClassIds.length,
    cacheHits: reusedVariableIds.length + reusedClassIds.length,
  };
}

function parseDataFromContent(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { content?: Array<{ text?: string }> };
  const text = r.content?.[0]?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { success?: boolean; data?: Record<string, unknown> };
    return parsed.data ?? null;
  } catch {
    return null;
  }
}
