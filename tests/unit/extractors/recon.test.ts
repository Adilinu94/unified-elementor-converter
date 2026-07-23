import { describe, it, expect } from 'vitest';
import type { ReconResult, ReconOptions } from '@elconv/extractors';

describe('Recon Types', () => {
  it('ReconResult has expected shape', () => {
    const result: ReconResult = {
      isSpa: true,
      framework: 'next.js',
      mutationCount: 42,
      animationCount: 5,
      events: [],
      durationMs: 5000,
    };
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe('next.js');
  });

  it('ReconOptions has defaults', () => {
    const opts: ReconOptions = {};
    expect(opts.targetSelector).toBeUndefined();
    expect(opts.maxEvents).toBeUndefined();
  });
});
