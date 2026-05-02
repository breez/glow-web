/**
 * UnlockPage — interactive retry screen shown when the auto-triggered
 * biometric unlock was cancelled or hit the biometric lockout error.
 *
 * The cold-launch "authenticating now, please wait" surface is a
 * separate component (`UnlockingPage`) so that this page stays purely
 * interactive and the placeholder stays purely decorative.
 *
 * Presents a primary "Unlock with <biometry>" action and a secondary
 * "Use a different wallet" escape that clears the stored seed and
 * routes back to welcome.
 *
 * Layout mirrors `feat/password-encrypted-seed-storage`'s UnlockPage so
 * that when both native secure storage and the password vault coexist
 * on the same codebase, they share a visual language.
 */

import React, { useEffect, useState } from 'react';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { FingerprintIcon } from '../components/Icons';
import { AlertCard } from '../components/AlertCard';
import { getBiometryLabel } from '../services/secureStorage';

interface UnlockPageProps {
  isLoading: boolean;
  error: string | null;
  onUnlock: () => Promise<void>;
  onAbandon: () => Promise<void>;
}

const UnlockPage: React.FC<UnlockPageProps> = ({
  isLoading,
  error,
  onUnlock,
  onAbandon,
}) => {
  const [biometryLabel, setBiometryLabel] = useState<string | null>(null);

  // Resolve the biometry type at mount so the button label can be specific
  // ("Unlock with Face ID" etc). Falls back to the generic "Unlock" if the
  // lookup fails or returns null.
  useEffect(() => {
    let cancelled = false;
    getBiometryLabel().then((label) => {
      if (!cancelled) setBiometryLabel(label);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const unlockLabel = biometryLabel ? `Unlock with ${biometryLabel}` : 'Unlock';

  return (
    <div className="min-h-dvh h-dvh w-full flex flex-col bg-spark-surface relative">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-8">
          {/* Logo + headline */}
          <div className="flex flex-col items-center gap-4">
            <img
              src="/assets/Glow_Logo.svg"
              alt="Glow"
              className="w-36 h-36"
            />
            <h1 className="font-display text-2xl font-bold text-spark-text-primary">
              Welcome back
            </h1>
            <p className="text-sm text-spark-text-secondary text-center">
              Your wallet is locked. Unlock with your biometric to continue.
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <AlertCard variant="error" title="Unlock failed">
              {error}
            </AlertCard>
          )}

          <div className="space-y-3">
            <PrimaryButton
              onClick={onUnlock}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2"
            >
              <FingerprintIcon size="md" />
              {unlockLabel}
            </PrimaryButton>

            <SecondaryButton
              onClick={onAbandon}
              disabled={isLoading}
              className="w-full"
            >
              Use a different wallet
            </SecondaryButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnlockPage;
