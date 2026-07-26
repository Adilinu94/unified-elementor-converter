/**
 * AI-Task-Kategorien + Provider-Auswahl-Mapping.
 *
 * Die Kern-AI-Typen (AITask, AIResponse, VisionProvider, CostEntry) leben seit
 * Phase 35 kanonisch in ../contracts/ai.contract.ts. router.ts/cost-tracker.ts
 * importieren sie von dort; hier bleiben nur die Router-eigenen Kategorien.
 */
export type TaskCategory = 'cheap' | 'medium' | 'expensive';

export const TASK_CATEGORY: Record<string, TaskCategory> = {
  'section-classify': 'cheap',
  'component-detect': 'medium',
  'vision-qa': 'medium',
  'repair-block': 'expensive',
  'token-semantics': 'medium',
};
