import React, { useEffect, useState } from 'react';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';

export interface AmountStepProps {
  paymentInput: string;
  amount: string;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onNext: (amountSats: number) => void;
}

const AmountStep: React.FC<AmountStepProps> = ({
  paymentInput,
  amount,
  isLoading,
  error,
  onBack,
  onNext,
}) => {
  const [localAmount, setLocalAmount] = useState<string>(amount || '');

  useEffect(() => {
    setLocalAmount(amount || '');
  }, [amount]);

  const validAmount = localAmount && parseInt(localAmount) > 0;
  const amountNum = parseInt(localAmount) || 0;

  return (
    <div className="space-y-5">
      {/* Destination */}
      <div>
        <label className="block text-sm font-medium text-spark-text-primary mb-2">
          Destination
        </label>
        <div className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-secondary font-mono text-sm break-all">
          {paymentInput}
        </div>
      </div>

      {/* Amount input */}
      <div>
        <label className="block text-sm font-medium text-spark-text-primary mb-2">
          Amount (sats)
        </label>
        <input
          type="number"
          value={localAmount}
          onChange={(e) => setLocalAmount(e.target.value)}
          placeholder="Enter amount in satoshis"
          className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          disabled={isLoading}
          min={1}
        />
        
        {/* Quick amount buttons */}
        <div className="flex gap-2 mt-3">
          {[100, 1000, 10000, 100000].map((quickAmount) => (
            <button
              key={quickAmount}
              onClick={() => setLocalAmount(String(quickAmount))}
              className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                amountNum === quickAmount
                  ? 'bg-spark-electric text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              {quickAmount.toLocaleString('en-US').replace(/,/g, '\u2009')}
            </button>
          ))}
        </div>
      </div>

      <FormError error={error} />

      {/* Action buttons */}
      <div className="flex gap-3 pt-2">
        <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton
          onClick={() => validAmount && onNext(parseInt(localAmount))}
          disabled={isLoading || !validAmount}
          className="flex-1"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Processing...
            </span>
          ) : 'Continue'}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default AmountStep;
