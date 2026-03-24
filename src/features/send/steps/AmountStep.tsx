import React, { useEffect, useState } from 'react';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { SpinnerIcon } from '../../../components/Icons';

export interface AmountStepProps {
  paymentInput: string;
  amount: string;
  balanceSats?: number;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onNext: (amountSats: number, feesIncluded?: boolean) => void;
}

const AmountStep: React.FC<AmountStepProps> = ({
  paymentInput,
  amount,
  balanceSats,
  isLoading,
  error,
  onBack,
  onNext,
}) => {
  const [localAmount, setLocalAmount] = useState<string>(amount || '');
  const [feesIncluded, setFeesIncluded] = useState(false);

  useEffect(() => {
    setLocalAmount(amount || '');
  }, [amount]);

  const validAmount = localAmount !== '' && parseInt(localAmount) > 0;
  const amountNum = parseInt(localAmount) || 0;

  const isSendAll = balanceSats !== undefined && balanceSats > 0 && amountNum === balanceSats && feesIncluded;

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
          onChange={(e) => { setLocalAmount(e.target.value); setFeesIncluded(false); }}
          placeholder="Enter amount in satoshis"
          className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          disabled={isLoading}
          min={1}
          data-testid="amount-input"
        />
        
        {/* Quick amount buttons */}
        <div className="flex gap-2 mt-3">
          {[1000, 10000, 100000].map((quickAmount) => (
            <button
              key={quickAmount}
              onClick={() => { setLocalAmount(String(quickAmount)); setFeesIncluded(false); }}
              className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                amountNum === quickAmount && !isSendAll
                  ? 'bg-spark-electric text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              <span className="inline-flex items-center"><span className="text-[0.8em] opacity-70 mr-px">₿</span>{quickAmount.toLocaleString('en-US').replace(/,/g, '\u2009')}</span>
            </button>
          ))}
          {balanceSats !== undefined && balanceSats > 0 && (
            <button
              onClick={() => { setLocalAmount(String(balanceSats)); setFeesIncluded(true); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                isSendAll
                  ? 'bg-spark-electric text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              Send All
            </button>
          )}
        </div>
      </div>

      <FormError error={error} />

      {/* Action buttons */}
      <div className="flex gap-3">
        <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton
          onClick={() => validAmount && onNext(parseInt(localAmount), feesIncluded)}
          disabled={isLoading || !validAmount}
          className="flex-1"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <SpinnerIcon />
              Processing...
            </span>
          ) : 'Continue'}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default AmountStep;
