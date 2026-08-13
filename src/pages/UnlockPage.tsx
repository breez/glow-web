/**
 * UnlockPage — interactive retry screen shown when the auto-triggered
 * biometric unlock was cancelled or hit the biometric lockout error.
 *
 * The cold-launch "authenticating now, please wait" surface is a
 * separate component (`UnlockingPage`) so that this page stays purely
 * interactive and the placeholder stays purely decorative.
 *
 * Presents a primary "Unlock with <biometry>" action and a secondary
 * "Erase and start over" escape that clears the stored seed and routes
 * back to welcome. A plain connect failure also lands here, so that
 * escape is gated on a confirm plus a device-owner prompt: it is
 * destructive and one tap away from a user who is only offline.
 *
 * Layout mirrors `feat/password-encrypted-seed-storage`'s UnlockPage so
 * that when both native secure storage and the password vault coexist
 * on the same codebase, they share a visual language.
 */

import React, { useEffect, useState } from 'react';
import { PrimaryButton, SecondaryButton, ConfirmDialog } from '../components/ui';
import { FaceIdIcon, FingerprintIcon, PasskeyIcon } from '../components/Icons';
import { AlertCard } from '../components/AlertCard';
import { confirmDeviceOwner, getBiometryInfo, BiometryInfo, secureStorage } from '../services/secureStorage';
import { isPasskeyMode } from '../services/passkeyService';

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
  // This escape erases every local artifact, and the screen it lives on is
  // reachable from a plain connect failure (offline launch), so it is gated
  // behind the same confirm the side-menu logout uses.
  const [showEraseConfirm, setShowEraseConfirm] = useState(false);
  const isPasskey = isPasskeyMode();
  // Only pre-app-lock installs keep the seed behind a biometric. With
  // nothing in that tier this page is a plain reconnect retry (the
  // silent start failed), so it must not promise a Face ID prompt.
  const [isBiometricTier, setIsBiometricTier] = useState(true);

  useEffect(() => {
    if (isWebPasskey) return;
    let cancelled = false;
    getBiometryInfo().then((info) => {
      if (!cancelled) setBiometry(info);
    });
    secureStorage.hasStoredSeed().then((stored) => {
      if (!cancelled) setIsBiometricTier(stored);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isWebPasskey]);

  const unlockLabel = isWebPasskey
    ? 'Unlock with passkey'
    : !isBiometricTier ? 'Try Again'
      : biometry ? `Unlock with ${biometry.label}` : 'Unlock';
  const unlockDescription = isWebPasskey
    ? 'Glow is locked. Unlock with your passkey to continue.'
    : !isBiometricTier ? 'Glow could not start up. Please try again.'
      : 'Glow is locked. Unlock with your biometric to continue.';
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
            <AlertCard variant="error" title={isBiometricTier ? 'Unlock failed' : 'Could not start'}>
              {error}
            </AlertCard>
          )}

          <div className="space-y-3">
            <PrimaryButton
              onClick={onUnlock}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2"
            >
              {isBiometricTier && <UnlockIcon size="md" />}
              {unlockLabel}
            </PrimaryButton>

            <SecondaryButton
              onClick={() => setShowEraseConfirm(true)}
              disabled={isLoading}
              className="w-full"
            >
              Erase and Start Over
            </SecondaryButton>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showEraseConfirm}
        variant="danger"
        title="Erase and start over"
        message={isPasskey
          ? "This deletes all Glow data stored on this device. You'll need your passkey to access your funds again."
          : "This deletes all Glow data stored on this device. Make sure you've saved your recovery phrase: you'll need it to access your funds again."}
        confirmLabel="Erase"
        // Device-owner prompt on top of the confirm, as on the lock
        // screen. The dialog stays up on a cancelled prompt.
        onConfirm={() => {
          void confirmDeviceOwner('Erase all Glow data').then((confirmed) => {
            if (!confirmed) return;
            setShowEraseConfirm(false);
            void onAbandon();
          });
        }}
        onCancel={() => setShowEraseConfirm(false)}
      />
    </div>
  );
};

export default UnlockPage;
