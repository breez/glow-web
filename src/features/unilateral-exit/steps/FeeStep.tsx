import React from 'react';
import { LoadingSpinner } from '@/components/ui';
import { FeeRateSelector } from '@/components/FeeRateSelector';
import type { FeeFields } from '../hooks/useUnilateralExitFlow';

export const FeeStep: React.FC<FeeFields> = ({ feeRates, feeChoice, onSelect }) => {
  if (!feeRates) {
    return (
      <div className="py-16 flex justify-center">
        <LoadingSpinner text="Reading current fee rates..." />
      </div>
    );
  }

  return (
    <FeeRateSelector selected={feeChoice} onSelect={onSelect} detail={speed => `${feeRates[speed]} sat/vB`} />
  );
};
