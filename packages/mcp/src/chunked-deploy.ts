/**
 * Chunked Deploy with Checkpoints.
 * Verbesserung #6: 20-Element-Chunks, get-page-elements nach jedem Chunk,
 * nur letzten Chunk wiederholen bei Fehler.
 */

export const CHUNK_SIZE = 20;

export interface ChunkResult {
  chunkIndex: number;
  elementCount: number;
  success: boolean;
  verified: boolean;
  error?: string;
}

export interface ChunkedDeployPlan {
  totalElements: number;
  chunkCount: number;
  chunkSize: number;
  chunks: unknown[][];
}

/**
 * Split a tree into chunks of CHUNK_SIZE elements.
 */
export function planChunkedDeploy(tree: unknown[], chunkSize = CHUNK_SIZE): ChunkedDeployPlan {
  const chunks: unknown[][] = [];
  for (let i = 0; i < tree.length; i += chunkSize) {
    chunks.push(tree.slice(i, i + chunkSize));
  }
  return {
    totalElements: tree.length,
    chunkCount: chunks.length,
    chunkSize,
    chunks,
  };
}

/**
 * Determine which chunk to resume from after a failure.
 * Returns the index of the last verified checkpoint, or 0 if none.
 */
export function getResumeIndex(results: ChunkResult[]): number {
  const lastVerified = [...results].reverse().find((r) => r.verified);
  if (!lastVerified) return 0;
  // Resume from the chunk AFTER the last verified one
  return Math.min(lastVerified.chunkIndex + 1, results.length);
}

/**
 * Check if a deploy can be resumed (has at least one verified checkpoint).
 */
export function canResume(results: ChunkResult[]): boolean {
  return results.some((r) => r.verified);
}

/**
 * Calculate progress percentage.
 */
export function deployProgress(results: ChunkResult[], totalChunks: number): number {
  if (totalChunks === 0) return 100;
  const completed = results.filter((r) => r.success).length;
  return Math.round((completed / totalChunks) * 100);
}

/**
 * Validate that all chunks were deployed successfully.
 */
export function isDeployComplete(results: ChunkResult[], expectedChunks: number): boolean {
  if (results.length < expectedChunks) return false;
  return results.every((r) => r.success);
}

/**
 * Find failed chunks for retry.
 */
export function getFailedChunks(results: ChunkResult[]): ChunkResult[] {
  return results.filter((r) => !r.success);
}
