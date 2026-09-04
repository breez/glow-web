import React from 'react';
import { PrimaryButton } from '@/components/ui/buttons';
import type { LnAddressFailure } from '../types';
import { useTranslation } from 'react-i18next';

interface DoneStepProps {
  onDone: () => void;
  /** Lightning addresses that couldn't be moved (funds are fine either way). */
  lnAddressFailures?: LnAddressFailure[];
}

/** Success screen after the new wallet has been adopted. */
const DoneStep: React.FC<DoneStepProps> = ({ onDone, lnAddressFailures = [] }) => {
  const { t } = useTranslation(['critical', 'common']);
  return (
  <>
    <p className="text-sm text-spark-text-secondary mb-4 text-center">
      {t('migration.doneBody')}
    </p>
    {lnAddressFailures.length > 0 && (
      <div className="mb-4">
        <p className="text-xs text-spark-warning mb-2 text-center">
          {t('migration.addressPending', { count: lnAddressFailures.length })}
        </p>
        <ul className="space-y-1.5">
          {lnAddressFailures.map(({ label, address }) => (
            <li key={label} className="rounded-xl border border-spark-border bg-spark-dark px-3 py-2 text-left">
              <div className="text-sm font-medium text-spark-text-primary break-all">{address}</div>
              <div className="text-xs text-spark-text-muted">{label}</div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-spark-warning mt-2 text-center">
          {t('migration.addressPendingBody', { count: lnAddressFailures.length })}
        </p>
      </div>
    )}
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onDone}>{t('common:actions.done')}</PrimaryButton>
    </div>
  </>
  );
};
export default DoneStep;
