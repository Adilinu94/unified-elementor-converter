/**
 * Deploy strategy selection based on tree size.
 * Both V3 and V4 use the same thresholds (empirically validated).
 */

export type DeployStrategy = 'direct' | 'upload-php' | 'split';

export const STRATEGY_THRESHOLDS = {
  /** Below this: direct set-content / inject */
  directMaxBytes: 400_000,
  /** Below this: upload file + PHP inject */
  uploadPhpMaxBytes: 1_200_000,
  /** Above uploadPhpMaxBytes: split top-level sections */
} as const;

export function chooseDeployStrategy(
  treeBytes: number,
  forced?: DeployStrategy,
): DeployStrategy {
  if (forced) return forced;
  if (treeBytes < STRATEGY_THRESHOLDS.directMaxBytes) return 'direct';
  if (treeBytes < STRATEGY_THRESHOLDS.uploadPhpMaxBytes) return 'upload-php';
  return 'split';
}

export function measureTreeBytes(tree: unknown): number {
  return Buffer.byteLength(JSON.stringify(tree), 'utf-8');
}
