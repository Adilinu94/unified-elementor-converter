/**
 * contracts/index.ts — Barrel-Export für alle paketübergreifenden Contracts.
 * Contract-Typen immer von hier importieren, nie aus konkreten Implementierungen.
 *
 * Portiert aus site-clone-to-v3/src/contracts/index.ts.
 * Anpassung: `ai.contract` wird selektiv re-exportiert — das Interface
 * `AIRouter` wird ausgelassen, weil die konkrete Klasse `AIRouter`
 * (core/src/ai/router.ts) denselben Namen als Laufzeit-Wert belegt und aus
 * ./ai/index.js exportiert wird (sonst Barrel-Namens-Kollision).
 */
export * from './shared.contract.js';
export * from './diff.contract.js';
export * from './tokens.contract.js';
export type {
  ScreenshotInput,
  AITask,
  AIResponse,
  VisionProvider,
  CostEntry,
  CostReport,
  VisionQAResult,
  ComponentDetectionResult,
  RepairBlockInput,
  RepairResult,
  RunVisionQAFn,
  RepairBlockViaAIFn,
  CreateAIRouterOptions,
  CreateAIRouterFn,
} from './ai.contract.js';
