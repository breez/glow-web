import React, { useEffect, useState } from 'react';
import { WarningIcon, SpinnerIcon, EyeIcon, FaceIdIcon, FingerprintIcon, PasskeyIcon } from '../components/Icons';
import SlideInPage from '../components/layout/SlideInPage';
import {
  isPasskeyMode,
  signInPinnedToActiveCredential,
} from '@/services/passkeyService';
import { deviceOnlyStorage, secureStorage, getBiometryInfo, BiometryInfo } from '@/services/secureStorage';
import { logger, LogCategory } from '@/services/logger';
import { copyToClipboard } from '@/utils/clipboard';
import { useScreenCaptureProtection } from '@/utils/screenSecurity';

interface BackupPageProps {
  onBack: () => void;
  /** 'back' when opened from the Security & Backup page (native). */
  closeStyle?: 'close' | 'back';
}

const BackupPage: React.FC<BackupPageProps> = ({ onBack, closeStyle = 'close' }) => {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Block screen capture for the whole Backup screen, from mount, so
  // protection is already active before the seed can render (the native
  // toggle is async: gating on the loaded seed left a few unprotected
  // frames on reveal). Generate deliberately does not protect.
  useScreenCaptureProtection(true);

  const isPasskey = isPasskeyMode();

  // Non-passkey wallet whose seed sits in the biometric-bound tier
  // (biometric unlock enabled in Security settings). Reveal requires
  // an OS biometric prompt instead of the silent device-only read.
  const [biometricSeedPresent, setBiometricSeedPresent] = useState(false);

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
      // Legacy biometric-bound seed (pre-migration install). Don't read
      // it here (that would fire an OS prompt at page mount); flag it
      // so the reveal tile triggers the prompt on tap.
      if (secureStorage.isSupported() && (await secureStorage.hasStoredSeed())) {
        if (!cancelled) setBiometricSeedPresent(true);
        return;
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

  // Passkey mode: once the passkey attempt fails, resolve which vault
  // tier holds the cached seed. Drives the fallback tile's copy
  // (biometric prompt vs silent read) and its very existence: with
  // no cached seed in either tier the tile would be a dead button.
  // null = still probing.
  const [fallbackTier, setFallbackTier] = useState<'biometric' | 'device' | 'none' | null>(null);
  useEffect(() => {
    if (!isPasskey || !passkeyAttemptFailed || !secureStorage.isSupported()) return;
    let cancelled = false;
    void (async () => {
      const tier = (await secureStorage.hasStoredSeed().catch(() => false))
        ? 'biometric' as const
        : (await deviceOnlyStorage.hasStoredSeed().catch(() => false))
          ? 'device' as const
          : 'none' as const;
      if (!cancelled) setFallbackTier(tier);
    })();
    return () => { cancelled = true; };
  }, [isPasskey, passkeyAttemptFailed]);

  // Resolved at mount: label ('Face ID', 'Touch ID', 'fingerprint'…)
  // for the fallback tiles' copy, kind ('face' | 'fingerprint') for
  // their icon. Null on web or when no biometry is enrolled; the copy
  // degrades gracefully and the icon falls back to fingerprint.
  const [biometry, setBiometry] = useState<BiometryInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBiometryInfo().then((info) => {
      if (!cancelled) setBiometry(info);
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

  // Fallback path: read the cached seed from the given vault tier
  // (legacy biometric-bound prompts, device-only is silent). For
  // passkey wallets this only surfaces after the passkey path failed,
  // so intact passkeys never bypass the ceremony.
  const revealFromVault = async (tier: 'biometric' | 'device') => {
    setIsLoading(true);
    setError(null);
    try {
      const store = tier === 'biometric' ? secureStorage : deviceOnlyStorage;
      const seed = await store.retrieveSeed();
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
      await copyToClipboard(mnemonic);
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
    <SlideInPage title="Backup" onClose={onBack} slideFrom="left" closeStyle={closeStyle}>
      {/* min-h-full + flexed chain so the PIN gate (the sole child
          while it shows) can split the viewport 1/3 header / 2/3
          input; the card views flow from the top as before. */}
      <div className="p-4 min-h-full flex flex-col">
        <div className="max-w-xl mx-auto w-full space-y-6 flex-1 flex flex-col">
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

          {/* Reveal button (mnemonic mode). When biometric unlock is
              enabled the seed is in the biometric-bound tier, so the
              tap triggers an OS prompt before revealing. App-lock
              protection happens at page entry: on native the only way
              here is through the gated Security & Backup page. */}
          {!isPasskey && !isRevealed && (mnemonic || biometricSeedPresent) && (
            <button
              onClick={mnemonic
                ? () => setIsRevealed(true)
                : () => { void revealFromVault('biometric'); }}
              disabled={isLoading}
              className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors disabled:opacity-50"
            >
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
                {isLoading ? (
                  <SpinnerIcon size="xl" className="text-spark-primary" />
                ) : mnemonic ? (
                  <EyeIcon size="xl" className="text-spark-primary" />
                ) : biometry?.kind === 'face' ? (
                  <FaceIdIcon size="xl" className="text-spark-primary" />
                ) : (
                  <FingerprintIcon size="xl" className="text-spark-primary" />
                )}
              </div>
              <span className="font-display font-semibold text-spark-text-primary">
                {isLoading ? 'Authenticating...' : 'Tap to reveal phrase'}
              </span>
              <span className="text-sm text-spark-text-muted">
                {mnemonic
                  ? 'Make sure no one is watching'
                  : isLoading
                    ? `Complete ${biometry?.label ?? 'biometric'} authentication`
                    : `Requires ${biometry?.label ?? 'biometric authentication'}`}
              </span>
            </button>
          )}

          {/* Mnemonic-mode error: passkey-mode errors are now folded
              into the fallback card below, so this only renders for
              non-passkey edge cases. */}
          {error && !isPasskey && (
            <div className="bg-spark-primary/10 border border-spark-primary/30 rounded-xl p-4 text-center">
              <p className="text-spark-primary-light text-sm">{error}</p>
            </div>
          )}

          {/* Biometric fallback (passkey only, native). Single card that
              replaces both the original reveal tile and the error
              banner once the passkey attempt has failed. Visually
              mirrors the happy-path tile: same title, swap the
              "Requires passkey authentication" subtitle for "Requires
              {biometric}". The label-driven biometric naming matches
              the convention used elsewhere (UnlockPage). */}
          {isPasskey && passkeyAttemptFailed && !isRevealed && !mnemonic
            && (fallbackTier === 'biometric' || fallbackTier === 'device') && (
            <button
              onClick={() => { void revealFromVault(fallbackTier); }}
              disabled={isLoading}
              className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors disabled:opacity-50"
            >
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
                {isLoading ? (
                  <SpinnerIcon size="xl" className="text-spark-primary" />
                ) : biometry?.kind === 'face' && fallbackTier === 'biometric' ? (
                  <FaceIdIcon size="xl" className="text-spark-primary" />
                ) : (
                  <FingerprintIcon size="xl" className="text-spark-primary" />
                )}
              </div>
              <span className="font-display font-semibold text-spark-text-primary">
                {isLoading ? 'Authenticating...' : 'Tap to reveal phrase'}
              </span>
              <span className="text-sm text-spark-text-muted">
                {fallbackTier === 'device'
                  ? 'Stored securely on this device'
                  : isLoading
                    ? `Complete ${biometry?.label ?? 'biometric'} authentication`
                    : `Requires ${biometry?.label ?? 'biometric authentication'}`}
              </span>
            </button>
          )}

          {/* Dead-end card (passkey mode): web has no cached copy at
              all, and a native install can lack one too (persist
              failed, vault cleared). Without it the fallback tile
              would be a button that always errors. */}
          {isPasskey && passkeyAttemptFailed && !isRevealed && !mnemonic
            && (!secureStorage.isSupported() || fallbackTier === 'none') && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center mx-auto mb-4">
                <WarningIcon size="xl" className="text-spark-primary-light" />
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
          {!isPasskey && !mnemonic && !biometricSeedPresent && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center mx-auto mb-4">
                <WarningIcon size="xl" className="text-spark-primary-light" />
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
