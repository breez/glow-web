import React, { useEffect, useState, useMemo } from 'react';
import type { ConversionOptions } from '@breeztech/breez-sdk-spark';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { SpinnerIcon } from '../../../components/Icons';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { useWallet } from '../../../contexts/WalletContext';
import {
  fiatToSats,
  getTokenBalance,
  TOKEN_QUICK_AMOUNTS,
  SATS_QUICK_AMOUNTS,
  formatQuickAmount,
  sanitizeTokenInput,
} from '../../../utils/tokenFormatting';
import CurrencySwitcher from '../../../components/ui/CurrencySwitcher';
import { dismissKeyboard } from '../../../utils/keyboard';

export interface AmountStepProps {
  paymentInput: string;
  amount: string;
  balanceSats?: number;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onNext: (amountSats: number, feesIncluded?: boolean, tokenIdentifier?: string, conversionOptions?: ConversionOptions) => void;
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
  const wallet = useWallet();
  const stableBalance = useStableBalance();
  const hasTokenConfig = !!stableBalance.displayConfig;
  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive && hasTokenConfig);
  const config = stableBalance.displayConfig;

  const [localAmount, setLocalAmount] = useState<string>(amount || '');
  const [feesIncluded, setFeesIncluded] = useState(false);
  const [tokenBalanceRaw, setTokenBalanceRaw] = useState<bigint | null>(null);

  // Fetch token balance for send-all in token mode
  useEffect(() => {
    if (!stableBalance.isActive || !stableBalance.tokenIdentifier) return;
    wallet.getInfo({}).then(info => {
      if (!info || !stableBalance.tokenIdentifier) return;
      const tb = getTokenBalance(info.tokenBalances, stableBalance.tokenIdentifier);
      setTokenBalanceRaw(tb?.balance ?? null);
    }).catch(() => {});
  }, [wallet, stableBalance.isActive, stableBalance.tokenIdentifier]);

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

  const handleNext = async () => {
    if (!validAmount) return;
    // Dismiss the keyboard before advancing to confirm — the confirm
    // step has no inputs and shouldn't inherit an open keyboard.
    await dismissKeyboard();
    if (isTokenMode && isSendAllToken && tokenBalanceRaw && stableBalance.tokenIdentifier) {
      // Send-all in token mode: pass token balance as amount with conversion options
      onNext(
        Number(tokenBalanceRaw),
        true,
        stableBalance.tokenIdentifier,
        { conversionType: { type: 'toBitcoin', fromTokenIdentifier: stableBalance.tokenIdentifier } },
      );
    } else if (isTokenMode && config && stableBalance.btcFiatRate > 0) {
      const fiatAmount = parseFloat(localAmount);
      if (!fiatAmount || fiatAmount <= 0) return;
      const sats = fiatToSats(fiatAmount, stableBalance.btcFiatRate);
      onNext(sats, feesIncluded);
    } else {
      const sats = parseInt(localAmount);
      if (!sats || sats <= 0) return;
      onNext(sats, feesIncluded);
    }
  };

  const quickAmounts = isTokenMode ? TOKEN_QUICK_AMOUNTS : SATS_QUICK_AMOUNTS;

  const amountNum = isTokenMode ? parseFloat(localAmount) || 0 : parseInt(localAmount) || 0;

  // Token send-all: format token balance as display string using BigInt math
  // (matches formatTokenAmount used by the balance header)
  const tokenBalanceDisplay = useMemo(() => {
    if (!tokenBalanceRaw || !config) return null;
    const { decimals, fractionSize } = config;
    const divisor = BigInt(10 ** decimals);
    const wholePart = tokenBalanceRaw / divisor;
    const fractionalPart = tokenBalanceRaw % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, fractionSize);
    return `${wholePart}.${fractionalStr}`;
  }, [tokenBalanceRaw, config]);

  // Send All: when stable balance is active, always use token path (switch to token mode if needed)
  // When stable balance is not active, use sats path
  const hasTokenBalance = tokenBalanceRaw !== null && tokenBalanceRaw > 0n;
  const showSendAll = hasTokenBalance || (!stableBalance.isActive && balanceSats !== undefined && balanceSats > 0);
  const isSendAllToken = isTokenMode && hasTokenBalance && localAmount === tokenBalanceDisplay && feesIncluded;
  const isSendAllSats = !isTokenMode && !stableBalance.isActive && balanceSats !== undefined && amountNum === balanceSats && feesIncluded;
  const isSendAll = isSendAllSats || isSendAllToken;

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
          {quickAmounts.map((quickAmount) => (
            <button
              key={quickAmount}
              onClick={() => { setLocalAmount(String(quickAmount)); setFeesIncluded(false); }}
              className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                amountNum === quickAmount && !isSendAll
                  ? 'bg-spark-primary text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              {formatQuickAmount(quickAmount, config, isTokenMode)}
            </button>
          ))}
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

      <FormError error={error} />

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
