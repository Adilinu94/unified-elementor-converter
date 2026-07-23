export interface ReconOptions {
  targetSelector?: string;
  maxEvents?: number;
  watchedAttributes?: string[];
  windowMs?: number;
}

export interface ReconEvent {
  type: 'mutation' | 'animation';
  selector: string;
  mutationType?: string;
  attributeName?: string;
  animationType?: string;
  animationName?: string;
  timestamp: number;
}

export interface ReconResult {
  isSpa: boolean;
  framework: string | null;
  mutationCount: number;
  animationCount: number;
  events: ReconEvent[];
  durationMs: number;
}
