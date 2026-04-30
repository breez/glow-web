import React, { useEffect, useState } from 'react';
import { WarningIcon, SpinnerIcon, EyeIcon, FingerprintIcon } from '../components/Icons';
import SlideInPage from '../components/layout/SlideInPage';
import { isPasskeyMode, getWallet } from '@/services/passkeyService';
import { deviceOnlyStorage } from '@/services/secureStorage';
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

  const handleRevealPasskey = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const w = await getWallet();
      if (w.seed.type === 'mnemonic' && w.seed.mnemonic) {
        setMnemonic(w.seed.mnemonic);
        setIsRevealed(true);
      } else {
        setError('Could not derive recovery phrase');
      }
    } catch (e) {
      logger.error(LogCategory.AUTH, 'Failed to derive mnemonic from passkey', {
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
                <div className="w-10 h-10 rounded-xl bg-spark-primary/20 flex items-center justify-center flex-shrink-0">
                  <FingerprintIcon size="md" className="text-spark-primary" />
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

          {/* Reveal button — passkey mode */}
          {isPasskey && !isRevealed && !mnemonic && (
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

          {/* Reveal button — mnemonic mode */}
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

          {/* Error message (passkey only) */}
          {error && (
            <div className="bg-spark-error/10 border border-spark-error/30 rounded-xl p-4 text-center">
              <p className="text-spark-error text-sm">{error}</p>
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
