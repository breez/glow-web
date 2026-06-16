import React, { useRef, useEffect, useMemo } from 'react';
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
import { dismissKeyboard } from '../../utils/keyboard';
import { LIGHTNING_INVOICE_MIN_SATS, LIGHTNING_INVOICE_MAX_SATS } from '../../constants/receive';

interface AmountPanelProps {
  isOpen: boolean;
  /** Validated amount in sats; null when the input is empty or invalid. */
  amountSats: Sats | null;
  setAmountSats: (sats: Sats | null) => void;
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

const AmountPanel: React.FC<AmountPanelProps> = ({
  isOpen,
  amountSats,
  setAmountSats,
  description,
  setDescription,
  isLoading,
  error,
  onCreateInvoice,
  onClose,
  resetCount,
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

  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Push the hook's parsed sats up to the parent. Centralizes the contract:
  // parent always sees a validated Sats (or null), never a raw string.
  useEffect(() => {
    setAmountSats(parsedSats);
  }, [parsedSats, setAmountSats]);

  // Clear local state whenever the parent dialog calls
  // `useReceivePayment.reset()` or `closeAmountPanel()`, which bumps
  // `resetCount`. Without this, `displayAmount` + `isTokenMode` persist
  // across dialog open/close cycles because the outer BottomSheet keeps
  // this subtree mounted (`unmount={false}`). Skipping the initial
  // render (resetCount === 0) so the token-mode default picked from
  // `useAmountInput` on first mount stays untouched.
  useEffect(() => {
    if (resetCount === 0) return;
    resetAmount();
  }, [resetCount, resetAmount]);

  // Also clear when the dialog closes via the `isOpen` prop, so the
  // input doesn't persist a stale value on the next open even if the
  // parent hasn't bumped `resetCount`.
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

  // Range-aware validity check. Mirrors the guard in
  // `useReceivePayment.generateBolt11Invoice` so the UI disables the
  // Generate button + Enter-to-submit path for amounts outside the
  // configured Lightning-invoice receive bounds. Works in both sats
  // and token mode because the parsed sats are produced by
  // `useAmountInput` regardless of denomination.
  const validAmount = amountSats !== null
    && amountSats >= BigInt(LIGHTNING_INVOICE_MIN_SATS)
    && amountSats <= BigInt(LIGHTNING_INVOICE_MAX_SATS);

  // "Invalid amount" surfaces when the input is non-empty and positive but
  // can't safely be converted to sats: covers both unsafe-integer overflow
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
                className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 pr-16 text-spark-text-primary text-lg font-mono placeholder-spark-text-muted focus-within:border-spark-primary focus:outline-hidden transition-all resize-none"
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

          {/* Quick amount buttons. Hidden while the native keyboard is
              up: this is the tallest sheet form, and with the row kept
              the amount/description fields get pushed into inner
              scrolling, which makes focus switches jump. */}
          <div className="flex gap-2 hide-on-keyboard">
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
              className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:outline-hidden transition-all resize-none"
            />
          </div>

          <FormError error={amountTooLarge ? 'Invalid amount' : error} data-testid="invoice-error-message" />

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
