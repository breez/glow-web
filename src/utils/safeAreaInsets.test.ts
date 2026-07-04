import { describe, it, expect, vi, afterEach } from 'vitest';

// The module resolves its exports at import time from Capacitor platform
// checks and navigator.userAgent, so each case mocks those and re-imports.
async function loadOnAndroidWebView(chromeMajor: number) {
  vi.resetModules();
  vi.doMock('@capacitor/core', () => ({
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    },
  }));
  vi.stubGlobal('navigator', {
    userAgent: `Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`,
  });
  return import('./safeAreaInsets');
}

afterEach(() => {
  vi.doUnmock('@capacitor/core');
  vi.unstubAllGlobals();
});

describe('safeAreaInsets on Android native', () => {
  it('consumes Capacitor safe-area vars with env() fallback and a 0.5rem floor on WebView >= 140 (passthrough insets)', async () => {
    const { safeAreaTop, safeAreaBottom } = await loadOnAndroidWebView(140);
    expect(safeAreaTop).toBe('max(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)), 0.5rem)');
    expect(safeAreaBottom).toBe('max(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)), 0.5rem)');
  });

  it('keeps the fixed 0.5rem gap on WebView < 140', async () => {
    const { safeAreaTop, safeAreaBottom } = await loadOnAndroidWebView(139);
    expect(safeAreaTop).toBe('0.5rem');
    expect(safeAreaBottom).toBe('0.5rem');
  });
});
