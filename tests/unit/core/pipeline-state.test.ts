import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadState,
  saveState,
  markPhase,
  createInitialState,
  type PipelineState,
} from '../../../packages/core/src/pipeline-state.ts';

describe('pipeline-state', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'elconv-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loadState returns null for missing file', () => {
    expect(loadState(join(tempDir, 'nonexistent.json'))).toBeNull();
  });

  it('loadState returns null for invalid JSON', () => {
    const path = join(tempDir, 'bad.json');
    const { writeFileSync } = require('node:fs');
    writeFileSync(path, 'not json{{{', 'utf-8');
    expect(loadState(path)).toBeNull();
  });

  it('saveState + loadState roundtrip', () => {
    const path = join(tempDir, 'state.json');
    const state = createInitialState('v3', { type: 'url', url: 'https://example.com' });
    saveState(path, state);
    const loaded = loadState(path);
    expect(loaded).not.toBeNull();
    expect(loaded!.target).toBe('v3');
    expect(loaded!.source.url).toBe('https://example.com');
    expect(loaded!.version).toBe(3);
  });

  it('saveState creates nested directories', () => {
    const path = join(tempDir, 'deep', 'nested', 'state.json');
    const state = createInitialState('v4', { type: 'framer-xml', xmlPath: './test.xml' });
    saveState(path, state);
    const loaded = loadState(path);
    expect(loaded!.target).toBe('v4');
  });

  it('markPhase updates phase status', () => {
    const state = createInitialState('v3', { type: 'url' });
    const updated = markPhase(state, 'extract', 'done');
    expect(updated.phases['extract']).toBe('done');
    expect(updated.phases).not.toBe(state.phases); // immutable
  });

  it('markPhase preserves other phases', () => {
    let state = createInitialState('v3', { type: 'url' });
    state = markPhase(state, 'extract', 'done');
    state = markPhase(state, 'build', 'failed');
    expect(state.phases['extract']).toBe('done');
    expect(state.phases['build']).toBe('failed');
  });

  it('createInitialState has correct shape', () => {
    const state: PipelineState = createInitialState('v4', {
      type: 'html-export',
      url: undefined,
      xmlPath: undefined,
    });
    expect(state.version).toBe(3);
    expect(state.target).toBe('v4');
    expect(state.phases).toEqual({});
    expect(state.artifacts).toEqual({});
    expect(state.updatedAt).toBeTruthy();
  });
});
