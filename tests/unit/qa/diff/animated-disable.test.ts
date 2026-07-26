import { describe, it, expect, vi } from 'vitest';
import { disableAnimations } from '@elconv/qa';

describe('disableAnimations', () => {
  it('injects a style tag that disables animations and transitions', async () => {
    const addStyleTag = vi.fn().mockResolvedValue(undefined);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const page = { addStyleTag, waitForTimeout } as any;

    await disableAnimations(page);

    expect(addStyleTag).toHaveBeenCalledTimes(1);
    const injectedCss = addStyleTag.mock.calls[0][0].content as string;
    expect(injectedCss).toContain('animation: none !important');
    expect(injectedCss).toContain('transition: none !important');
    expect(waitForTimeout).toHaveBeenCalledWith(expect.any(Number));
  });
});
