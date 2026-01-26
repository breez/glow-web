import React from 'react';
import { PrimaryButton, SecondaryButton, FormError } from '../../../components/ui';
import { SimpleFeeBreakdown } from '../../../components/FeeBreakdownCard';
import { SpinnerIcon } from '../../../components/Icons';
import { formatWithSpaces } from '../../../utils/formatNumber';

export interface ConfirmStepProps {
  amountSats: bigint | null;
  feesSat: number | null;
  error: string | null;
  isLoading: boolean;
  onBack?: () => void;
  onConfirm: () => void;
}

const ConfirmStep: React.FC<ConfirmStepProps> = ({ amountSats, feesSat, error, isLoading, onBack, onConfirm }) => {
  const amount = Number(amountSats || 0n);
  const fee = Number(feesSat || 0);
  const total = amount + fee;

  return (
    <div className="space-y-6">
      {/* Total amount display */}
      <div className="text-center py-4">
        <p className="text-spark-text-muted text-sm mb-2">You're sending</p>
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-4xl font-mono font-bold text-spark-text-primary">
            {formatWithSpaces(total)}
          </span>
          <span className="text-xl text-spark-text-secondary">sats</span>
        </div>
      </div>

      {/* Breakdown */}
      <SimpleFeeBreakdown amount={amount} fee={fee} />

      <FormError error={error} />

      {/* Action buttons */}
      <div className="flex gap-3">
        {onBack && (
          <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
            Back
          </SecondaryButton>
        )}
        <PrimaryButton
          onClick={onConfirm}
          disabled={isLoading}
          className={onBack ? 'flex-1' : 'w-full'}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <SpinnerIcon size="md" />
              Processing...
            </span>
          ) : (
            'Confirm & Send'
          )}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default ConfirmStep;
