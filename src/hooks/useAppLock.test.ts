import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppLock } from './useAppLock';

// What the PIN mirror reports. The tests flip it the way the Security
// page does: just after the tap that arms the idle timer.
const pin = vi.hoisted(() => ({ on: false }));
vi.mock('@/services/appLock', () => ({
  isAppLockSupported: () => true,
  isPinEnabled: async () => pin.on,
  isPinEnabledSync: () => pin.on,
  getAutoLockSeconds: async () => 30,
  getAutoLockSecondsSync: () => 30,
  isBiometricGateEnabled: async () => false,
  isBiometricGateEnabledSync: () => false,
  isIdleLockSuppressed: () => false,
  clearPin: async () => {},
  verifyPin: async () => ({ ok: true, lockedForMs: 0 }),
}));
vi.mock('@/services/secureStorage', () => ({
  deviceOnlyStorage: { hasStoredSeed: async () => true },
  secureStorage: { hasStoredSeed: async () => false },
  tryAuthenticateBiometric: async () => false,
}));
vi.mock('@/services/passkeyService', () => ({ isPasskeyMode: () => false }));

beforeEach(() => {
  vi.useFakeTimers();
  pin.on = false;
});
afterEach(() => {
  vi.useRealTimers();
});

async function renderUnlocked() {
  const hook = renderHook(() => useAppLock());
  await act(async () => {}); // let the mount reconcile settle
  return hook;
}

const tap = () => act(() => { document.dispatchEvent(new Event('pointerdown')); });
const idle = () => act(() => { vi.advanceTimersByTime(30_000); });

it('does not idle-lock once the PIN is turned off', async () => {
  const { result } = await renderUnlocked();
  pin.on = true;
  tap(); // the Deactivate PIN switch
  pin.on = false;
  idle();
  expect(result.current.locked).toBe(false);
});

it('idle-locks when the PIN is turned on after the last tap', async () => {
  const { result } = await renderUnlocked();
  tap(); // the last digit of the new PIN
  pin.on = true;
  idle();
  expect(result.current.locked).toBe(true);
});
