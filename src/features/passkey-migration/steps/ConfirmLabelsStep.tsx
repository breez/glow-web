import React from 'react';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { useTranslation } from 'react-i18next';

interface ConfirmLabelsStepProps {
  labels: string[];
  primaryLabel: string;
  onContinue: () => void;
  onCancel: () => void;
}

/** Shows the discovered legacy wallets and asks the user to confirm before migrating. */
const ConfirmLabelsStep: React.FC<ConfirmLabelsStepProps> = ({
  labels,
  primaryLabel,
  onContinue,
  onCancel,
}) => {
  const { t } = useTranslation(['critical', 'common']);
  return (
  <>
    <p className="text-sm text-spark-text-secondary mb-3">
      {t('migration.migrateLabels', { count: labels.length })}
    </p>
    <div className="bg-spark-surface rounded-xl p-3 mb-3">
      <ul className="space-y-1">
        {labels.map((label) => (
          <li key={label} className="text-sm text-spark-text-primary font-mono flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-spark-primary" />
            {label}
            {label === primaryLabel && (
              <span className="text-xs text-spark-text-muted">{t('common:migration.currentLabel')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
    <p className="text-xs text-spark-text-muted mb-4">
      {t('migration.verifyMultipleTimes')}
    </p>
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onContinue}>{t('common:actions.continue')}</PrimaryButton>
      <SecondaryButton onClick={onCancel}>{t('common:migration.notNow')}</SecondaryButton>
    </div>
  </>
  );
};

export default ConfirmLabelsStep;
