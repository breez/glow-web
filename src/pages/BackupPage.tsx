import React, { useEffect, useState } from 'react';
import { WarningIcon, EyeIcon, FingerprintIcon } from '../components/Icons';
import SlideInPage from '../components/layout/SlideInPage';
import PasswordForm from '../components/PasswordForm';
import { isPasskeyMode } from '@/services/passkeyService';
import { hasVault, unlockVault, VaultError } from '@/services/vault';
import { logger, LogCategory } from '@/services/logger';

interface BackupPageProps {
  onBack: () => void;
  mnemonic: string | null;
}

type BackupMode = 'loading' | 'passkey' | 'vault' | 'default' | 'none';

const BackupPage: React.FC<BackupPageProps> = ({ onBack, mnemonic: mnemonicProp }) => {
  const [vaultMnemonic, setVaultMnemonic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupMode, setBackupMode] = useState<BackupMode>('loading');

  // The displayed mnemonic: vault mode uses its own state, others use the prop
  const mnemonic = backupMode === 'vault' ? vaultMnemonic : mnemonicProp;

  // Detect backup mode on mount
  useEffect(() => {
    const detectMode = async () => {
      if (isPasskeyMode()) {
        setBackupMode('passkey');
        return;
      }
      const vaultExists = await hasVault();
      if (vaultExists) {
        setBackupMode('vault');
        return;
      }
      if (mnemonicProp) {
        setBackupMode('default');
      } else {
        setBackupMode('none');
      }
    };
    detectMode();
  }, [mnemonicProp]);

  const handleRevealVault = async (password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const decrypted = await unlockVault(password);
      setVaultMnemonic(decrypted);
      setIsRevealed(true);
    } catch (e) {
      if (e instanceof VaultError && e.code === 'wrong_password') {
        setError('Wrong password. Try again.');
      } else {
        logger.error(LogCategory.AUTH, 'Failed to decrypt vault for backup', {
          error: e instanceof Error ? e.message : String(e),
        });
        setError('Failed to authenticate. Please try again.');
      }
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
    if (backupMode === 'vault') {
      setVaultMnemonic(null);
    }
  };

  const words = mnemonic ? mnemonic.split(' ') : [];

  return (
    <SlideInPage title="Backup" onClose={onBack} slideFrom="left">
      <div className="p-4">
        <div className="max-w-xl mx-auto w-full space-y-6">
          {/* Passkey info card */}
          {backupMode === 'passkey' && (
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

          {/* Vault mode: password prompt */}
          {backupMode === 'vault' && !isRevealed && !vaultMnemonic && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-6 space-y-4">
              <div className="flex flex-col items-center gap-2 mb-2">
                <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
                  <EyeIcon size="xl" className="text-spark-primary" />
                </div>
                <span className="font-display font-semibold text-spark-text-primary">
                  Enter your password to reveal
                </span>
                <span className="text-sm text-spark-text-muted">
                  Your recovery phrase is encrypted
                </span>
              </div>
              <PasswordForm
                mode="unlock"
                onSubmit={handleRevealVault}
                isLoading={isLoading}
                error={error}
              />
            </div>
          )}

          {/* Passkey / default: simple reveal button */}
          {(backupMode === 'passkey' || backupMode === 'default') && mnemonic && !isRevealed && (
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

          {/* Mnemonic word grid */}
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

          {/* No backup found */}
          {backupMode === 'none' && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-spark-error/20 flex items-center justify-center mx-auto mb-4">
                <WarningIcon size="xl" className="text-spark-error" />
              </div>
              <h3 className="font-display font-semibold text-spark-text-primary mb-2">No Backup Found</h3>
              <p className="text-spark-text-muted text-sm">
                Could not find a recovery phrase.
              </p>
            </div>
          )}
        </div>
      </div>
    </SlideInPage>
  );
};

export default BackupPage;
