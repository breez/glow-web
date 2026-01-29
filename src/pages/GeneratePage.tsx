import React, { useState, useEffect } from 'react';
import * as bip39 from 'bip39';
import { PrimaryButton } from '../components/ui';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { CheckIcon, CopyIcon } from '../components/Icons';
import { logger, LogCategory } from '@/services/logger';

interface GeneratePageProps {
  onMnemonicConfirmed: (mnemonic: string) => void;
  onBack: () => void;
  error: string | null;
  onClearError: () => void;
}

const GeneratePage: React.FC<GeneratePageProps> = ({
  onMnemonicConfirmed,
  onBack,
  onClearError
}) => {
  const [mnemonic, setMnemonic] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  useEffect(() => {
    const generateMnemonic = async () => {
      try {
        const newMnemonic = bip39.generateMnemonic(128);
        setMnemonic(newMnemonic);
      } catch (error) {
        logger.error(LogCategory.AUTH, 'Failed to generate mnemonic', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsLoading(false);
      }
    };

    generateMnemonic();
  }, []);

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(mnemonic)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => {
        logger.warn(LogCategory.UI, 'Failed to copy mnemonic', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };

  const handleConfirmMnemonic = () => {
    onMnemonicConfirmed(mnemonic);
  };

  if (isLoading) {
    return (
      <PageLayout onBack={onBack} footer={<div />} title="Get Started" onClearError={onClearError}>
        <div className="flex items-center justify-center h-full">
          <LoadingSpinner text="Setting up Glow..." />
        </div>
      </PageLayout>
    );
  }

  const footer = (
    <div className="max-w-xl mx-auto">
      <PrimaryButton className="w-full" onClick={handleConfirmMnemonic}>
        I've Saved My Phrase
      </PrimaryButton>
    </div>
  );

  const words = mnemonic.split(' ');

  return (
    <PageLayout onBack={onBack} footer={footer} title="Get Started" onClearError={onClearError}>
      <div className="max-w-xl mx-auto w-full space-y-4">
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
        </div>

        <p className="text-spark-text-secondary text-center mb-6">
          Write down these words in order. This is your only backup to recover your wallet.
        </p>

        {/* Mnemonic grid */}
        <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 mb-4">
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

        {/* Copy button */}
        <div className="flex justify-center mb-6">
          <button
            onClick={handleCopyToClipboard}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg transition-all
              ${isCopied 
                ? 'bg-spark-success/20 text-spark-success' 
                : 'text-spark-primary hover:bg-spark-primary/10'
              }
            `}
          >
            {isCopied ? (
              <>
                <CheckIcon size="md" />
                <span className="font-medium">Copied!</span>
              </>
            ) : (
              <>
                <CopyIcon size="md" />
                <span className="font-medium">Copy to clipboard</span>
              </>
            )}
          </button>
        </div>

        {/* Warning */}
        <AlertCard variant="warning" title="Keep it Secret">
          <p className="text-spark-text-secondary text-sm">
            Never share your recovery phrase. Anyone with these words can access your funds.
          </p>
        </AlertCard>

        <div className="flex-1" />
      </div>
    </PageLayout>
  );
};

export default GeneratePage;
