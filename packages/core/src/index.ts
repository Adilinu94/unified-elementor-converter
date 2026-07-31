// @elconv/core — Shared Kernel
export * from './types.js';
export * from './issue-types.js';
export * from './branded-types.js';
export * from './contracts/index.js';
export * from './analyzer/index.js';
export * from './analysis/token-mapping.js';
export * from './design-system/index.js';
export * from './contamination.js';
export * from './guards.js';
export * from './deploy-strategy.js';
export * from './pipeline-state.js';
export * from './errors.js';
export * from './session.js';
export * from './run-archive.js';
export * from './config.js';
export * from './progress.js';
export * from './preflight/index.js';
export * from './structural-hash.js';
export * from './ai/index.js';
export * from './orchestrator/index.js';
export * from './logging.js';
export * from './security.js';
export * from './cache.js';
export * from './wpcode.js';
export * from './wpcode-helper.js';
export * from './token-pipeline.js';
export * from './lib/fonts-plugin-adapter.js';
export * from './lib/source-auth.js';
export * from './lib/v3-id.js';
export * from './lib/with-retry.js';
export * from './lib/wpcode-adapter.js';
export * from './lib/wp-target.js';
export * from './lib/paths.js';
export * from './lib/sleep.js';
export * from './lib/version.js';
export * from './orchestrator/manager-workflow.js';
export * from './orchestrator/phase-orchestrator.js';
export * from './orchestrator/run-report.js';

// `phase-orchestrator.js` (Phase 9) re-declares PhaseId/StageContext/StageResult/
// StageHandler/runStage that also come from `./orchestrator/index.js`. The generic
// stage runner there is canonical (its `runPipeline` + the orchestrator tests use
// these), so re-export the five names from it explicitly to resolve the barrel
// ambiguity (TS2308) deterministically.
export { runStage } from './orchestrator/index.js';
export type { PhaseId, StageContext, StageResult, StageHandler } from './orchestrator/index.js';
