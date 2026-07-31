/**
 * src/types/common.ts
 * Gemeinsame Typdefinitionen für alle Pipeline-Module.
 */

// ── CSS Variable & Token Resolution ──────────────────────────────────────────

import type { DesignToken } from '@elconv/core';

export interface TokenMapping {
  colors?: DesignToken[];
  fonts?: Record<string, { gv_id?: string }>;
  [key: string]: unknown;
}

// ── Structural Hashing ───────────────────────────────────────────────────────

export interface StructuralHashOptions {
  short?: boolean;
  includeTag?: boolean;
  nullOnSmall?: boolean;
}

// ── File/Path Utilities ──────────────────────────────────────────────────────

export interface FileEntry {
  filename: string;
  mime_type: string;
  content_base64: string;
}

// ── Quality / Validation ────────────────────────────────────────────────────

export interface QualityMetric {
  name: string;
  score: number;
  max: number;
  details?: string;
}

export interface ValidationIssue {
  type: string;
  message: string;
  path?: string;
  severity: 'error' | 'warning';
}

// ── Pipeline State (shared across orchestrator) ──────────────────────────────

export interface PipelinePhaseState {
  phase: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface PipelineArtifact {
  path: string;
  hash: string;
  timestamp: string;
}

export interface PipelineState {
  currentPhase: number;
  completedPhases: number[];
  artifacts: Record<string, PipelineArtifact>;
  variables: Record<string, unknown>;
  timestamp: string;
}
