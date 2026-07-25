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
import { FaceIdIcon, FingerprintIcon, PasskeyIcon } from '../components/Icons';
import { AlertCard } from '../components/AlertCard';
import { getBiometryInfo, BiometryInfo, secureStorage } from '../services/secureStorage';

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
  // Web hosts use passkey terminology; native uses biometric.
  const isWebPasskey = !secureStorage.isSupported();

  const [biometry, setBiometry] = useState<BiometryInfo | null>(null);

  useEffect(() => {
    if (isWebPasskey) return;
    let cancelled = false;
    getBiometryInfo().then((info) => {
      if (!cancelled) setBiometry(info);
    });
    return () => {
      cancelled = true;
    };
  }, [isWebPasskey]);

  const unlockLabel = isWebPasskey
    ? 'Unlock with passkey'
    : biometry ? `Unlock with ${biometry.label}` : 'Unlock';
  const unlockDescription = isWebPasskey
    ? 'Your wallet is locked. Unlock with your passkey to continue.'
    : 'Your wallet is locked. Unlock with your biometric to continue.';
  const UnlockIcon = isWebPasskey
    ? PasskeyIcon
    : biometry?.kind === 'face' ? FaceIdIcon : FingerprintIcon;

  return (
    <div className="min-h-dvh h-dvh w-full flex flex-col bg-spark-surface relative">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-8">
          {/* Logo + headline */}
          <div className="flex flex-col items-center gap-4">
            <img
              src="/assets/Glow_Logo.svg"
              alt="Glow"
              className="w-36 h-36 object-contain"
            />
            <h1 className="font-display text-2xl font-bold text-spark-text-primary">
              Welcome back
            </h1>
            <p className="text-sm text-spark-text-secondary text-center">
              {unlockDescription}
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
              <UnlockIcon size="md" />
              {unlockLabel}
            </PrimaryButton>

            <SecondaryButton
              onClick={onAbandon}
              disabled={isLoading}
              className="w-full"
            >
              Use a Different Wallet
            </SecondaryButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnlockPage;
