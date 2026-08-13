/**
 * App-lock lifecycle (native only). Locked when a PIN is set and the
 * app cold-starts, returns from the background past the auto-lock
 * timeout (0 = lock the moment it backgrounds), or sits idle in the
 * foreground for that same timeout. Lock decisions use the synchronous
 * appLock mirrors so no unlocked frame renders while a bridge read is
 * in flight; the mount effect reconciles against the durable
 * Preferences truth.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearPin,
  getAutoLockSeconds,
  getAutoLockSecondsSync,
  isAppLockSupported,
  isBiometricGateEnabled,
  isBiometricGateEnabledSync,
  isPinEnabled,
  isPinEnabledSync,
  verifyPin,
} from '@/services/appLock';
import type { PinVerifyResult } from '@/services/appLock';
import {
  deviceOnlyStorage,
  secureStorage,
  tryAuthenticateBiometric,
} from '@/services/secureStorage';
import { isPasskeyMode } from '@/services/passkeyService';
import { logger, LogCategory } from '@/services/logger';

export interface AppLockState {
  locked: boolean;
  /** True when the biometric gate is on: the lock screen auto-fires the
   *  OS prompt and offers a retry button; PIN stays as fallback. */
  biometricGate: boolean;
  /** Rate-limited: a rejected result carries the remaining backoff. */
  unlockWithPin: (pin: string) => Promise<PinVerifyResult>;
  /** Never rejects: cancel / unavailable leaves the lock in place and
   *  the PIN pad as fallback. */
  unlockWithBiometric: () => Promise<void>;
  /** Drop the lock without verifying anything. Only for the forgotten-PIN
   *  escape, which erases the account the PIN was protecting: clearing the
   *  PIN alone would leave this overlay mounted with nothing behind it. */
  unlockAfterWipe: () => void;
}

export function useAppLock(): AppLockState {
  // Synchronous first-render decision: a PIN user never paints an
  // unlocked wallet frame on cold start.
  const [locked, setLocked] = useState(() => isPinEnabledSync());
  // Sync-seeded like `locked`: the lock screen must know at first paint
  // whether to hold the PIN pad back for the biometric auto-prompt.
  const [biometricGate, setBiometricGate] = useState(() => isBiometricGateEnabledSync());
  const hiddenAtRef = useRef<number | null>(null);

  // Reconcile the mirror against Preferences, load the gate flag, and
  // drop a PIN that outlived its wallet (vault wiped by KEY_INVALIDATED
  // or restore to a new device where Preferences survived but the
  // Keychain entry didn't): a lock over onboarding would have no
  // escape hatch, protecting nothing.
  useEffect(() => {
    if (!isAppLockSupported()) return;
    let cancelled = false;
    void (async () => {
      const [pin, gate] = await Promise.all([
        isPinEnabled(),
        isBiometricGateEnabled(),
        // Read through to heal a stale or evicted auto-lock mirror
        // before the idle timer arms against it.
        getAutoLockSeconds(),
      ]);
      if (cancelled) return;
      if (!pin) {
        setLocked(false);
        return;
      }
      const [deviceSeed, legacySeed] = await Promise.all([
        deviceOnlyStorage.hasStoredSeed().catch(() => false),
        secureStorage.hasStoredSeed().catch(() => false),
      ]);
      if (cancelled) return;
      const hasWallet =
        deviceSeed || legacySeed || isPasskeyMode() || localStorage.getItem('walletMnemonic') != null;
      if (!hasWallet) {
        logger.warn(LogCategory.AUTH, 'appLock: clearing PIN with no wallet behind it');
        await clearPin().catch(() => undefined);
        if (!cancelled) setLocked(false);
        return;
      }
      setBiometricGate(gate);
      setLocked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Backgrounding signal: visibilitychange 'hidden', NOT @capacitor/app's
  // appStateChange. On iOS the latter fires on willResignActive, which
  // the Face ID sheet itself triggers, so with timeout 0 every OS prompt
  // would relock the app the moment it closes. 'hidden' fires only on
  // real backgrounding (iOS didEnterBackground / Android activity stop).
  useEffect(() => {
    if (!isAppLockSupported()) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!isPinEnabledSync()) return;
        if (getAutoLockSecondsSync() === 0) {
          // 'Immediately' locks at background time so the OS
          // task-switcher snapshot captures the lock screen, not the
          // wallet.
          setLocked(true);
          setBiometricGate(isBiometricGateEnabledSync());
        } else {
          hiddenAtRef.current = Date.now();
        }
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt == null || !isPinEnabledSync()) return;
      // Synchronous mirror reads: the lock commits before the resumed
      // wallet frame can paint.
      if (Date.now() - hiddenAt >= getAutoLockSecondsSync() * 1000) {
        setLocked(true);
        void isBiometricGateEnabled().then(setBiometricGate);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Foreground idle: the visibility handler above only covers
  // backgrounding, so the timeout needs a second trigger to apply while
  // Glow stays open. Any pointer or key activity restarts the
  // countdown, so this only fires on real inactivity.
  useEffect(() => {
    if (!isAppLockSupported() || locked) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (!isPinEnabledSync()) return;
      // 'Immediately' (0) is a rule about backgrounding. Read as an idle
      // timeout it would lock the screen the user is looking at, so it
      // takes the shortest real option instead.
      const seconds = getAutoLockSecondsSync() || 30;
      timer = setTimeout(() => {
        setLocked(true);
        setBiometricGate(isBiometricGateEnabledSync());
      }, seconds * 1000);
    };
    arm();
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((event) => document.addEventListener(event, arm, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((event) => document.removeEventListener(event, arm));
    };
  }, [locked]);

  const unlockWithPin = useCallback(async (pin: string) => {
    const result = await verifyPin(pin);
    if (result.ok) setLocked(false);
    return result;
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    if (await tryAuthenticateBiometric('Unlock Glow')) setLocked(false);
  }, []);

  const unlockAfterWipe = useCallback(() => setLocked(false), []);

  return { locked, biometricGate, unlockWithPin, unlockWithBiometric, unlockAfterWipe };
}
