import React, { useState } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { PrimaryButton } from '../components/ui';

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
    <div className="flex w-full p-4 max-w-1xl items-center">
      <PrimaryButton
        onClick={handleSubmit}
        disabled={!mnemonic.trim()}
        className="ml-auto"
      >
        Restore Wallet
      </PrimaryButton>
    </div>
  );

  return (
    <PageLayout footer={footer} onBack={onBack} title="Restore Wallet" onClearError={onClearError}>
      <div className="flex flex-col container h-full mx-auto max-w-md px-4">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-spark-violet/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-spark-violet" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            className="w-full h-36 px-4 py-3 text-spark-text-primary bg-spark-dark border border-spark-border rounded-xl focus:border-spark-amber focus:ring-2 focus:ring-spark-amber/20 resize-none font-mono text-sm"
            placeholder="word1 word2 word3 ..."
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 mt-4 p-3 bg-spark-error/10 border border-spark-error/30 rounded-xl text-spark-error text-sm">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1" />
      </div>
    </PageLayout>
  );
};

export default RestorePage;
