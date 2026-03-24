import React from 'react';
import { PrimaryButton, SecondaryButton, FormError } from '../../../components/ui';
import { SimpleFeeBreakdown } from '../../../components/FeeBreakdownCard';
import { SpinnerIcon } from '../../../components/Icons';
import { formatWithThinSpaces } from '../../../utils/formatNumber';

export interface ConfirmStepProps {
  amountSats: bigint | null;
  feesSat: number | null;
  feesIncluded?: boolean;
  error: string | null;
  isLoading: boolean;
  onBack?: () => void;
  onConfirm: () => void;
}

const ConfirmStep: React.FC<ConfirmStepProps> = ({ amountSats, feesSat, feesIncluded, error, isLoading, onBack, onConfirm }) => {
  const amount = Number(amountSats || 0n);
  const fee = Number(feesSat || 0);
  const total = feesIncluded ? amount : amount + fee;

  return (
    <div className="space-y-6">
      {/* Total amount display */}
      <div className="text-center py-4">
        <p className="text-spark-text-muted text-sm mb-2">You're sending</p>
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-4xl font-mono font-bold text-spark-text-primary">
            <span className="inline-flex items-center"><span className="text-[0.8em] opacity-70 mr-px">₿</span>{formatWithThinSpaces(total)}</span>
          </span>
        </div>
      </div>

      {/* Breakdown */}
      <SimpleFeeBreakdown amount={feesIncluded ? amount - fee : amount} fee={fee} amountLabel={feesIncluded ? 'Recipient gets' : 'Amount'} />

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
            'Send'
          )}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default ConfirmStep;
