import React from 'react';
import { PrimaryButton } from '@/components/ui/buttons';
import { AlertCard } from '@/components/AlertCard';
import { useTranslation } from 'react-i18next';

interface BlockedDepositsStepProps {
  count: number;
  onOpenDeposits: () => void;
}

/** Shown when one or more wallets have unclaimed deposits that block migration. */
const BlockedDepositsStep: React.FC<BlockedDepositsStepProps> = ({ count, onOpenDeposits }) => {
  const { t } = useTranslation('critical');
  return (
  <>
    <AlertCard variant="warning" title={t('common:migration.unclaimedDeposits')}>
      <p className="text-sm text-spark-text-secondary">
        You have {count} unclaimed deposit{count === 1 ? '' : 's'} across your wallets. Please
        resolve {count === 1 ? 'it' : 'them'} before upgrading. You can come back and try again
        once done.
      </p>
    </AlertCard>
    <div className="flex flex-col gap-3 mt-4">
      <PrimaryButton onClick={onOpenDeposits}>{t('common:migration.openUnclaimedDeposits')}</PrimaryButton>
    </div>
  </>
  );
};
export default BlockedDepositsStep;
