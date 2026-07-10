/**
 * Full-screen app lock overlay (native only). PIN pad with an optional
 * biometric path: when the biometric gate is on, the OS prompt fires
 * once automatically and stays retriable from the pad's fingerprint
 * button. PIN always works as fallback. Hardware back is absorbed so
 * Android can't pop the lock.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { PinEntry, PinScreenLayout } from './PinEntry';
import { getBiometryInfo, BiometryKind } from '../services/secureStorage';
import { useBackButton } from '../hooks/useBackButton';

interface LockScreenProps {
  biometricGate: boolean;
  /** True while another OS auth ceremony is in flight underneath (the
   *  legacy vault unlock): concurrent BiometricPrompt calls cancel each
   *  other on Android, so the auto-fire waits until it clears. */
  suppressAutoBiometric?: boolean;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<void>;
}

const LockScreen: React.FC<LockScreenProps> = ({
  biometricGate,
  suppressAutoBiometric = false,
  unlockWithPin,
  unlockWithBiometric,
}) => {
  useBackButton(useCallback(() => true, []), true);

  // With the biometric gate on, the pad stays hidden until the OS
  // prompt settles: it only appears when the user cancels or biometrics
  // are unavailable, so the happy path is Face ID over a bare logo, not
  // over a PIN pad.
  const [padVisible, setPadVisible] = useState(!biometricGate);

  // Face vs fingerprint icon for the pad's biometric slot.
  const [biometryKind, setBiometryKind] = useState<BiometryKind | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void getBiometryInfo().then((info) => {
      if (!cancelled && info) setBiometryKind(info.kind);
    });
    return () => { cancelled = true; };
  }, []);

  const tryBiometric = useCallback(async () => {
    // Never rejects. If we're still mounted afterwards the attempt
    // didn't unlock (cancel / lockout / unavailable): reveal the pad.
    await unlockWithBiometric();
    setPadVisible(true);
  }, [unlockWithBiometric]);

  useEffect(() => {
    if (!biometricGate) setPadVisible(true);
    else if (!suppressAutoBiometric) void tryBiometric();
  }, [biometricGate, suppressAutoBiometric, tryBiometric]);

  return (
    // z above .toast-container (99999): the lock must cover toasts too,
    // both to keep the PIN screen clean and because a payment-received
    // toast over the lock would leak amounts on a locked device.
    <div className="fixed inset-0 z-[100000] bg-spark-surface flex flex-col">
      {padVisible ? (
        // Safe-area insets live on this branch only: the pad anchors to
        // the screen edges (1/3 / 2/3 split), while the pending branch
        // below must center in the FULL screen like the splash does.
        // The extra 2.5rem (the old py-10) keeps the pad clear of the
        // bottom safe area; overflow scrolls on short screens.
        <div
          className="flex-1 flex flex-col px-4 max-w-sm w-full mx-auto overflow-y-auto"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 2.5rem)',
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 2.5rem)',
          }}
        >
          <PinScreenLayout
            prompt={
              <p className="text-sm text-spark-text-secondary">Enter your PIN to unlock</p>
            }
          >
            <PinEntry
              onSubmit={async (pin) => ((await unlockWithPin(pin)) ? null : 'Incorrect PIN')}
              // Gate flag AND live availability, so a Face ID outage
              // (denied / locked out) never leaves a dead button.
              onBiometric={biometricGate && biometryKind ? () => { void tryBiometric(); } : undefined}
              biometryKind={biometryKind}
            />
          </PinScreenLayout>
        </div>
      ) : (
        // Biometric pending: replicate the splash exactly (33.6vw,
        // measured from the native splash asset — see index.html's
        // .splash-logo) so cold start -> Face ID reads as one
        // continuous frame, no logo resize or jump.
        <div className="flex-1 flex items-center justify-center">
          <img src="/assets/Glow_Logo.svg" alt="Glow" className="w-[33.6vw] max-w-48" />
        </div>
      )}
    </div>
  );
};

export default LockScreen;
