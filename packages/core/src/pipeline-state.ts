import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ElementorTarget } from './branded-types.js';

export interface PipelineState {
  version: 3;
  target: ElementorTarget;
  source: {
    type: 'url' | 'framer-xml' | 'html-export';
    url?: string;
    xmlPath?: string;
  };
  postId?: number;
  phases: Record<string, 'pending' | 'done' | 'failed' | 'skipped'>;
  lastError?: string;
  updatedAt: string;
  artifacts: Record<string, string>;
}

export function loadState(path: string): PipelineState | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PipelineState;
  } catch {
    return null;
  }
}

export function saveState(path: string, state: PipelineState): void {
  mkdirSync(dirname(path), { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

export function markPhase(
  state: PipelineState,
  phaseId: string,
  status: 'pending' | 'done' | 'failed' | 'skipped',
): PipelineState {
  return {
    ...state,
    phases: { ...state.phases, [phaseId]: status },
    updatedAt: new Date().toISOString(),
  };
}

export function createInitialState(
  target: ElementorTarget,
  source: PipelineState['source'],
): PipelineState {
  return {
    version: 3,
    target,
    source,
    phases: {},
    artifacts: {},
    updatedAt: new Date().toISOString(),
  };
}
