import React from 'react';
import { PrimaryButton, SecondaryButton, FormError } from '../../../components/ui';

// Format number with space as thousand separator
const formatWithSpaces = (num: number): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

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
      <div className="bg-spark-dark/50 border border-spark-border rounded-2xl p-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-spark-text-secondary text-sm">Amount</span>
          <span className="font-mono text-sm text-spark-text-primary">
            {formatWithSpaces(amount)} sats
          </span>
        </div>
        
        <div className="border-t border-spark-border/50" />
        
        <div className="flex justify-between items-center">
          <span className="text-spark-text-secondary text-sm">Network fee</span>
          <span className="font-mono text-sm text-spark-text-primary">
            {formatWithSpaces(fee)} sats
          </span>
        </div>
        
        <div className="border-t border-spark-border/50" />
        
        <div className="flex justify-between items-center">
          <span className="text-spark-text-primary font-semibold">Total</span>
          <span className="font-mono font-bold text-spark-primary">
            {formatWithSpaces(total)} sats
          </span>
        </div>
      </div>

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
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
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
