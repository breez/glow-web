import React, { useEffect, useMemo } from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import {
  FormError,
  PrimaryButton,
  BottomSheetContainer,
  BottomSheetCard,
  DialogHeader,
} from '../../components/ui';
import { LightningBoltIcon } from '../../components/Icons';
import {
  TOKEN_QUICK_AMOUNTS,
  SATS_QUICK_AMOUNTS,
  formatQuickAmount,
} from '../../utils/tokenFormatting';
import CurrencySwitcher from '../../components/ui/CurrencySwitcher';
import { useAmountInput } from '../../hooks/useAmountInput';
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
  const input = useAmountInput();
  const {
    amountInput: displayAmount,
    setAmount,
    setAmountInput,
    resetAmount,
    isTokenMode,
    toggleDenomination,
    isStableBalanceActive,
    tokenSymbol,
    config,
    btcFiatRate,
    amountSats: parsedSats,
  } = input;

  // Push the hook's parsed sats up to the parent. Centralizes the contract:
  // parent always sees a validated Sats (or null) — never a raw string.
  useEffect(() => {
    setAmountSats(parsedSats);
  }, [parsedSats, setAmountSats]);

  // Clear the input when the dialog closes so it doesn't persist a stale
  // value on the next open.
  useEffect(() => {
    if (!isOpen) resetAmount();
  }, [isOpen, resetAmount]);

  const handleToggleDenomination = () => {
    toggleDenomination();
  };

  const handleAmountChange = (value: string) => {
    setAmount(value);
  };

  const handleQuickAmount = (quickAmount: number) => {
    setAmountInput(String(quickAmount));
  };

  const quickAmounts = isTokenMode ? TOKEN_QUICK_AMOUNTS : SATS_QUICK_AMOUNTS;

  const validAmount = amountSats !== null && amountSats > 0n;

  // "Invalid amount" surfaces when the input is non-empty and positive but
  // can't safely be converted to sats — covers both unsafe-integer overflow
  // (fiat or sats) and unsafe results from fiat→sats conversion.
  const amountTooLarge = useMemo(() => {
    if (displayAmount === '' || parsedSats !== null) return false;
    const numeric = Number(displayAmount);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;
    const projectedSats = isTokenMode && btcFiatRate > 0
      ? (numeric / btcFiatRate) * 100_000_000
      : numeric;
    return projectedSats > Number.MAX_SAFE_INTEGER;
  }, [displayAmount, parsedSats, isTokenMode, btcFiatRate]);

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
              {isStableBalanceActive && tokenSymbol && (
                <CurrencySwitcher
                  isTokenMode={isTokenMode}
                  tokenSymbol={tokenSymbol}
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
