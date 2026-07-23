export interface AITask {
  name: string;
  prompt: string;
  images?: string[];
  schema?: boolean;
}

export interface AIResponse<T = unknown> {
  text: string;
  parsed?: T;
  provider: string;
  cost: number;
  durationMs: number;
}

export interface VisionProvider {
  name: string;
  costPerImage: number;
  available(): Promise<boolean>;
  execute(task: AITask): Promise<AIResponse>;
}

export interface CostEntry {
  task: string;
  provider: string;
  cost: number;
  durationMs: number;
  timestamp: string;
}

export type TaskCategory = 'cheap' | 'medium' | 'expensive';

export const TASK_CATEGORY: Record<string, TaskCategory> = {
  'section-classify': 'cheap',
  'component-detect': 'medium',
  'vision-qa': 'medium',
  'repair-block': 'expensive',
  'token-semantics': 'medium',
};
