import React, { useEffect, useState, useMemo } from 'react';
import type { ConversionOptions } from '@breeztech/breez-sdk-spark';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { SpinnerIcon } from '../../../components/Icons';
import {
  TOKEN_QUICK_AMOUNTS,
  SATS_QUICK_AMOUNTS,
  formatQuickAmount,
} from '../../../utils/tokenFormatting';
import CurrencySwitcher from '../../../components/ui/CurrencySwitcher';
import { useAmountInput } from '../../../hooks/useAmountInput';
import { useBalanceValidation } from '../hooks/useBalanceValidation';
import { dismissKeyboard } from '../../../utils/keyboard';

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
  const input = useAmountInput({ initialAmount: amount, balanceSats, tokenBalance });
  const {
    amountInput: localAmount,
    setAmount,
    setAmountInput: setLocalAmount,
    isTokenMode,
    setIsTokenMode,
    toggleDenomination,
    isStableBalanceActive,
    tokenIdentifier,
    tokenSymbol,
    config,
    parseToSats,
    tokenBalanceDisplay,
    formatSatsAsTokenDisplay,
    tokenSendAllBelowThreshold,
  } = input;

  const balance = useBalanceValidation(isTokenMode, setIsTokenMode, balanceSats, tokenBalance);

  const [feesIncluded, setFeesIncluded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Sync the parent-provided amount into the input when it changes (e.g. when
  // the dialog re-opens with a prior value).
  useEffect(() => {
    setLocalAmount(amount || '');
  }, [amount, setLocalAmount]);

  const handleToggleDenomination = () => {
    toggleDenomination();
    setFeesIncluded(false);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value);
    setFeesIncluded(false);
  };

  const validAmount = isTokenMode
    ? localAmount !== '' && parseFloat(localAmount) > 0
    : localAmount !== '' && parseInt(localAmount) > 0;

  const quickAmounts = isTokenMode ? TOKEN_QUICK_AMOUNTS : SATS_QUICK_AMOUNTS;
  const amountNum = isTokenMode ? parseFloat(localAmount) || 0 : parseInt(localAmount) || 0;

  // Send All target value in BTC-as-fiat (when in token mode without a token
  // balance). null when not applicable or rounds below displayable.
  const sendAllBtcInTokenDisplay = balanceSats !== undefined ? formatSatsAsTokenDisplay(balanceSats) : null;
  const hasTokenBalance = tokenBalance !== undefined && tokenBalance > 0n;
  const showSendAll = hasTokenBalance || (balanceSats !== undefined && balanceSats > 0);

  const isSendAllToken = isTokenMode && hasTokenBalance && localAmount === tokenBalanceDisplay && feesIncluded;
  const isSendAllBtcInTokenMode = isTokenMode
    && !hasTokenBalance
    && sendAllBtcInTokenDisplay !== null
    && localAmount === sendAllBtcInTokenDisplay
    && feesIncluded;
  const isSendAllSats = !isTokenMode && balanceSats !== undefined && amountNum === balanceSats && feesIncluded;
  const isSendAll = isSendAllSats || isSendAllToken || isSendAllBtcInTokenMode;

  const handleNext = async () => {
    if (!validAmount) return;
    setLocalError(null);

    // Dismiss the keyboard before advancing to confirm: the confirm
    // step has no inputs and shouldn't inherit an open keyboard.
    await dismissKeyboard();

    // Token send-all bypasses validation: amount goes directly as tokenBalance to the SDK
    if (isTokenMode && isSendAllToken && tokenBalance && tokenIdentifier) {
      onNext(
        tokenBalance,
        true,
        tokenIdentifier,
        { conversionType: { type: 'toBitcoin', fromTokenIdentifier: tokenIdentifier } },
      );
      return;
    }

    // BTC send-all displayed in token mode — pass the raw sats balance to
    // avoid losing precision through fiat→sats round-tripping.
    if (isSendAllBtcInTokenMode && balanceSats !== undefined) {
      onNext(BigInt(balanceSats), true);
      return;
    }

    const validationError = balance.validateAmount(localAmount, feesIncluded);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    // Safe to parse — validateAmount already confirmed the input is valid
    onNext(parseToSats(localAmount)!, feesIncluded);
  };

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
            enterKeyHint="done"
            value={localAmount}
            onChange={handleAmountChange}
            onKeyDown={async (e) => {
              // Enter on the amount field commits and advances to
              // the confirm step. Matches the soft keyboard's Done
              // action hint.
              if (e.key === 'Enter') {
                e.preventDefault();
                if (validAmount && !isLoading) {
                  await handleNext();
                }
              }
            }}
            placeholder={isTokenMode && tokenSymbol ? `Enter amount in ${tokenSymbol}` : 'Enter amount in satoshis'}
            className="w-full p-4 pr-16 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            disabled={isLoading}
            min={isTokenMode ? undefined : 1}
            data-testid="amount-input"
          />
          {isStableBalanceActive && tokenSymbol && (
            <CurrencySwitcher
              isTokenMode={isTokenMode}
              tokenSymbol={tokenSymbol}
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
                {formatQuickAmount(quickAmount, config, isTokenMode)}
              </button>
            );
          })}
          {showSendAll && (
            <button
              onClick={() => {
                if (!isTokenMode && balanceSats !== undefined) {
                  setLocalAmount(String(balanceSats));
                } else if (hasTokenBalance && tokenBalanceDisplay) {
                  // Token send-all: switch to token mode + show token balance
                  if (!isTokenMode) setIsTokenMode(true);
                  setLocalAmount(tokenBalanceDisplay);
                } else if (sendAllBtcInTokenDisplay !== null) {
                  // No token balance but in token mode — fill with BTC sats
                  // converted to fiat so the input stays in the user's chosen
                  // unit instead of jumping back to sats.
                  setLocalAmount(sendAllBtcInTokenDisplay);
                } else if (balanceSats !== undefined) {
                  // Sats mode (with or without stable balance)
                  setLocalAmount(String(balanceSats));
                }
                setFeesIncluded(true);
                setLocalError(null);
              }}
              disabled={tokenSendAllBelowThreshold}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                tokenSendAllBelowThreshold
                  ? 'opacity-40 cursor-not-allowed border border-spark-border text-spark-text-secondary'
                  : isSendAll
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
