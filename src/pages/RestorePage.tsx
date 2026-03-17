import React, { useState } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { PrimaryButton, SecondaryButton, ConfirmDialog } from '../components/ui';
import { SimpleAlert } from '../components/AlertCard';
import { KeyIcon, DownloadIcon } from '../components/Icons';

interface RestorePageProps {
  onConnect: (mnemonic: string) => Promise<void>;
  onBack: () => void;
  onClearError: () => void;
  isLoading?: boolean;
  /** Changes title, description, and button text for the forgot-password flow. */
  mode?: 'restore' | 'reset-password';
  /** Called when the user wants to delete the vault and start over (reset-password mode only). */
  onStartOver?: () => void;
}

const RestorePage: React.FC<RestorePageProps> = ({
  onConnect,
  onBack,
  onClearError,
  isLoading = false,
  mode = 'restore',
  onStartOver,
}) => {
  const [mnemonic, setMnemonic] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isMismatch, setIsMismatch] = useState(false);
  const [showStartOverConfirm, setShowStartOverConfirm] = useState(false);

  const isReset = mode === 'reset-password';

  const handleSubmit = async () => {
    const cleaned = mnemonic.trim().replace(/\s+/g, ' ');
    const wordCount = cleaned.split(' ').length;

    if (wordCount !== 12 && wordCount !== 24) {
      setError('Please enter a valid 12 or 24-word recovery phrase');
      return;
    }

    setError(null);
    setIsMismatch(false);
    try {
      await onConnect(cleaned);
    } catch (err) {
      const message = err instanceof Error && err.message
        ? err.message
        : 'Invalid recovery phrase. Please check your words and try again.';
      setError(message);
      // Show logout option on fingerprint mismatch
      if (err && typeof err === 'object' && 'mismatch' in err) {
        setIsMismatch(true);
      }
    }
  };

  const footer = (
    <div className="max-w-xl mx-auto">
      <PrimaryButton
        onClick={handleSubmit}
        disabled={!mnemonic.trim() || isLoading}
        className="w-full"
        data-testid="restore-confirm-button"
      >
        {isLoading
          ? (isReset ? 'Verifying...' : 'Restoring...')
          : (isReset ? 'Continue' : 'Restore')
        }
      </PrimaryButton>
      {isMismatch && onStartOver && (
        <SecondaryButton
          onClick={() => setShowStartOverConfirm(true)}
          className="w-full mt-3"
        >
          Logout
        </SecondaryButton>
      )}
    </div>
  );

  return (
    <PageLayout
      footer={footer}
      onBack={onBack}
      title={isReset ? 'Enter Recovery Phrase' : 'Restore from Backup'}
      onClearError={onClearError}
    >
       <div className="max-w-xl mx-auto w-full space-y-4">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
            {isReset ? (
              <KeyIcon className="text-spark-primary" size="xl" />
            ) : (
              <DownloadIcon className="text-spark-primary" size="xl" />
            )}
          </div>
        </div>

        <p className="text-spark-text-secondary text-center mb-6">
          {isReset
            ? 'Enter your recovery phrase to verify your identity and set a new password.'
            : 'Enter your 12 or 24-word recovery phrase to restore Glow. Words should be separated by spaces.'
          }
        </p>

        <div className="relative">
          <textarea
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            onFocus={() => { setIsMismatch(false); setError(null); }}
            className="w-full h-36 px-4 py-3 text-spark-text-primary bg-spark-dark border border-spark-border rounded-xl focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20 resize-none font-mono text-sm"
            placeholder="word1 word2 word3 ..."
            data-testid="mnemonic-input"
          />
        </div>

        {error && (
          <SimpleAlert variant="error" className="mt-4">
            {error}
          </SimpleAlert>
        )}

        <div className="flex-1" />
      </div>

      <ConfirmDialog
        isOpen={showStartOverConfirm}
        title="Logout Warning"
        message="Logging out will permanently erase all data from this device. Without your recovery phrase, you will lose access to your funds forever."
        confirmLabel="Logout"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          setShowStartOverConfirm(false);
          onStartOver?.();
        }}
        onCancel={() => setShowStartOverConfirm(false)}
      />
    </PageLayout>
  );
};

export default RestorePage;
