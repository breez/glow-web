import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from '@/components/ui';
import { SimpleAlert } from '@/components/AlertCard';
import { BackupActions } from '../BackupCard';

export const IntroStep: React.FC = () => {
  const { t } = useTranslation('common');
  const [advanced, setAdvanced] = useState(false);
  // Three keys rather than one list: the translation files hold strings only,
  // so nothing in the pipeline can turn a list into an object behind our back.
  // Read per render, not at module load, which is before i18next has a language.
  const requirements = [t('exit.requirementFee'), t('exit.requirementAddress'), t('exit.requirementWait')];

  return (
    <div className="space-y-4">
      {/* Repeats the warning under the settings button on purpose. */}
      <SimpleAlert variant="warning" hideIcon>
        {t('exit.summary')} {t('exit.lastResort')}
      </SimpleAlert>

      <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
        <h3 className="font-display font-semibold text-spark-text-primary text-sm mb-3">
          {t('exit.whatYouNeed')}
        </h3>
        <ul className="space-y-3">
          {requirements.map(item => (
            <li key={item} className="text-spark-text-secondary text-sm flex gap-3">
              <span className="shrink-0">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <CollapsibleSection
        label={t('exit.advanced')}
        isVisible={advanced}
        onToggle={() => setAdvanced(v => !v)}
        bare
      >
        <BackupActions />
      </CollapsibleSection>
    </div>
  );
};
