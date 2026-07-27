import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hostnameFromUrl } from '@elconv/core';

export type PhaseName =
  | 'extract'
  | 'tokens'
  | 'classify'
  | 'assets'
  | 'design-system'
  | 'build'
  | 'qa'
  | 'animations';

export type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PhaseState {
  status: PhaseStatus;
  startedAt?: string;
  completedAt?: string;
  artifacts?: Record<string, string>;
  error?: string;
}

export interface SectionApproval {
  sectionId: string;
  approved: boolean;
  hash?: string;
}

export interface CloneState {
  schemaVersion: 1;
  sourceUrl: string;
  hostname: string;
  createdAt: string;
  updatedAt: string;
  outputDir: string;
  phases: Record<PhaseName, PhaseState>;
  approvedSections: SectionApproval[];
  options: {
    target?: string;
    viewports: number[];
    animations: 'none' | 'css' | 'gsap' | 'auto';
    fonts: 'auto' | 'system' | 'all';
    strictness: 'draft' | 'balanced' | 'pixel-perfect';
    /** Deployed clone page URL for QA stage (e.g. https://yoursite.local/?p=1234). */
    cloneUrl?: string;
    /** WordPress post ID of the deployed clone page for Auto-Fix MCP calls. */
    postId?: number;
    /** Enable QA auto-fix loop after pixel-diff (requires cloneUrl + postId + MCP). */
    qaAutoFix?: boolean;
    /** Upgrade the pushed page to Elementor V4 Atomic Widgets as the final pipeline step. */
    upgradeToV4?: boolean;
    /** Enable Vision-QA healing loop after pixel-diff (requires cloneUrl + postId + MCP). */
    heal?: boolean;
    /** Enable AI vision-enhancement for ambiguous sections during classification (Modul P1). */
    visionEnhance?: boolean;
    /** Generate an AI-proposed repair report for failing sections after QA (Modul AI2, diagnostic only). */
    fullContextRepair?: boolean;
  };
}

// Phase order MUST follow the V1/V2 stage flow (see analysis/pipeline.ts + UMBAUPLAN §2.2):
//   extract → classify → assets → tokens → design-system → build → qa → animations
// Bug history (V1, 2026-06-16): tokens was placed BEFORE classify, which caused
// reconcile() to resume at tokens after a crash, skipping classify entirely.
// Fix (V2 Phase 0, 2026-06-17): moved tokens to its correct position AFTER assets.
// Do not reorder without updating both this array AND the UMBAUPLAN §2.2 / §15.1.
const PHASE_ORDER: PhaseName[] = [
  'extract',
  'classify',
  'assets',
  'tokens',
  'design-system',
  'build',
  'qa',
  'animations',
];

export function emptyPhaseState(): PhaseState {
  return { status: 'pending' };
}

export function createInitialState(
  sourceUrl: string,
  outputDir: string,
  options: CloneState['options'],
): CloneState {
  const now = new Date().toISOString();
  const hostname = hostnameFromUrl(sourceUrl);
  const phases = {} as CloneState['phases'];
  for (const p of PHASE_ORDER) phases[p] = emptyPhaseState();
  return {
    schemaVersion: 1,
    sourceUrl,
    hostname,
    createdAt: now,
    updatedAt: now,
    outputDir,
    phases,
    approvedSections: [],
    options,
  };
}

export async function loadState(stateFile: string): Promise<CloneState> {
  const raw = await fs.readFile(stateFile, 'utf8');
  const parsed = JSON.parse(raw) as CloneState;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported state schema version: ${parsed.schemaVersion}`);
  }
  for (const p of PHASE_ORDER) {
    if (!parsed.phases[p]) parsed.phases[p] = emptyPhaseState();
  }
  return parsed;
}

export async function saveState(stateFile: string, state: CloneState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

export function stateFileFor(researchDir: string, hostname: string): string {
  return path.join(researchDir, hostname, 'state.json');
}

export function markRunning(state: CloneState, phase: PhaseName): void {
  state.phases[phase] = {
    status: 'running',
    startedAt: new Date().toISOString(),
  };
}

export function markCompleted(
  state: CloneState,
  phase: PhaseName,
  artifacts?: Record<string, string>,
): void {
  state.phases[phase] = {
    status: 'completed',
    startedAt: state.phases[phase].startedAt,
    completedAt: new Date().toISOString(),
    artifacts,
  };
}

export function markFailed(state: CloneState, phase: PhaseName, error: string): void {
  state.phases[phase] = {
    status: 'failed',
    startedAt: state.phases[phase].startedAt,
    completedAt: new Date().toISOString(),
    error,
  };
}

export function markSkipped(state: CloneState, phase: PhaseName): void {
  state.phases[phase] = {
    status: 'skipped',
    completedAt: new Date().toISOString(),
  };
}

export function reconcile(state: CloneState): PhaseName {
  for (const phase of PHASE_ORDER) {
    const p = state.phases[phase];
    if (p.status === 'pending' || p.status === 'running' || p.status === 'failed') {
      return phase;
    }
  }
  return 'animations';
}

export function approveSection(
  state: CloneState,
  sectionId: string,
  approved: boolean,
  hash?: string,
): void {
  const existing = state.approvedSections.find((s) => s.sectionId === sectionId);
  if (existing) {
    existing.approved = approved;
    if (hash) existing.hash = hash;
  } else {
    state.approvedSections.push({ sectionId, approved, hash });
  }
}

export function approvedSectionIds(state: CloneState): string[] {
  return state.approvedSections.filter((s) => s.approved).map((s) => s.sectionId);
}

export function isPhaseDone(state: CloneState, phase: PhaseName): boolean {
  return state.phases[phase].status === 'completed' || state.phases[phase].status === 'skipped';
}
