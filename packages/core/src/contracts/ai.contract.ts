/**
 * ai.contract.ts — Central AI Engine API.
 *
 * Portiert aus site-clone-to-v3/src/contracts/ai.contract.ts (unverändert).
 * Kanonischer Contract für die AI-Engine. Andere Module konsumieren diese
 * Typen; Implementierungen (core/src/ai/*) erfüllen sie.
 *
 * Hinweis: Das Interface `AIRouter` beschreibt dieselbe Shape wie die konkrete
 * Klasse `AIRouter` (core/src/ai/router.ts). Um eine Namens-Kollision im
 * Core-Barrel zu vermeiden, wird das Interface NICHT aus contracts/index.ts
 * re-exportiert — die Klasse ist die kanonische Laufzeit-Implementierung.
 * Innerhalb dieser Datei referenzieren die Function-Contracts das Interface.
 */

import type { TokenConstraintSet } from './tokens.contract.js';
import type { BBox } from './shared.contract.js';

// ─── Provider / Task / Response ─────────────────────────────────────────────

export interface ScreenshotInput {
  /** File path to the screenshot (providers read the file themselves). */
  path: string;
  /** Human-readable label, e.g. "Original" / "Clone" / "Section". */
  label?: string;
}

export interface AITask {
  name: string;
  prompt: string;
  images?: ScreenshotInput[];
  /** Expected response shape, used for JSON validation/parsing by the router. */
  schema?: unknown;
  /** Additional structured context (kept alongside the task for logging/tests). */
  context?: Record<string, unknown>;
}

export interface AIResponse<T = unknown> {
  text: string;
  parsed?: T;
  /** Cost of this call in USD. */
  cost: number;
  provider: string;
  durationMs: number;
}

export interface VisionProvider {
  readonly name: string;
  readonly costPerImage: number;
  execute(task: AITask): Promise<AIResponse>;
  available(): Promise<boolean>;
}

export interface AIRouter {
  execute<T = unknown>(task: AITask): Promise<AIResponse<T>>;
}

// ─── Cost Tracking ───────────────────────────────────────────────────────────

export interface CostEntry {
  task: string;
  provider: string;
  cost: number;
  durationMs: number;
  timestamp: string;
}

export interface CostReport {
  totalCost: number;
  taskCount: number;
  byTask: Record<string, CostEntry[]>;
  byProvider: Record<string, CostEntry[]>;
  entries: CostEntry[];
}

// ─── Task Result Shapes ──────────────────────────────────────────────────────

export interface VisionQAResult {
  overallScore: number;
  matchRating: 'excellent' | 'good' | 'fair' | 'poor';
  issues: Array<{
    type: string;
    severity: string;
    location: string;
    description: string;
    suggestedFix: string;
  }>;
  semanticFeedback: string;
  computedAt: string;
}

export interface ComponentDetectionResult {
  type: string;
  confidence: number;
  evidence: string;
  layer: 'structure' | 'vision' | 'keyword' | 'unknown';
}

/** Full context handed to the AI for a single repair attempt (Modul AI2). */
export interface RepairBlockInput {
  originalScreenshotPath: string;
  cloneScreenshotPath: string;
  diffHotspot?: BBox;
  html: string;
  computedCss: Record<string, string>;
  elementType: string;
  parentHtml?: string;
  siblingHtml?: string[];
  tokenConstraints?: TokenConstraintSet;
  existingClasses?: string[];
}

export interface RepairResult {
  success: boolean;
  settings?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  classes?: string[];
  explanation: string;
  /** How many repair attempts (1 or 2) produced this result. */
  attemptsUsed: number;
}

// ─── Function Contracts ──────────────────────────────────────────────────────

export type RunVisionQAFn = (
  router: AIRouter,
  options: { originalPath: string; clonePath: string },
) => Promise<VisionQAResult>;

export type RepairBlockViaAIFn = (
  router: AIRouter,
  input: RepairBlockInput,
) => Promise<RepairResult>;

export interface CreateAIRouterOptions {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  logger?: (msg: string) => void;
}

export type CreateAIRouterFn = (options?: CreateAIRouterOptions) => AIRouter;
