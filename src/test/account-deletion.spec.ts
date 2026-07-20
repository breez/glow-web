import { describe, it, expect } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import { wipeAllLocalData } from '../services/accountDeletion';

describe('wipeAllLocalData', () => {
  it('clears localStorage and Capacitor Preferences', async () => {
    localStorage.setItem('walletMnemonic', 'abandon ability able');
    localStorage.setItem('passkeyLabel', 'my-label');
    localStorage.setItem('user_settings_v1', '{}');
    await Preferences.set({ key: 'glow.appLock.autoLockSeconds', value: '60' });
    await Preferences.set({ key: 'stable_balance_active_ticker', value: 'USD' });

    await wipeAllLocalData();

    expect(localStorage.length).toBe(0);
    expect((await Preferences.keys()).keys).toEqual([]);
  });

  it('never throws even without indexedDB support', async () => {
    await expect(wipeAllLocalData()).resolves.toBeUndefined();
  });
});
