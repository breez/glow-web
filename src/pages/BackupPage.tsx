import React, { useEffect, useState } from 'react';
import { WarningIcon, SpinnerIcon, EyeIcon, FingerprintIcon, PasskeyIcon } from '../components/Icons';
import SlideInPage from '../components/layout/SlideInPage';
import {
  isPasskeyMode,
  signInPinnedToActiveCredential,
} from '@/services/passkeyService';
import { deviceOnlyStorage, secureStorage, getBiometryLabel } from '@/services/secureStorage';
import { logger, LogCategory } from '@/services/logger';

interface BackupPageProps {
  onBack: () => void;
}

const BackupPage: React.FC<BackupPageProps> = ({ onBack }) => {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPasskey = isPasskeyMode();

  useEffect(() => {
    if (isPasskey) return;
    let cancelled = false;
    (async () => {
      if (deviceOnlyStorage.isSupported() && (await deviceOnlyStorage.hasStoredSeed())) {
        try {
          const seed = await deviceOnlyStorage.retrieveSeed();
          if (cancelled) return;
          if (seed.type === 'mnemonic') {
            setMnemonic(seed.mnemonic);
            return;
          }
        } catch (e) {
          logger.warn(LogCategory.AUTH, 'Failed to read mnemonic from device-only storage', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (cancelled) return;
      setMnemonic(localStorage.getItem('walletMnemonic'));
    })();
    return () => {
      cancelled = true;
    };
  }, [isPasskey]);

  // Tracks whether passkey-based reveal failed once, so we can offer a
  // secureStorage fallback button in the error UI. We don't try
  // secureStorage automatically: the happy path is "passkey is the
  // source of truth", and we want to honor that whenever it's
  // available. Auto-fallback would mask passkey deletion / corruption
  // from users who care about the distinction.
  const [passkeyAttemptFailed, setPasskeyAttemptFailed] = useState(false);

  // Resolved at mount: 'Face ID', 'Touch ID', 'fingerprint', etc.
  // Used to label the biometric fallback button so iOS users see
  // "Reveal with Face ID" while Android fingerprint users see
  // "Reveal with fingerprint", etc. Null on web or when no biometry
  // is enrolled; the button label degrades gracefully to "Reveal".
  const [biometryLabel, setBiometryLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBiometryLabel().then((label) => {
      if (!cancelled) setBiometryLabel(label);
    });
    return () => { cancelled = true; };
  }, []);

  const handleRevealPasskey = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Resolve the active label from the localStorage `passkeyLabel`
      // key so the SDK derives the right wallet for this device.
      const effectiveLabel = localStorage.getItem('passkeyLabel') ?? undefined;
      // Pinned to the active credential so Backup can only ever reveal the
      // recovery phrase for the currently logged-in passkey: an empty
      // allowCredentials would let the OS substitute a sibling cred and
      // derive a different wallet's seed.
      const response = await signInPinnedToActiveCredential(effectiveLabel);
      const w = response.wallet;
      if (w.seed.type === 'mnemonic' && w.seed.mnemonic) {
        setMnemonic(w.seed.mnemonic);
        setIsRevealed(true);
      } else {
        setError('Could not derive recovery phrase');
        setPasskeyAttemptFailed(true);
      }
    } catch (e) {
      logger.error(LogCategory.AUTH, 'Failed to derive mnemonic from passkey', {
        error: e instanceof Error ? e.message : String(e),
      });
      setError(e instanceof Error ? e.message : 'Failed to authenticate');
      setPasskeyAttemptFailed(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Fallback path: read the seed directly from biometric-bound
  // secureStorage. Only surfaced after the passkey path failed, so
  // users with intact passkeys never bypass the passkey ceremony.
  // Useful when the passkey was deleted from Settings -> Passwords:
  // the cached seed survives there and can be revealed via Face ID.
  const handleRevealWithBiometric = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!secureStorage.isSupported() || !(await secureStorage.hasStoredSeed())) {
        setError('No recovery phrase available on this device');
        return;
      }
      const seed = await secureStorage.retrieveSeed();
      if (seed.type === 'mnemonic' && seed.mnemonic) {
        setMnemonic(seed.mnemonic);
        setIsRevealed(true);
      } else {
        setError('Could not retrieve recovery phrase');
      }
    } catch (e) {
      logger.error(LogCategory.AUTH, 'Biometric fallback retrieveSeed failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      setError(e instanceof Error ? e.message : 'Failed to authenticate');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!mnemonic) return;
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      logger.warn(LogCategory.UI, 'Failed to copy mnemonic to clipboard', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleHide = () => {
    setIsRevealed(false);
    if (isPasskey) {
      setMnemonic(null);
      setPasskeyAttemptFailed(false);
      setError(null);
    }
  };

  const words = mnemonic ? mnemonic.split(' ') : [];

  return (
    <SlideInPage title="Backup" onClose={onBack} slideFrom="left">
      <div className="p-4">
        <div className="max-w-xl mx-auto w-full space-y-6">
          {/* Passkey info card */}
          {isPasskey && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-spark-primary/20 flex items-center justify-center shrink-0">
                  <PasskeyIcon size="md" className="text-spark-primary" />
                </div>
                <div>
                  <h4 className="font-medium text-spark-text-primary mb-1">Passkey Protected</h4>
                  <p className="text-spark-text-muted text-sm">
                    Your recovery phrase is derived from your passkey. To restore on another device, use your passkey or the recovery phrase below.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Reveal button (passkey mode, happy path). After a failed
              passkey attempt, the fallback card below replaces this
              one and folds the error + Face ID retry into one tile. */}
          {isPasskey && !isRevealed && !mnemonic && !passkeyAttemptFailed && (
            <button
              onClick={handleRevealPasskey}
              disabled={isLoading}
              className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors disabled:opacity-50"
            >
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
                {isLoading ? (
                  <SpinnerIcon size="xl" className="text-spark-primary" />
                ) : (
                  <EyeIcon size="xl" className="text-spark-primary" />
                )}
              </div>
              <span className="font-display font-semibold text-spark-text-primary">
                {isLoading ? 'Authenticating...' : 'Tap to reveal phrase'}
              </span>
              <span className="text-sm text-spark-text-muted">
                {isLoading ? 'Complete passkey authentication' : 'Requires passkey authentication'}
              </span>
            </button>
          )}

          {/* Reveal button (mnemonic mode) */}
          {!isPasskey && !isRevealed && mnemonic && (
            <button
              onClick={() => setIsRevealed(true)}
              className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors"
            >
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
                <EyeIcon size="xl" className="text-spark-primary" />
              </div>
              <span className="font-display font-semibold text-spark-text-primary">Tap to reveal phrase</span>
              <span className="text-sm text-spark-text-muted">Make sure no one is watching</span>
            </button>
          )}

          {/* Mnemonic-mode error: passkey-mode errors are now folded
              into the fallback card below, so this only renders for
              non-passkey edge cases. */}
          {error && !isPasskey && (
            <div className="bg-spark-error/10 border border-spark-error/30 rounded-xl p-4 text-center">
              <p className="text-spark-error text-sm">{error}</p>
            </div>
          )}

          {/* Biometric fallback (passkey only, native). Single card that
              replaces both the original reveal tile and the error
              banner once the passkey attempt has failed. Visually
              mirrors the happy-path tile: same title, swap the
              "Requires passkey authentication" subtitle for "Requires
              {biometric}". The label-driven biometric naming matches
              the convention used elsewhere (UnlockPage). */}
          {isPasskey && passkeyAttemptFailed && !isRevealed && !mnemonic && secureStorage.isSupported() && (
            <button
              onClick={handleRevealWithBiometric}
              disabled={isLoading}
              className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors disabled:opacity-50"
            >
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
                {isLoading ? (
                  <SpinnerIcon size="xl" className="text-spark-primary" />
                ) : (
                  <FingerprintIcon size="xl" className="text-spark-primary" />
                )}
              </div>
              <span className="font-display font-semibold text-spark-text-primary">
                {isLoading ? 'Authenticating...' : 'Tap to reveal phrase'}
              </span>
              <span className="text-sm text-spark-text-muted">
                {isLoading
                  ? `Complete ${biometryLabel ?? 'biometric'} authentication`
                  : `Requires ${biometryLabel ?? 'biometric authentication'}`}
              </span>
            </button>
          )}

          {/* Web fallback (passkey mode, no native secure storage). On
              web the seed is derived from the passkey PRF only: there
              is no device-bound copy to read with biometrics. If the
              passkey attempt failed, the recovery phrase cannot be
              retrieved here. Mirror the "No Backup Found" tile used
              for non-passkey mode so the user gets a clear dead-end
              message instead of a button that always errors. */}
          {isPasskey && passkeyAttemptFailed && !isRevealed && !mnemonic && !secureStorage.isSupported() && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-spark-error/20 flex items-center justify-center mx-auto mb-4">
                <WarningIcon size="xl" className="text-spark-error" />
              </div>
              <h3 className="font-display font-semibold text-spark-text-primary mb-2">Passkey Unavailable</h3>
              <p className="text-spark-text-muted text-sm">
                Your recovery phrase is derived from your passkey. Without it, the phrase cannot be retrieved on this device. Sign in on a device where the passkey is still available to view it.
              </p>
            </div>
          )}

          {/* Mnemonic word grid (shared) */}
          {isRevealed && mnemonic && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-spark-text-secondary">Recovery Phrase</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleHide}
                    className="px-3 py-1.5 text-sm font-medium text-spark-text-muted hover:text-spark-text-primary border border-spark-border rounded-lg hover:bg-white/5 transition-colors"
                  >
                    Hide
                  </button>
                  <button
                    onClick={handleCopy}
                    className={`
                      px-3 py-1.5 text-sm font-medium rounded-lg transition-all
                      ${copied
                        ? 'bg-spark-success/20 text-spark-success border border-spark-success/30'
                        : 'bg-spark-primary text-white hover:bg-spark-primary-light'
                      }
                    `}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {words.map((word, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 bg-spark-surface rounded-lg px-3 py-2"
                  >
                    <span className="text-spark-text-muted text-xs font-mono w-5 text-right">
                      {index + 1}.
                    </span>
                    <span className="text-spark-text-primary font-mono text-sm font-medium">
                      {word}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No backup found (mnemonic mode only) */}
          {!isPasskey && !mnemonic && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-spark-error/20 flex items-center justify-center mx-auto mb-4">
                <WarningIcon size="xl" className="text-spark-error" />
              </div>
              <h3 className="font-display font-semibold text-spark-text-primary mb-2">No Backup Found</h3>
              <p className="text-spark-text-muted text-sm">
                Could not find a recovery phrase for this wallet.
              </p>
            </div>
          )}
        </div>
      </div>
    </SlideInPage>
  );
};

export default BackupPage;
