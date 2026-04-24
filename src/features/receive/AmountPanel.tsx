import React, { useState } from 'react';
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
  fiatToSats,
} from '../../utils/tokenFormatting';
import CurrencySwitcher from '../../components/ui/CurrencySwitcher';

interface AmountPanelProps {
  isOpen: boolean;
  amount: string;
  setAmount: (v: string) => void;
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
  amount,
  setAmount,
  description,
  setDescription,
  limits: _limits,
  isLoading,
  error,
  onCreateInvoice,
  onClose,
}) => {
  const stableBalance = useStableBalance();
  const hasTokenConfig = !!stableBalance.displayConfig;
  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive && hasTokenConfig);
  const config = stableBalance.displayConfig;

  // In token mode we show the fiat value locally; the parent's `amount` always holds sats.
  const [displayAmount, setDisplayAmount] = useState('');

  const handleToggleDenomination = () => {
    setIsTokenMode(prev => !prev);
    setAmount('');
    setDisplayAmount('');
  };

  const quickAmounts = isTokenMode ? TOKEN_QUICK_AMOUNTS : SATS_QUICK_AMOUNTS;

  const handleAmountChange = (value: string) => {
    if (isTokenMode && config) {
      const sanitized = sanitizeTokenInput(value, config.fractionSize);
      if (sanitized !== null) {
        setDisplayAmount(sanitized);
        const fiat = parseFloat(sanitized);
        if (fiat > 0 && stableBalance.btcFiatRate > 0) {
          setAmount(String(fiatToSats(fiat, stableBalance.btcFiatRate)));
        } else {
          setAmount('');
        }
      }
    } else {
      const sats = value.replace(/[^0-9]/g, '');
      setAmount(sats);
      setDisplayAmount(sats);
    }
  };

  const handleQuickAmount = (quickAmount: number) => {
    if (isTokenMode && stableBalance.btcFiatRate > 0) {
      setDisplayAmount(String(quickAmount));
      setAmount(String(fiatToSats(quickAmount, stableBalance.btcFiatRate)));
    } else {
      setDisplayAmount(String(quickAmount));
      setAmount(String(quickAmount));
    }
  };

  const validAmount = amount !== '' && parseInt(amount) > 0;

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
              {hasTokenConfig && config && (
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

          <FormError error={error} data-testid="invoice-error-message" />

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
