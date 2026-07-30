import { describe, it, expect, vi, beforeEach } from 'vitest';

let isNative = false;
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));

beforeEach(() => {
  vi.resetModules();
});

describe('supportsImmediateGet', () => {
  // Pinned off even where the browser advertises the capability: immediate
  // mediation cannot tell "no passkey" from "prompt dismissed", so a
  // returning user can look new and get a duplicate passkey.
  it('is off in browsers that advertise immediateGet', async () => {
    isNative = false;
    vi.stubGlobal('PublicKeyCredential', {
      getClientCapabilities: async () => ({ immediateGet: true }),
    });
    const { supportsImmediateGet } = await import('./passkeyPrfProvider');
    await expect(supportsImmediateGet()).resolves.toBe(false);
    vi.unstubAllGlobals();
  });

  it('is off on native', async () => {
    isNative = true;
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

  // Drives HomePage's two-CTA gate and PasskeyPage's explicit signIn flow.
  it('is false in browsers, so web takes the two-CTA flow', async () => {
    isNative = false;
    const { canSilentlyDetectPasskey } = await import('./passkeyPrfProvider');
    await expect(canSilentlyDetectPasskey()).resolves.toBe(false);
  });
});
