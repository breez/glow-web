import { describe, it, expect, vi } from 'vitest';
import { ensureSparkPrivateMode } from './settings';

function makeSdk(sparkPrivateModeEnabled: boolean, failUpdate = false) {
  const updates: { sparkPrivateModeEnabled: boolean }[] = [];
  return {
    updates,
    getUserSettings: async () => ({ sparkPrivateModeEnabled }),
    updateUserSettings: async (request: { sparkPrivateModeEnabled: boolean }) => {
      updates.push(request);
      if (failUpdate) throw new Error('offline');
    },
  };
}

describe('ensureSparkPrivateMode', () => {
  it('turns private mode on when the wallet has it off', async () => {
    const sdk = makeSdk(false);
    await ensureSparkPrivateMode(sdk);
    expect(sdk.updates).toEqual([{ sparkPrivateModeEnabled: true }]);
  });

  it('keeps private mode on when the user turns it off out of band', async () => {
    const sdk = makeSdk(false);
    await ensureSparkPrivateMode(sdk);
    await ensureSparkPrivateMode(sdk);
    expect(sdk.updates).toHaveLength(2);
  });

  it('writes nothing when private mode is already on', async () => {
    const sdk = makeSdk(true);
    await ensureSparkPrivateMode(sdk);
    expect(sdk.updates).toEqual([]);
  });

  it('rejects when the SDK call fails, so the caller can log it', async () => {
    const sdk = makeSdk(false, true);
    await expect(ensureSparkPrivateMode(sdk)).rejects.toThrow('offline');
  });
});

describe('dev mode', () => {
  // The URL flag is read once at module load, so each "page load" is a
  // module reset with a fresh URL. localStorage survives, as on a device.
  async function load(search = '') {
    vi.resetModules();
    window.history.replaceState({}, '', `/${search}`);
    return import('./settings');
  }

  it('a ?dev=true link lasts for the page load only; the toggle persists', async () => {
    localStorage.clear();

    const linked = await load('?dev=true');
    expect(linked.isDevMode()).toBe(true);
    expect(localStorage.getItem('spark-dev-mode')).toBeNull();

    const plain = await load();
    expect(plain.isDevMode()).toBe(false);

    plain.setDevMode(true);
    expect((await load()).isDevMode()).toBe(true);
  });
});

describe('buildConnectConfig', () => {
  it('connects with private mode enabled by default', async () => {
    vi.stubEnv('VITE_BREEZ_API_KEY', 'test-key');
    const { buildConnectConfig } = await import('../hooks/buildConnectConfig');
    expect(buildConnectConfig('mainnet').privateEnabledDefault).toBe(true);
    vi.unstubAllEnvs();
  });
});
