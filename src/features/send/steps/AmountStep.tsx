import React, { useEffect, useState } from 'react';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';

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
  const [feesManuallySet, setFeesManuallySet] = useState(false);

  useEffect(() => {
    setLocalAmount(amount || '');
  }, [amount]);

  const validAmount = localAmount && parseInt(localAmount) > 0;
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
          onChange={(e) => { setLocalAmount(e.target.value); if (!feesManuallySet) setFeesIncluded(false); }}
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
              onClick={() => { setLocalAmount(String(quickAmount)); if (!feesManuallySet) setFeesIncluded(false); }}
              className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                amountNum === quickAmount && !isSendAll
                  ? 'bg-spark-electric text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              {quickAmount.toLocaleString('en-US').replace(/,/g, '\u2009')}
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
        {/* Include fees toggle */}
        <div
          className="flex items-center justify-between mt-3 p-3 rounded-xl select-none"
          data-testid="fees-included-toggle"
        >
          <div>
            <span className="text-sm font-medium text-spark-text-primary">Include fees</span>
            <p className="text-xs text-spark-text-secondary mt-0.5">
              Fees are deducted from the amount you enter
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={feesIncluded}
            onClick={() => { setFeesIncluded(!feesIncluded); setFeesManuallySet(!feesIncluded); }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
              feesIncluded ? 'bg-spark-warning' : 'bg-spark-border'
            }`}
            data-testid="fees-included-switch"
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                feesIncluded ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
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
              <span className="w-5 h-5 animate-spin">
                <svg className="w-full h-full" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </span>
              Processing...
            </span>
          ) : 'Continue'}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default AmountStep;
