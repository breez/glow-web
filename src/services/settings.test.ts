import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('getSettings deposit claim fee', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('defaults to a flat 500 sat claim threshold', async () => {
    const { getSettings } = await import('./settings');
    expect(getSettings().depositMaxFee).toEqual({ type: 'fixed', amount: 500 });
  });

  it('keeps a saved threshold', async () => {
    const { getSettings, saveSettings } = await import('./settings');
    saveSettings({ depositMaxFee: { type: 'fixed', amount: 1200 } });
    expect(getSettings().depositMaxFee).toEqual({ type: 'fixed', amount: 1200 });
  });

  it('falls back to the default when the stored fee is malformed', async () => {
    localStorage.setItem('user_settings_v1', JSON.stringify({ depositMaxFee: { type: 'fixed' } }));
    const { getSettings } = await import('./settings');
    expect(getSettings().depositMaxFee).toEqual({ type: 'fixed', amount: 500 });
  });
});

describe('deposit claim limit helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('rejects input that cannot be a limit, so the caller keeps the stored one', async () => {
    const { buildDepositMaxFee } = await import('./settings');
    expect(buildDepositMaxFee('fixed', '')).toBeNull();
    expect(buildDepositMaxFee('fixed', 'abc')).toBeNull();
    expect(buildDepositMaxFee('fixed', '-1')).toBeNull();
  });

  it('builds each limit type in its own unit', async () => {
    const { buildDepositMaxFee } = await import('./settings');
    expect(buildDepositMaxFee('fixed', '500.7')).toEqual({ type: 'fixed', amount: 500 });
    // Every variant is a u64 in the SDK, so a typed fraction rounds down.
    expect(buildDepositMaxFee('rate', '1.5')).toEqual({ type: 'rate', satPerVbyte: 1 });
    expect(buildDepositMaxFee('networkRecommended', '2.5')).toEqual({ type: 'networkRecommended', leewaySatPerVbyte: 2 });
  });

  it('drafts the active limit, the last value used for the others, then the defaults', async () => {
    const { depositMaxFeeDrafts } = await import('./settings');
    expect(
      depositMaxFeeDrafts({
        depositMaxFee: { type: 'rate', satPerVbyte: 3 },
        depositMaxFeeByType: { fixed: 900 },
      }),
    ).toEqual({ fixed: '900', rate: '3', networkRecommended: '0' });
  });

  it('remembers a value per type across a save', async () => {
    const { getSettings, saveSettings } = await import('./settings');
    saveSettings({ depositMaxFee: { type: 'rate', satPerVbyte: 2 }, depositMaxFeeByType: { fixed: 900, rate: 2 } });
    expect(getSettings().depositMaxFeeByType).toEqual({ fixed: 900, rate: 2 });
  });

  it('drops remembered values that are not usable numbers', async () => {
    localStorage.setItem(
      'user_settings_v1',
      JSON.stringify({ depositMaxFee: { type: 'fixed', amount: 500 }, depositMaxFeeByType: { fixed: 'oops', rate: -2 } }),
    );
    const { getSettings } = await import('./settings');
    expect(getSettings().depositMaxFeeByType).toBeUndefined();
  });
});
