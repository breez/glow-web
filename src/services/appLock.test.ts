import { describe, it, expect, vi, afterEach } from 'vitest';

// appLock guards on Capacitor.isNativePlatform() at import-call time, so
// each case mocks the platform + an in-memory Preferences and re-imports.
function makePreferencesMock() {
  const store = new Map<string, string>();
  return {
    store,
    Preferences: {
      get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
      remove: async ({ key }: { key: string }) => { store.delete(key); },
    },
  };
}

async function loadAppLock(native: boolean) {
  vi.resetModules();
  vi.doMock('@capacitor/core', () => ({
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => (native ? 'android' : 'web'),
    },
  }));
  const prefs = makePreferencesMock();
  vi.doMock('@capacitor/preferences', () => ({ Preferences: prefs.Preferences }));
  const mod = await import('./appLock');
  return { ...mod, store: prefs.store };
}

afterEach(() => {
  vi.doUnmock('@capacitor/core');
  vi.doUnmock('@capacitor/preferences');
});

describe('appLock PIN', () => {
  it('set/verify roundtrip, wrong PIN rejected', async () => {
    const appLock = await loadAppLock(true);
    expect(await appLock.isPinEnabled()).toBe(false);
    await appLock.setPin('123456');
    expect(await appLock.isPinEnabled()).toBe(true);
    expect(await appLock.verifyPin('123456')).toBe(true);
    expect(await appLock.verifyPin('654321')).toBe(false);
  });

  it('stores a salted hash, never the PIN, with a fresh salt per set', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    const firstValues = [...appLock.store.values()];
    expect(firstValues).not.toContain('123456');
    await appLock.setPin('123456');
    // Same PIN, rotated salt => different stored hash.
    expect([...appLock.store.values()].sort()).not.toEqual(firstValues.sort());
    expect(await appLock.verifyPin('123456')).toBe(true);
  });

  it('clearPin disables the PIN and the biometric gate with it', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    await appLock.setBiometricGateEnabled(true);
    expect(await appLock.isBiometricGateEnabled()).toBe(true);
    await appLock.clearPin();
    expect(await appLock.isPinEnabled()).toBe(false);
    expect(await appLock.isBiometricGateEnabled()).toBe(false);
    expect(await appLock.verifyPin('123456')).toBe(false);
  });
});

describe('appLock auto-lock timeout', () => {
  it('defaults to 120s and roundtrips a chosen value', async () => {
    const appLock = await loadAppLock(true);
    expect(await appLock.getAutoLockSeconds()).toBe(120);
    await appLock.setAutoLockSeconds(600);
    expect(await appLock.getAutoLockSeconds()).toBe(600);
  });

  it('formats every dropdown option', async () => {
    const appLock = await loadAppLock(true);
    const labels = appLock.AUTO_LOCK_OPTIONS_SECONDS.map(appLock.formatAutoLockOption);
    expect(labels).toEqual([
      'Immediately', '30 seconds', '2 minutes', '5 minutes',
      '10 minutes', '30 minutes', '1 hour',
    ]);
  });
});

describe('appLock on web', () => {
  it('reports unsupported and disabled everywhere', async () => {
    const appLock = await loadAppLock(false);
    expect(appLock.isAppLockSupported()).toBe(false);
    expect(await appLock.isPinEnabled()).toBe(false);
    expect(await appLock.isBiometricGateEnabled()).toBe(false);
  });
});
