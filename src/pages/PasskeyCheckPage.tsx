import React from 'react';
import { useTranslation } from 'react-i18next';
import PageLayout from '../components/layout/PageLayout';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { AlertCard } from '../components/AlertCard';
import { safeAreaTop } from '../utils/safeAreaInsets';

interface PasskeyCheckPageProps {
  isLoading: boolean;
  onRetry: () => Promise<void>;
  onContinue: () => Promise<void>;
}

/** No erase here: the vault still opens the wallet, and erasing would lose it. */
const PasskeyCheckPage: React.FC<PasskeyCheckPageProps> = ({
  isLoading,
  onRetry,
  onContinue,
}) => {
  const { t } = useTranslation(['critical', 'common']);

  return (
    <PageLayout
      // No app bar, so the content takes the top safe-area inset instead.
      showHeader={false}
      onBack={() => undefined}
      footer={(
        <div className="max-w-sm mx-auto space-y-3">
          <PrimaryButton className="w-full" disabled={isLoading} onClick={() => void onRetry()}>
            {t('common:actions.tryAgain')}
          </PrimaryButton>
          <SecondaryButton className="w-full" disabled={isLoading} onClick={() => void onContinue()}>
            {t('common:passkeyCheck.continue')}
          </SecondaryButton>
        </div>
      )}
    >
      <div
        className="min-h-full flex items-center justify-center p-2"
        style={{ paddingTop: safeAreaTop }}
      >
        <div className="max-w-sm w-full space-y-8">
          <div className="flex flex-col items-center gap-4">
            <img
              src="/assets/Glow_Logo.svg"
              alt="Glow"
              className="w-36 h-36 object-contain"
            />
            <h1 className="font-display text-2xl font-bold text-spark-text-primary">
              {t('common:unlock.welcomeBack')}
            </h1>
          </div>

          <AlertCard variant="warning" title={t('passkeyCheck.title')}>
            {t('passkeyCheck.body')}
          </AlertCard>
        </div>
      </div>
    </PageLayout>
  );
};

export default PasskeyCheckPage;
