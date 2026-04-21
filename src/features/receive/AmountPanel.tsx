import React, { useState, useRef, useEffect } from 'react';
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
  formatQuickAmount,
  sanitizeTokenInput,
  fiatToSats,
} from '../../utils/tokenFormatting';
import CurrencySwitcher from '../../components/ui/CurrencySwitcher';
import { dismissKeyboard } from '../../utils/keyboard';
import { LIGHTNING_INVOICE_MIN_SATS, LIGHTNING_INVOICE_MAX_SATS } from '../../constants/receive';

interface AmountPanelProps {
  isOpen: boolean;
  amount: string;
  setAmount: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  isLoading: boolean;
  error: string | null;
  onCreateInvoice: () => void;
  onClose: () => void;
  // Monotonically-increasing counter from `useReceivePayment.reset()`.
  // Every bump clears this panel's local `displayAmount` +
  // `isTokenMode` state. Needed because the outer BottomSheet keeps
  // AmountPanel mounted across dialog opens (`unmount={false}`), so
  // without an explicit reset signal the previously-typed amount and
  // fiat-mode toggle would linger when the user reopens the dialog
  // later.
  resetCount: number;
}

const RECEIVE_QUICK_AMOUNTS_SATS = [100, 1000, 10000, 100000];

const AmountPanel: React.FC<AmountPanelProps> = ({
  isOpen,
  amount,
  setAmount,
  description,
  setDescription,
  isLoading,
  error,
  onCreateInvoice,
  onClose,
  resetCount,
}) => {
  const stableBalance = useStableBalance();
  const hasTokenConfig = !!stableBalance.displayConfig;
  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive && hasTokenConfig);
  const config = stableBalance.displayConfig;

  // In token mode we show the fiat value locally; the parent's `amount` always holds sats.
  const [displayAmount, setDisplayAmount] = useState('');
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Clear local state whenever the parent dialog calls
  // `useReceivePayment.reset()` (which bumps `resetCount`). Without
  // this, `displayAmount` + `isTokenMode` persist across dialog
  // open/close cycles because the outer BottomSheet keeps this
  // subtree mounted (`unmount={false}`). Skipping the initial
  // render (resetCount === 0) so the token-mode default picked
  // from `stableBalance.isActive && hasTokenConfig` on first mount
  // stays untouched.
  useEffect(() => {
    if (resetCount === 0) return;
    setDisplayAmount('');
    setIsTokenMode(stableBalance.isActive && hasTokenConfig);
  }, [resetCount, stableBalance.isActive, hasTokenConfig]);

  const handleToggleDenomination = () => {
    setIsTokenMode(prev => !prev);
    setAmount('');
    setDisplayAmount('');
  };

  const quickAmounts = isTokenMode ? TOKEN_QUICK_AMOUNTS : RECEIVE_QUICK_AMOUNTS_SATS;

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

  // Range-aware validity check. Mirrors the guard in
  // `useReceivePayment.generateBolt11Invoice` so the UI disables the
  // Generate button + Enter-to-submit path for amounts outside the
  // configured Lightning-invoice receive bounds. Works in both sats
  // and token mode because `amount` always holds the sats value (the
  // token-mode input converts fiat → sats via `fiatToSats` on change).
  const parsedAmount = parseInt(amount);
  const validAmount = amount !== ''
    && !isNaN(parsedAmount)
    && parsedAmount >= LIGHTNING_INVOICE_MIN_SATS
    && parsedAmount <= LIGHTNING_INVOICE_MAX_SATS;

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
            <div className="flex items-center justify-between mb-2">
              <label className="block text-spark-text-secondary text-sm font-medium">
                Amount
              </label>
              {/* Range badge — matches LnurlWorkflow's Send-side
                  treatment at features/send/workflows/LnurlWorkflow.tsx.
                  Uses plain "sats" (not ₿) per CLAUDE.md:
                  "Range displays and placeholders use 'sats' text,
                  not ₿". Thin-space separators on the max value match
                  the Send-side formatting. */}
              <span className="text-xs text-spark-text-muted">
                {LIGHTNING_INVOICE_MIN_SATS.toLocaleString('en-US').replace(/,/g, ' ')} – {LIGHTNING_INVOICE_MAX_SATS.toLocaleString('en-US').replace(/,/g, ' ')} sats
              </span>
            </div>
            <div className="relative">
              <textarea
                inputMode={isTokenMode ? 'decimal' : 'numeric'}
                enterKeyHint="next"
                value={displayAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                onKeyDown={(e) => {
                  // Enter on the amount field advances to the
                  // description field (the soft keyboard's Next
                  // action). Never inserts a newline.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    descriptionInputRef.current?.focus();
                  }
                }}
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
              ref={descriptionInputRef}
              enterKeyHint="done"
              value={description}
              onChange={(e) => setDescription(e.target.value.replace(/\n/g, ''))}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // Always retract the keyboard on Enter. Commit
                  // only if the amount is valid and we're not
                  // already generating.
                  await dismissKeyboard();
                  if (validAmount && !isLoading) {
                    onCreateInvoice();
                  }
                }
              }}
              placeholder="What's this for?"
              disabled={isLoading}
              rows={1}
              className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:outline-none transition-all resize-none"
            />
          </div>

          <FormError error={error} data-testid="invoice-error-message" />

          {/* Generate Button */}
          <PrimaryButton
            onClick={async () => {
              // Dismiss the keyboard before kicking off the network
              // roundtrip so the user sees the loading state and the
              // resulting invoice QR unobstructed.
              await dismissKeyboard();
              onCreateInvoice();
            }}
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
