/**
 * Regression guard for the fresh-install marker invariant.
 *
 * The markers gate a vault wipe: a missing marker means "reinstall", and
 * the init pass then clears both tiers. Logout wipes localStorage AND
 * Preferences, which takes the markers with it, so anything that stores a
 * seed afterwards must leave a marker beside it. Otherwise the NEXT cold
 * start reads a funded vault as a fresh install and deletes it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import { wipeAllLocalData } from './accountDeletion';

const INSTALL_MARKER_KEY = 'glow.secureStorageInitialized';

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => true },
  };
});

/** Stands in for the Keychain / Keystore: survives module resets, like the
 *  real vault survives a process restart. */
const vault: { deviceOnly: string | null; bound: string | null } = {
  deviceOnly: null,
  bound: null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = globalThis;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Capacitor = {
  Plugins: {
    NativeVault: {
      hasStoredSeedDeviceOnly: async () => ({ stored: vault.deviceOnly !== null }),
      storeSeedDeviceOnly: async ({ seed }: { seed: string }) => { vault.deviceOnly = seed; },
      retrieveSeedDeviceOnly: async () => ({ seed: vault.deviceOnly! }),
      clearSeedDeviceOnly: async () => { vault.deviceOnly = null; },
      hasStoredSeed: async () => ({ stored: vault.bound !== null }),
      storeSeed: async ({ seed }: { seed: string }) => { vault.bound = seed; },
      retrieveSeed: async () => ({ seed: vault.bound! }),
      clearSeed: async () => { vault.bound = null; },
    },
  },
};

/** Re-import with a clean module registry: the init memo is module-level,
 *  so this is what a cold start looks like. */
async function coldStart() {
  vi.resetModules();
  return import('./secureStorage');
}

const SEED = { type: 'mnemonic', mnemonic: 'abandon ability able about' } as const;

describe('secure storage install marker', () => {
  beforeEach(async () => {
    vault.deviceOnly = null;
    vault.bound = null;
    localStorage.clear();
    await Preferences.clear();
  });

  it('writes the marker when a seed is stored', async () => {
    const { deviceOnlyStorage } = await coldStart();
    await deviceOnlyStorage.storeSeed(SEED);

    expect((await Preferences.get({ key: INSTALL_MARKER_KEY })).value).not.toBeNull();
    expect(vault.deviceOnly).not.toBeNull();
  });

  it('keeps the seed across a cold start once the marker is set', async () => {
    const first = await coldStart();
    await first.deviceOnlyStorage.storeSeed(SEED);

    const second = await coldStart();
    expect(await second.deviceOnlyStorage.hasStoredSeed()).toBe(true);
    expect(vault.deviceOnly).not.toBeNull();
  });

  it('wipes a vault whose marker is missing (the fresh-install path still works)', async () => {
    const first = await coldStart();
    await first.deviceOnlyStorage.storeSeed(SEED);

    // Exactly what a logout wipe leaves behind: seed in the vault, no marker.
    localStorage.clear();
    await Preferences.clear();

    const second = await coldStart();
    expect(await second.deviceOnlyStorage.hasStoredSeed()).toBe(false);
  });

  it('re-marks a seed stored after a logout wipe, so the next cold start keeps it', async () => {
    const session = await coldStart();
    await session.deviceOnlyStorage.storeSeed(SEED);

    // Logout: erases the vault and every local store, markers included.
    await session.deviceOnlyStorage.clearSeed();
    await wipeAllLocalData();
    session.resetSecureStorageInit();

    // Re-onboard in the SAME session, no app restart.
    await session.deviceOnlyStorage.storeSeed(SEED);
    expect((await Preferences.get({ key: INSTALL_MARKER_KEY })).value).not.toBeNull();

    // The account must survive the next launch.
    const relaunch = await coldStart();
    expect(await relaunch.deviceOnlyStorage.hasStoredSeed()).toBe(true);
  });
});
