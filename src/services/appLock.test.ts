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
  localStorage.clear();
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
    expect((await appLock.verifyPin('123456')).ok).toBe(true);
    expect((await appLock.verifyPin('654321')).ok).toBe(false);
  });

  it('stores a salted hash, never the PIN, with a fresh salt per set', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    const firstValues = [...appLock.store.values()];
    expect(firstValues).not.toContain('123456');
    await appLock.setPin('123456');
    // Same PIN, rotated salt => different stored hash.
    expect([...appLock.store.values()].sort()).not.toEqual(firstValues.sort());
    expect((await appLock.verifyPin('123456')).ok).toBe(true);
  });

  it('mirrors the enabled flag for synchronous lock gating', async () => {
    const appLock = await loadAppLock(true);
    expect(appLock.isPinEnabledSync()).toBe(false);
    await appLock.setPin('123456');
    expect(appLock.isPinEnabledSync()).toBe(true);
    await appLock.clearPin();
    expect(appLock.isPinEnabledSync()).toBe(false);
  });

  it('clearPin disables the PIN and the biometric gate with it', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    await appLock.setBiometricGateEnabled(true);
    expect(await appLock.isBiometricGateEnabled()).toBe(true);
    await appLock.clearPin();
    expect(await appLock.isPinEnabled()).toBe(false);
    expect(await appLock.isBiometricGateEnabled()).toBe(false);
    expect((await appLock.verifyPin('123456')).ok).toBe(false);
  });

  it('mirrors the biometric gate flag for synchronous reads', async () => {
    const appLock = await loadAppLock(true);
    expect(appLock.isBiometricGateEnabledSync()).toBe(false);
    await appLock.setBiometricGateEnabled(true);
    expect(appLock.isBiometricGateEnabledSync()).toBe(true);
    await appLock.setBiometricGateEnabled(false);
    expect(appLock.isBiometricGateEnabledSync()).toBe(false);
    await appLock.setBiometricGateEnabled(true);
    await appLock.clearPin();
    expect(appLock.isBiometricGateEnabledSync()).toBe(false);
  });
});

describe('appLock failed-attempt backoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks out after the free attempts and clears on the correct PIN', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');

    // Five free tries: rejected, but nothing to wait for yet.
    for (let i = 0; i < 5; i++) {
      expect(await appLock.verifyPin('000000')).toMatchObject({ ok: false, lockedForMs: 0 });
    }

    vi.useFakeTimers();
    expect((await appLock.verifyPin('000000')).lockedForMs).toBe(30_000);

    // The wait covers every attempt, a correct PIN included: one that
    // only applied to wrong entries would not bound the rate.
    expect((await appLock.verifyPin('123456')).ok).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect((await appLock.verifyPin('123456')).ok).toBe(true);

    // Success resets the counter, so the next failure is free again.
    expect((await appLock.verifyPin('000000')).lockedForMs).toBe(0);
  });

  it('caps a backwards clock at the longest scheduled wait', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    vi.useFakeTimers();
    for (let i = 0; i < 6; i++) await appLock.verifyPin('000000');
    // Device clock pushed a year back: still a bounded wait, not a brick.
    vi.setSystemTime(Date.now() - 365 * 24 * 3600_000);
    expect((await appLock.verifyPin('123456')).lockedForMs).toBe(3600_000);
  });
});

describe('appLock auto-lock timeout', () => {
  it('defaults to 120s and roundtrips a chosen value, mirror included', async () => {
    const appLock = await loadAppLock(true);
    expect(await appLock.getAutoLockSeconds()).toBe(120);
    expect(appLock.getAutoLockSecondsSync()).toBe(120);
    await appLock.setAutoLockSeconds(600);
    expect(await appLock.getAutoLockSeconds()).toBe(600);
    expect(appLock.getAutoLockSecondsSync()).toBe(600);
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
