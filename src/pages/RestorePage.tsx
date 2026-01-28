import React, { useState } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { PrimaryButton } from '../components/ui';
import { SimpleAlert } from '../components/AlertCard';

interface RestorePageProps {
  onConnect: (mnemonic: string) => void;
  onBack: () => void;
  onClearError: () => void;
}

const RestorePage: React.FC<RestorePageProps> = ({
  onConnect,
  onBack,
  onClearError
}) => {
  const [mnemonic, setMnemonic] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const cleaned = mnemonic.trim().replace(/\s+/g, ' ');
    const wordCount = cleaned.split(' ').length;

    if (wordCount !== 12 && wordCount !== 24) {
      setError('Please enter a valid 12 or 24-word recovery phrase');
      return;
    }

    setError(null);
    onConnect(cleaned);
  };

  const footer = (
    <div className="max-w-xl mx-auto">
      <PrimaryButton
        onClick={handleSubmit}
        disabled={!mnemonic.trim()}
        className="w-full"
        data-testid="restore-confirm-button"
      >
        Restore Wallet
      </PrimaryButton>
    </div>
  );

  return (
    <PageLayout footer={footer} onBack={onBack} title="Restore from Backup" onClearError={onClearError}>
       <div className="max-w-xl mx-auto w-full space-y-4">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
        </div>

        <p className="text-spark-text-secondary text-center mb-6">
          Enter your 12 or 24-word recovery phrase to restore your wallet. Words should be separated by spaces.
        </p>

        <div className="relative">
          <textarea
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
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
    </PageLayout>
  );
};

export default RestorePage;
