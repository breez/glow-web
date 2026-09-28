import React from 'react';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import type { MigrationEntry } from '../types';
import { Trans, useTranslation } from 'react-i18next';

interface ExplainStepProps {
  entry: MigrationEntry;
  onContinue: () => void;
  onSecondary: () => void;
}

/** First screen: explains the upgrade and offers Continue + a per-entry opt-out. */
const ExplainStep: React.FC<ExplainStepProps> = ({ entry, onContinue, onSecondary }) => {
  const { t } = useTranslation(['critical', 'common']);
  return (
  <>
    {entry === 'banner' ? (
      <p className="text-sm text-spark-text-secondary mb-4">
        {t('migration.explainBody')}
      </p>
    ) : (
      <p className="text-sm text-spark-text-secondary mb-4">
        <Trans i18nKey="migration.explainFirstTime" ns="critical" components={{ skip: <em>{t('common:actions.skip')}</em> }} />
      </p>
    )}
    <p className="text-xs text-spark-text-muted mb-4">
      {t('migration.singleTransaction')}
    </p>
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onContinue}>{t('common:actions.continue')}</PrimaryButton>
      <SecondaryButton onClick={onSecondary}>{entry === 'banner' ? t('common:migration.notNow') : t('common:actions.skip')}</SecondaryButton>
    </div>
  </>
  );
};
export default ExplainStep;
