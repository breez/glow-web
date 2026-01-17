import React from 'react';
import { PrimaryButton, FormError } from '../../../components/ui';

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
        <p className="text-spark-text-secondary text-sm mb-2">You're sending</p>
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-4xl font-display font-bold text-spark-text-primary">
            {formatWithSpaces(total)}
          </span>
          <span className="text-xl font-display text-spark-text-secondary">sats</span>
        </div>
      </div>

      {/* Breakdown card */}
      <div className="bg-spark-dark border border-spark-border rounded-2xl overflow-hidden">
        {/* Amount row */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-spark-electric/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-spark-electric" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-spark-text-secondary">Amount</span>
          </div>
          <span className="font-mono font-medium text-spark-text-primary">
            {formatWithSpaces(amount)} sats
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-spark-border" />

        {/* Fee row */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-spark-primary/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-spark-text-secondary">Network fee</span>
          </div>
          <span className="font-mono font-medium text-spark-text-primary">
            {formatWithSpaces(fee)} sats
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-spark-border" />

        {/* Total row */}
        <div className="flex items-center justify-between px-4 py-3 bg-spark-surface/50">
          <span className="font-display font-semibold text-spark-text-primary">Total</span>
          <span className="font-mono font-bold text-spark-primary">
            {formatWithSpaces(total)} sats
          </span>
        </div>
      </div>

      <FormError error={error} />

      {/* Action buttons */}
      <div className="flex gap-3">
        {onBack && (
          <button
            onClick={onBack}
            disabled={isLoading}
            className="flex-1 py-3 font-display font-semibold text-spark-text-secondary border border-spark-border rounded-xl hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50"
          >
            Back
          </button>
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
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Confirm & Pay
            </span>
          )}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default ConfirmStep;
