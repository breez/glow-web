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

describe('buildConnectConfig', () => {
  it('connects with private mode enabled by default', async () => {
    vi.stubEnv('VITE_BREEZ_API_KEY', 'test-key');
    const { buildConnectConfig } = await import('../hooks/buildConnectConfig');
    expect(buildConnectConfig('mainnet').privateEnabledDefault).toBe(true);
    vi.unstubAllEnvs();
  });
});
