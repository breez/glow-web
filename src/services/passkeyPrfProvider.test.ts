import { describe, it, expect, vi, beforeEach } from 'vitest';

let isNative = false;
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));

beforeEach(() => {
  vi.resetModules();
});

describe('supportsImmediateGet', () => {
  it('is web-only: false on native', async () => {
    isNative = true;
    const { supportsImmediateGet } = await import('./passkeyPrfProvider');
    await expect(supportsImmediateGet()).resolves.toBe(false);
  });

  it('returns false in browsers without the capability API', async () => {
    isNative = false;
    const { supportsImmediateGet } = await import('./passkeyPrfProvider');
    await expect(supportsImmediateGet()).resolves.toBe(false);
  });
});

describe('canSilentlyDetectPasskey', () => {
  it('returns true on native even though immediateGet is web-only (PR #246 regression)', async () => {
    isNative = true;
    const { canSilentlyDetectPasskey } = await import('./passkeyPrfProvider');
    await expect(canSilentlyDetectPasskey()).resolves.toBe(true);
  });

  it('follows the immediateGet capability in browsers', async () => {
    isNative = false;
    const { canSilentlyDetectPasskey } = await import('./passkeyPrfProvider');
    await expect(canSilentlyDetectPasskey()).resolves.toBe(false);
  });
});
