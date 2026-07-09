/**
 * App-lock lifecycle (native only). Locked when a PIN is set and either
 * the app cold-starts or returns to the foreground after sitting in the
 * background past the auto-lock timeout (0 = lock on any background).
 * Settings are re-read at each lifecycle event, never cached, so a PIN
 * created or deactivated mid-session takes effect immediately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  getAutoLockSeconds,
  isAppLockSupported,
  isBiometricGateEnabled,
  isPinEnabled,
  verifyPin,
} from '@/services/appLock';
import { authenticateBiometric } from '@/services/secureStorage';

export interface AppLockState {
  locked: boolean;
  /** True when the biometric gate is on: the lock screen auto-fires the
   *  OS prompt and offers a retry button; PIN stays as fallback. */
  biometricGate: boolean;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<void>;
}

export function useAppLock(): AppLockState {
  const [locked, setLocked] = useState(false);
  const [biometricGate, setBiometricGate] = useState(false);
  const backgroundedAtRef = useRef<number | null>(null);

  // Cold start: lock immediately when a PIN is set.
  useEffect(() => {
    if (!isAppLockSupported()) return;
    let cancelled = false;
    void (async () => {
      const [pin, gate] = await Promise.all([isPinEnabled(), isBiometricGateEnabled()]);
      if (cancelled) return;
      setBiometricGate(gate);
      if (pin) setLocked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Background/foreground: stamp on exit, compare on return.
  useEffect(() => {
    if (!isAppLockSupported()) return;
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        backgroundedAtRef.current = Date.now();
        return;
      }
      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (backgroundedAt == null) return;
      void (async () => {
        if (!(await isPinEnabled())) return;
        const [timeoutSeconds, gate] = await Promise.all([
          getAutoLockSeconds(),
          isBiometricGateEnabled(),
        ]);
        if (Date.now() - backgroundedAt >= timeoutSeconds * 1000) {
          setBiometricGate(gate);
          setLocked(true);
        }
      })();
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, []);

  const unlockWithPin = useCallback(async (pin: string) => {
    const ok = await verifyPin(pin);
    if (ok) setLocked(false);
    return ok;
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    await authenticateBiometric('Unlock Glow');
    setLocked(false);
  }, []);

  return { locked, biometricGate, unlockWithPin, unlockWithBiometric };
}
