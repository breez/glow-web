import React from 'react';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AlertCard } from '@/components/AlertCard';
import { useTranslation } from 'react-i18next';

interface ErrorStepProps {
  error: string | null;
  onRetry: () => void;
  onCancel: () => void;
  /** When set, offer a fresh-start action (the recorded passkey is unreachable). */
  onStartOver?: () => void;
}

/** Failure screen with Retry + Cancel, plus an optional fresh-start action. */
const ErrorStep: React.FC<ErrorStepProps> = ({ error, onRetry, onCancel, onStartOver }) => {
  const { t } = useTranslation(['critical', 'common']);
  return (
  <>
    <AlertCard variant="error" title={t('common:migration.failed')}>
      <p className="text-sm text-spark-text-secondary">{error ?? t('common:migration.failedBody')}</p>
    </AlertCard>
    <div className="flex flex-col gap-3 mt-4">
      <PrimaryButton onClick={onRetry}>{t('common:actions.retry')}</PrimaryButton>
      {onStartOver && (
        <SecondaryButton onClick={onStartOver}>{t('common:migration.createNewPasskey')}</SecondaryButton>
      )}
      <SecondaryButton onClick={onCancel}>{t('common:actions.cancel')}</SecondaryButton>
    </div>
  </>
  );
};
export default ErrorStep;
