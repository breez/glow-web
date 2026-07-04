import { describe, it, expect, vi, beforeEach } from 'vitest';

let isNative = false;
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));

beforeEach(() => {
  vi.resetModules();
});

describe('supportsImmediateGet', () => {
  it('returns true on native even while the browser kill switch is off (PR #246 regression)', async () => {
    isNative = true;
    const { supportsImmediateGet } = await import('./passkeyPrfProvider');
    await expect(supportsImmediateGet()).resolves.toBe(true);
  });

  it('returns false in browsers while the kill switch is off', async () => {
    isNative = false;
    const { supportsImmediateGet } = await import('./passkeyPrfProvider');
    await expect(supportsImmediateGet()).resolves.toBe(false);
  });
});
