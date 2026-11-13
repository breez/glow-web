import React from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/ui';
import { FeeRateSelector } from '@/components/FeeRateSelector';
import type { FeeFields } from '../hooks/useUnilateralExitFlow';

export const FeeStep: React.FC<FeeFields> = ({ feeRates, feeChoice, onSelect }) => {
  const { t } = useTranslation('common');
  if (!feeRates) {
    return (
      <div className="py-16 flex justify-center">
        <LoadingSpinner text={t('exit.readingFeeRates')} />
      </div>
    );
  }

  return (
    <FeeRateSelector selected={feeChoice} onSelect={onSelect} detail={speed => `${feeRates[speed]} sat/vB`} />
  );
};
