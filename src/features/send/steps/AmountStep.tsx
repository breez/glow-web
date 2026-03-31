import React, { useEffect, useState } from 'react';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { SpinnerIcon } from '../../../components/Icons';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import {
  fiatToSats,
  TOKEN_QUICK_AMOUNTS,
  SATS_QUICK_AMOUNTS,
  formatQuickAmount,
  sanitizeTokenInput,
} from '../../../utils/tokenFormatting';
import CurrencySwitcher from '../../../components/ui/CurrencySwitcher';

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
  const stableBalance = useStableBalance();
  const hasTokenConfig = !!stableBalance.displayConfig;
  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive && hasTokenConfig);
  const config = stableBalance.displayConfig;

  const [localAmount, setLocalAmount] = useState<string>(amount || '');
  const [feesIncluded, setFeesIncluded] = useState(false);

  useEffect(() => {
    setLocalAmount(amount || '');
  }, [amount]);

  const handleToggleDenomination = () => {
    setIsTokenMode(prev => !prev);
    setLocalAmount('');
    setFeesIncluded(false);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (isTokenMode && config) {
      const sanitized = sanitizeTokenInput(value, config.fractionSize);
      if (sanitized !== null) {
        setLocalAmount(sanitized);
        setFeesIncluded(false);
      }
    } else {
      setLocalAmount(value);
      setFeesIncluded(false);
    }
  };

  const validAmount = isTokenMode
    ? localAmount !== '' && parseFloat(localAmount) > 0
    : localAmount !== '' && parseInt(localAmount) > 0;

  const [localError, setLocalError] = useState<string | null>(null);

  // Check whether a quick amount (in its native unit) exceeds the balance
  const exceedsBalance = (quickAmount: number): boolean => {
    if (balanceSats === undefined) return false;
    if (isTokenMode && config && stableBalance.btcFiatRate > 0) {
      return fiatToSats(quickAmount, stableBalance.btcFiatRate) > balanceSats;
    }
    return quickAmount > balanceSats;
  };


  const handleNext = () => {
    if (!validAmount) return;
    setLocalError(null);

    let sats: number;
    if (isTokenMode && config && stableBalance.btcFiatRate > 0) {
      const fiatAmount = parseFloat(localAmount);
      if (!fiatAmount || fiatAmount <= 0) return;
      sats = fiatToSats(fiatAmount, stableBalance.btcFiatRate);
    } else {
      sats = parseInt(localAmount);
      if (!sats || sats <= 0) return;
    }

    if (!feesIncluded && balanceSats !== undefined && sats > balanceSats) {
      setLocalError('Amount exceeds available balance');
      return;
    }

    onNext(sats, feesIncluded);
  };

  const quickAmounts = isTokenMode ? TOKEN_QUICK_AMOUNTS : SATS_QUICK_AMOUNTS;

  const amountNum = isTokenMode ? parseFloat(localAmount) || 0 : parseInt(localAmount) || 0;
  const showSendAll = !isTokenMode && balanceSats !== undefined && balanceSats > 0;
  const isSendAll = showSendAll && amountNum === balanceSats && feesIncluded;

  const amountLabel = 'Amount';

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
          {amountLabel}
        </label>
        <div className="relative">
          <input
            type={isTokenMode ? 'text' : 'number'}
            inputMode={isTokenMode ? 'decimal' : 'numeric'}
            value={localAmount}
            onChange={handleAmountChange}
            placeholder={isTokenMode && config ? `Enter amount in ${config.symbol}` : 'Enter amount in satoshis'}
            className="w-full p-4 pr-16 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            disabled={isLoading}
            min={isTokenMode ? undefined : 1}
            data-testid="amount-input"
          />
          {hasTokenConfig && config && (
            <CurrencySwitcher
              isTokenMode={isTokenMode}
              tokenSymbol={config.symbol}
              onSwitch={handleToggleDenomination}
              disabled={isLoading}
            />
          )}
        </div>

        {/* Quick amount buttons */}
        <div className="flex gap-2 mt-3">
          {quickAmounts.map((quickAmount) => {
            const disabled = exceedsBalance(quickAmount);
            const isSelected = amountNum === quickAmount && !isSendAll;
            return (
              <button
                key={quickAmount}
                onClick={() => { setLocalAmount(String(quickAmount)); setFeesIncluded(false); setLocalError(null); }}
                disabled={disabled}
                className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                  isSelected
                    ? 'bg-spark-electric text-white'
                    : disabled
                      ? 'opacity-40 cursor-not-allowed border border-spark-border text-spark-text-secondary'
                      : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                }`}
              >
                {formatQuickAmount(quickAmount, config, isTokenMode)}
              </button>
            );
          })}
          {showSendAll && (
            <button
              onClick={() => { setLocalAmount(String(balanceSats)); setFeesIncluded(true); setLocalError(null); }}
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

      <FormError error={localError || error} />

      {/* Action buttons */}
      <div className="flex gap-3">
        <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton
          onClick={handleNext}
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
