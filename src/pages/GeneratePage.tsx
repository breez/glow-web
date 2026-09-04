import React, { useState, useEffect } from 'react';
import * as bip39 from 'bip39';
import { PrimaryButton } from '../components/ui';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { WebSecurityNotice } from '../components/WebSecurityNotice';
import { CheckIcon, CopyIcon } from '../components/Icons';
import { logger, LogCategory } from '@/services/logger';
import { copyToClipboard } from '@/utils/clipboard';
import { useTranslation } from 'react-i18next';

interface GeneratePageProps {
  onMnemonicConfirmed: (mnemonic: string) => void;
  onBack: () => void;
  error: string | null;
  onClearError: () => void;
  recommendPasskey?: boolean;
}

const GeneratePage: React.FC<GeneratePageProps> = ({
  onMnemonicConfirmed,
  onBack,
  onClearError,
  recommendPasskey = false,
}) => {
  const { t } = useTranslation(['critical', 'common']);
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
    copyToClipboard(mnemonic)
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
      <PageLayout onBack={onBack} footer={<div />} title={t('common:pages.getStarted')} onClearError={onClearError}>
        <div className="flex items-center justify-center h-full">
          <LoadingSpinner text="Setting up Glow..." />
        </div>
      </PageLayout>
    );
  }

  const footer = (
    <div className="max-w-xl mx-auto">
      <PrimaryButton className="w-full" onClick={handleConfirmMnemonic}>
        {t('generate.saved')}
      </PrimaryButton>
    </div>
  );

  const words = mnemonic.split(' ');

  return (
    <PageLayout onBack={onBack} footer={footer} title={t('common:pages.getStarted')} onClearError={onClearError}>
      <div className="max-w-xl mx-auto w-full space-y-4">
        <p className="text-spark-text-secondary text-center mb-6">
          {t('generate.body')}
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
                <span className="font-medium">{t('common:actions.copied')}</span>
              </>
            ) : (
              <>
                <CopyIcon size="md" />
                <span className="font-medium">{t('generate.copyToClipboard')}</span>
              </>
            )}
          </button>
        </div>

        {/* Warning */}
        <AlertCard variant="warning" title={t('generate.title')}>
          <p className="text-spark-text-secondary text-sm">
            {t('generate.warning')}
          </p>
        </AlertCard>

        <WebSecurityNotice recommendPasskey={recommendPasskey} />

        <div className="flex-1" />
      </div>
    </PageLayout>
  );
};

export default GeneratePage;
