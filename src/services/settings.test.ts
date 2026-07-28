import { describe, it, expect, vi, beforeEach } from 'vitest';

// settings.ts caches localStorage reads in a module-level Map, so each case
// re-imports to start from an empty cache as well as empty storage.
async function loadSettings() {
  vi.resetModules();
  localStorage.clear();
  return import('./settings');
}

function makeSdk(fail = false) {
  const calls: { sparkPrivateModeEnabled: boolean }[] = [];
  return {
    calls,
    updateUserSettings: async (request: { sparkPrivateModeEnabled: boolean }) => {
      calls.push(request);
      if (fail) throw new Error('offline');
    },
  };
}

describe('ensureSparkPrivateMode', () => {
  let settings: Awaited<ReturnType<typeof loadSettings>>;

  beforeEach(async () => {
    settings = await loadSettings();
  });

  it('enables private mode for a wallet that has never been forced', async () => {
    const sdk = makeSdk();
    await settings.ensureSparkPrivateMode(sdk, 'pubkey-a');
    expect(sdk.calls).toEqual([{ sparkPrivateModeEnabled: true }]);
  });

  it('does not force again on a later connect, so an opt-out sticks', async () => {
    const sdk = makeSdk();
    await settings.ensureSparkPrivateMode(sdk, 'pubkey-a');
    await settings.ensureSparkPrivateMode(sdk, 'pubkey-a');
    expect(sdk.calls).toHaveLength(1);
  });

  it('forces each wallet on the device separately', async () => {
    const sdk = makeSdk();
    await settings.ensureSparkPrivateMode(sdk, 'pubkey-a');
    await settings.ensureSparkPrivateMode(sdk, 'pubkey-b');
    expect(sdk.calls).toHaveLength(2);
  });

  it('leaves no marker when the SDK call fails, so the next connect retries', async () => {
    const failing = makeSdk(true);
    await expect(settings.ensureSparkPrivateMode(failing, 'pubkey-a')).rejects.toThrow('offline');

    const sdk = makeSdk();
    await settings.ensureSparkPrivateMode(sdk, 'pubkey-a');
    expect(sdk.calls).toEqual([{ sparkPrivateModeEnabled: true }]);
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
