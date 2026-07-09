/**
 * Full-screen app lock overlay (native only). PIN pad with an optional
 * biometric path: when the biometric gate is on, the OS prompt fires
 * once automatically and stays retriable from the pad's fingerprint
 * button. PIN always works as fallback. Hardware back is absorbed so
 * Android can't pop the lock.
 */

import React, { useCallback, useEffect } from 'react';
import { PinEntry } from './PinEntry';
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

  const tryBiometric = useCallback(async () => {
    try {
      await unlockWithBiometric();
    } catch {
      // Cancelled or unavailable: the PIN pad remains.
    }
  }, [unlockWithBiometric]);

  useEffect(() => {
    if (biometricGate && !suppressAutoBiometric) void tryBiometric();
  }, [biometricGate, suppressAutoBiometric, tryBiometric]);

  return (
    <div className="fixed inset-0 z-[100] bg-spark-surface flex flex-col">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-8">
          <div className="flex flex-col items-center gap-4">
            <img src="/assets/Glow_Logo.svg" alt="Glow" className="w-24 h-24" />
            <p className="text-sm text-spark-text-secondary">Enter your PIN to unlock</p>
          </div>
          <PinEntry
            onSubmit={async (pin) => ((await unlockWithPin(pin)) ? null : 'Incorrect PIN')}
            onBiometric={biometricGate ? () => { void tryBiometric(); } : undefined}
          />
        </div>
      </div>
    </div>
  );
};

export default LockScreen;
