import React, { useEffect, useState, useMemo } from 'react';
import type { ConversionOptions } from '@breeztech/breez-sdk-spark';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { SpinnerIcon } from '../../../components/Icons';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import {
  TOKEN_QUICK_AMOUNTS,
  SATS_QUICK_AMOUNTS,
  formatQuickAmount,
  sanitizeTokenInput,
} from '../../../utils/tokenFormatting';
import CurrencySwitcher from '../../../components/ui/CurrencySwitcher';
import { useBalanceValidation } from '../hooks/useBalanceValidation';

export interface AmountStepProps {
  paymentInput: string;
  amount: string;
  balanceSats?: number;
  tokenBalance?: bigint;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onNext: (amount: bigint, feesIncluded?: boolean, tokenIdentifier?: string, conversionOptions?: ConversionOptions) => void;
}

const AmountStep: React.FC<AmountStepProps> = ({
  paymentInput,
  amount,
  balanceSats,
  tokenBalance,
  isLoading,
  error,
  onBack,
  onNext,
}) => {
  const stableBalance = useStableBalance();
  const hasTokenConfig = !!stableBalance.displayConfig;
  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive && hasTokenConfig);
  const balance = useBalanceValidation(isTokenMode, setIsTokenMode, balanceSats, tokenBalance);

  const [localAmount, setLocalAmount] = useState<string>(amount || '');
  const [feesIncluded, setFeesIncluded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setLocalAmount(amount || '');
  }, [amount]);

  const handleToggleDenomination = () => {
    balance.setIsTokenMode?.(!isTokenMode);
    setLocalAmount('');
    setFeesIncluded(false);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (isTokenMode && balance.config) {
      const sanitized = sanitizeTokenInput(value, balance.config.fractionSize);
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

  const handleNext = () => {
    if (!validAmount) return;
    setLocalError(null);

    // Token send-all bypasses validation — amount goes directly as tokenBalance to the SDK
    if (isTokenMode && isSendAllToken && tokenBalance && stableBalance.tokenIdentifier) {
      onNext(
        tokenBalance,
        true,
        stableBalance.tokenIdentifier,
        { conversionType: { type: 'toBitcoin', fromTokenIdentifier: stableBalance.tokenIdentifier } },
      );
      return;
    }

    const validationError = balance.validateAmount(localAmount, feesIncluded);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    // Safe to parse — validateAmount already confirmed the input is valid
    onNext(balance.parseInputToSats(localAmount)!, feesIncluded);
  };

  const quickAmounts = isTokenMode ? TOKEN_QUICK_AMOUNTS : SATS_QUICK_AMOUNTS;
  const amountNum = isTokenMode ? parseFloat(localAmount) || 0 : parseInt(localAmount) || 0;

  // Token send-all: format token balance as display string using BigInt math
  // (matches formatTokenAmount used by the balance header)
  const tokenBalanceDisplay = useMemo(() => {
    if (!tokenBalance || !balance.config) return null;
    const { decimals, fractionSize } = balance.config;
    const divisor = BigInt(10 ** decimals);
    const wholePart = tokenBalance / divisor;
    const fractionalPart = tokenBalance % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, fractionSize);
    return `${wholePart}.${fractionalStr}`;
  }, [tokenBalance, balance.config]);

  // Send All: when stable balance is active, always use token path (switch to token mode if needed)
  // When stable balance is not active, use sats path
  const hasTokenBalance = tokenBalance !== undefined && tokenBalance > 0n;
  const showSendAll = hasTokenBalance || (!stableBalance.isActive && balanceSats !== undefined && balanceSats > 0);
  const isSendAllToken = isTokenMode && hasTokenBalance && localAmount === tokenBalanceDisplay && feesIncluded;
  const isSendAllSats = !isTokenMode && !stableBalance.isActive && balanceSats !== undefined && amountNum === balanceSats && feesIncluded;
  const isSendAll = isSendAllSats || isSendAllToken;

  // Inline balance error — surface "Amount exceeds available balance" as the
  // user types instead of waiting for them to click Continue. Skipped for
  // empty/zero input (don't nag while still typing) and for send-all
  // (which intentionally fills the full balance with feesIncluded on).
  const inlineBalanceError = useMemo(() => {
    if (amountNum <= 0) return null;
    if (isSendAll) return null;
    return balance.exceedsBalance(amountNum) ? 'Amount exceeds available balance' : null;
  }, [amountNum, isSendAll, balance]);

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
          Amount
        </label>
        <div className="relative">
          <input
            type={isTokenMode ? 'text' : 'number'}
            inputMode={isTokenMode ? 'decimal' : 'numeric'}
            value={localAmount}
            onChange={handleAmountChange}
            placeholder={isTokenMode && balance.config ? `Enter amount in ${balance.config.symbol}` : 'Enter amount in satoshis'}
            className="w-full p-4 pr-16 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            disabled={isLoading}
            min={isTokenMode ? undefined : 1}
            data-testid="amount-input"
          />
          {hasTokenConfig && balance.config && (
            <CurrencySwitcher
              isTokenMode={isTokenMode}
              tokenSymbol={balance.config.symbol}
              onSwitch={handleToggleDenomination}
              disabled={isLoading}
            />
          )}
        </div>

        {/* Quick amount buttons */}
        <div className="flex gap-2 mt-3">
          {quickAmounts.map((quickAmount) => {
            const disabled = balance.exceedsBalance(quickAmount);
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
                {formatQuickAmount(quickAmount, balance.config, isTokenMode)}
              </button>
            );
          })}
          {showSendAll && (
            <button
              onClick={() => {
                if (hasTokenBalance && tokenBalanceDisplay) {
                  // When stable balance is active, always use token path
                  if (!isTokenMode) setIsTokenMode(true);
                  setLocalAmount(tokenBalanceDisplay);
                } else {
                  setLocalAmount(String(balanceSats));
                }
                setFeesIncluded(true);
                setLocalError(null);
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                isSendAll
                  ? 'bg-spark-primary text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              Send All
            </button>
          )}
        </div>
      </div>

      <FormError error={inlineBalanceError || localError || error} />

      {/* Action buttons */}
      <div className="flex gap-3">
        <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton
          onClick={handleNext}
          disabled={isLoading || !validAmount || !!inlineBalanceError}
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
