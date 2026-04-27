import React, { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import {
  FormError,
  PrimaryButton,
  BottomSheetContainer,
  BottomSheetCard,
  DialogHeader,
} from '../../components/ui';
import { LightningBoltIcon } from '../../components/Icons';
import { useStableBalance } from '../../contexts/StableBalanceContext';
import {
  TOKEN_QUICK_AMOUNTS,
  SATS_QUICK_AMOUNTS,
  formatQuickAmount,
  sanitizeTokenInput,
  parseAmountToSats,
} from '../../utils/tokenFormatting';
import CurrencySwitcher from '../../components/ui/CurrencySwitcher';
import type { Sats } from '../../types/sats';

interface AmountPanelProps {
  isOpen: boolean;
  /** Validated amount in sats; null when the input is empty or invalid. */
  amountSats: Sats | null;
  setAmountSats: (sats: Sats | null) => void;
  description: string;
  setDescription: (v: string) => void;
  limits: { min: number; max: number };
  isLoading: boolean;
  error: string | null;
  onCreateInvoice: () => void;
  onClose: () => void;
}

const AmountPanel: React.FC<AmountPanelProps> = ({
  isOpen,
  amountSats,
  setAmountSats,
  description,
  setDescription,
  limits: _limits,
  isLoading,
  error,
  onCreateInvoice,
  onClose,
}) => {
  const stableBalance = useStableBalance();
  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive);
  const config = stableBalance.displayConfig;

  // The display string for the input field. In token mode this holds fiat;
  // in sats mode it holds sats. The parsed sats value is pushed to the parent
  // separately so there's no string-passing round trip.
  const [displayAmount, setDisplayAmount] = useState('');

  const handleToggleDenomination = () => {
    setIsTokenMode(prev => !prev);
    setAmountSats(null);
    setDisplayAmount('');
  };

  // Force the input back to sats mode when stable balance is deactivated.
  // Without this, the CurrencySwitcher disappears but isTokenMode stays true,
  // leaving the input showing a fiat value that's no longer toggleable.
  useEffect(() => {
    if (!stableBalance.isActive && isTokenMode) {
      setIsTokenMode(false);
      setAmountSats(null);
      setDisplayAmount('');
    }
  }, [stableBalance.isActive, isTokenMode, setAmountSats]);

  const quickAmounts = isTokenMode ? TOKEN_QUICK_AMOUNTS : SATS_QUICK_AMOUNTS;

  // Push parsed Sats to the parent. parseAmountToSats handles the safe-integer
  // guard, so the parent always gets either a validated Sats or null.
  const pushSats = (display: string) => {
    setAmountSats(parseAmountToSats(display, isTokenMode, stableBalance.btcFiatRate));
  };

  const handleAmountChange = (value: string) => {
    if (isTokenMode && config) {
      const sanitized = sanitizeTokenInput(value, config.fractionSize);
      if (sanitized !== null) {
        setDisplayAmount(sanitized);
        pushSats(sanitized);
      }
    } else {
      const sats = value.replace(/[^0-9]/g, '');
      setDisplayAmount(sats);
      pushSats(sats);
    }
  };

  const handleQuickAmount = (quickAmount: number) => {
    const sanitized = String(quickAmount);
    setDisplayAmount(sanitized);
    pushSats(sanitized);
  };

  const validAmount = amountSats !== null && amountSats > 0n;

  // "Invalid amount" surfaces when the input is non-empty and positive but
  // can't safely be converted to sats — covers both unsafe-integer overflow
  // (fiat or sats) and unsafe results from fiat→sats conversion.
  const amountTooLarge = useMemo(() => {
    if (displayAmount === '' || amountSats !== null) return false;
    const numeric = Number(displayAmount);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;
    const projectedSats = isTokenMode && stableBalance.btcFiatRate > 0
      ? (numeric / stableBalance.btcFiatRate) * 100_000_000
      : numeric;
    return projectedSats > Number.MAX_SAFE_INTEGER;
  }, [displayAmount, amountSats, isTokenMode, stableBalance.btcFiatRate]);

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose} showBackdrop>
      <BottomSheetCard>
        <DialogHeader
          title="Create Invoice"
          onClose={onClose}
          icon={<LightningBoltIcon />}
        />

        {/* Amount Input */}
        <div className="space-y-4">
          <div>
            <label className="block text-spark-text-secondary text-sm font-medium mb-2">
              Amount
            </label>
            <div className="relative">
              <textarea
                inputMode={isTokenMode ? 'decimal' : 'numeric'}
                value={displayAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                placeholder={isTokenMode ? '0.00' : '0'}
                disabled={isLoading}
                rows={1}
                className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 pr-16 text-spark-text-primary text-lg font-mono placeholder-spark-text-muted focus-within:border-spark-primary focus:outline-none transition-all resize-none"
                data-testid="invoice-amount-input"
              />
              {stableBalance.isActive && config && (
                <CurrencySwitcher
                  isTokenMode={isTokenMode}
                  tokenSymbol={config.symbol}
                  onSwitch={handleToggleDenomination}
                  disabled={isLoading}
                />
              )}
            </div>
          </div>

          {/* Quick amount buttons */}
          <div className="flex gap-2">
            {quickAmounts.map((quickAmount) => (
              <button
                key={quickAmount}
                type="button"
                onClick={() => handleQuickAmount(quickAmount)}
                disabled={isLoading}
                className={`
                  flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all
                  ${displayAmount === String(quickAmount)
                    ? 'bg-spark-primary text-black'
                    : 'bg-spark-elevated border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                  }
                `}
              >
                {formatQuickAmount(quickAmount, config, isTokenMode)}
              </button>
            ))}
          </div>

          {/* Description */}
          <div>
            <label className="block text-spark-text-secondary text-sm font-medium mb-2">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.replace(/\n/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              placeholder="What's this for?"
              disabled={isLoading}
              rows={1}
              className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:outline-none transition-all resize-none"
            />
          </div>

          <FormError error={amountTooLarge ? 'Invalid amount' : error} data-testid="invoice-error-message" />

          {/* Generate Button */}
          <PrimaryButton
            onClick={onCreateInvoice}
            type="submit"
            disabled={isLoading || !validAmount}
            className="w-full"
            data-testid="generate-invoice-button"
          >
            {isLoading ? <LoadingSpinner size="small" /> : 'Generate Invoice'}
          </PrimaryButton>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default AmountPanel;
