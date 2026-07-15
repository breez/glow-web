import { describe, it, expect, vi, afterEach } from 'vitest';

// The module resolves its exports at import time from Capacitor platform
// checks, so each case mocks those and re-imports.
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
  it('consumes only the Capacitor-injected var with a 0.5rem floor, never env()', async () => {
    const { safeAreaTop, safeAreaBottom } = await loadOnAndroidWebView(150);
    expect(safeAreaTop).toBe('max(var(--safe-area-inset-top, 0px), 0.5rem)');
    expect(safeAreaBottom).toBe('max(var(--safe-area-inset-bottom, 0px), 0.5rem)');
  });

  it('is independent of the WebView version (env() misreports on both old and new)', async () => {
    const oldWebView = await loadOnAndroidWebView(139);
    const newWebView = await loadOnAndroidWebView(150);
    expect(oldWebView.safeAreaTop).toBe(newWebView.safeAreaTop);
    expect(oldWebView.safeAreaBottom).toBe(newWebView.safeAreaBottom);
  });
});
