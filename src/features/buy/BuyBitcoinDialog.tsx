import React, { useCallback, useRef } from 'react';
import {
  BottomSheetContainer,
  BottomSheetCard,
  DialogHeader,
  PrimaryButton,
  FormError,
  QRCodeContainer,
  CopyableText,
  LoadingSpinner,
} from '../../components/ui';
import CurrencySwitcher from '../../components/ui/CurrencySwitcher';
import type { Network } from '@breeztech/breez-sdk-spark';
import { CurrencyIcon, MoonPayIcon, CashAppIcon } from '../../components/Icons';
import { type BuyBitcoinProvider } from '../../services/settings';
import { useToast } from '../../contexts/ToastContext';
import { formatQuickAmount } from '../../utils/tokenFormatting';
import { useBuyBitcoin } from './hooks/useBuyBitcoin';

const providerMeta: Record<BuyBitcoinProvider, { name: string; icon: React.ReactNode; loadingIcon: React.ReactNode }> = {
  moonpay: {
    name: 'MoonPay',
    icon: (
      <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shrink-0 p-2">
        <MoonPayIcon className="w-full h-full text-[#7B36D9]" />
      </div>
    ),
    loadingIcon: (
      <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shrink-0 p-2 animate-pulse">
        <MoonPayIcon className="w-full h-full text-[#7B36D9]" />
      </div>
    ),
  },
  cashApp: {
    name: 'Cash App',
    icon: (
      <div className="w-11 h-11 rounded-xl bg-[#00D64F] flex items-center justify-center shrink-0 p-1">
        <CashAppIcon className="w-full h-full text-[#00D64F]" />
      </div>
    ),
    loadingIcon: (
      <div className="w-11 h-11 rounded-xl bg-[#00D64F] flex items-center justify-center shrink-0 p-1 animate-pulse">
        <CashAppIcon className="w-full h-full text-[#00D64F]" />
      </div>
    ),
  },
};

const cashAppHeaderIcon = (
  <div className="w-5 h-5 rounded-sm bg-[#00D64F] flex items-center justify-center p-0.5">
    <CashAppIcon className="w-full h-full text-[#00D64F]" />
  </div>
);

/**
 * Upper bound on waiting for the sheet's 200ms leave transition before
 * redirecting anyway. The afterLeave callback never fires while the page
 * is hidden (rAF is paused), so the wait must not be unbounded or the
 * user would be stranded on the pre-opened blank tab.
 */
const SHEET_LEAVE_WAIT_MS = 400;

interface BuyBitcoinDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onBuyBitcoin: (
    provider: BuyBitcoinProvider,
    closeAndWaitForLeave?: () => Promise<void>,
  ) => Promise<void>;
  network?: Network;
}

const BuyBitcoinDialog: React.FC<BuyBitcoinDialogProps> = ({
  isOpen,
  onClose,
  onBuyBitcoin,
  network,
}) => {
  const { showToast } = useToast();

  const pendingLeaveWaiters = useRef<Array<() => void>>([]);

  const handleAfterLeave = useCallback(() => {
    const waiters = pendingLeaveWaiters.current;
    pendingLeaveWaiters.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  // Close the sheet, then wait for its leave transition so the page is
  // never snapshotted (bfcache) or frozen mid-close when a buy flow
  // navigates away (breez/glow-web#213). afterLeave is raced against a
  // bounded timeout, and skipped entirely when the page is already hidden
  // (a pre-opened blank tab is in the foreground): in those cases the
  // animation cannot play at all and the stuck-close state is repaired by
  // BottomSheetContainer's self-heal when the user returns.
  const closeAndWaitForLeave = useCallback(() => {
    onClose();
    if (document.visibilityState === 'hidden') return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(settle, SHEET_LEAVE_WAIT_MS);
      pendingLeaveWaiters.current.push(settle);
    });
  }, [onClose]);

  const handleRedirectProvider = useCallback(
    (provider: BuyBitcoinProvider) => onBuyBitcoin(provider, closeAndWaitForLeave),
    [onBuyBitcoin, closeAndWaitForLeave],
  );

  const buy = useBuyBitcoin({
    isOpen,
    network,
    onSelectRedirectProvider: handleRedirectProvider,
    closeAndWaitForLeave,
    onInvoicePaid: onClose,
  });

  return (
    <BottomSheetContainer
      isOpen={isOpen}
      onClose={onClose}
      showBackdrop
      afterLeave={handleAfterLeave}
    >
      <BottomSheetCard>
        {buy.step === 'select' && (
          <>
            <DialogHeader
              title="Buy Bitcoin"
              onClose={onClose}
              icon={<CurrencyIcon size="md" />}
            />
            <div className="space-y-3">
              {buy.enabledProviders.map((provider) => {
                const meta = providerMeta[provider];
                const isLoading = buy.redirectingProvider === provider;
                return (
                  <button
                    key={provider}
                    onClick={() => void buy.selectProvider(provider)}
                    disabled={buy.redirectingProvider !== null}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border border-spark-border hover:border-spark-primary/40 hover:bg-spark-primary/5 transition-all text-left disabled:opacity-50"
                  >
                    {isLoading ? meta.loadingIcon : meta.icon}
                    <span className="font-display font-semibold text-spark-text-primary text-sm">
                      {isLoading ? 'Redirecting…' : meta.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {buy.step === 'amount' && (
          <>
            <DialogHeader
              title="Buy with Cash App"
              onClose={onClose}
              onBack={buy.goBackToSelect}
              icon={cashAppHeaderIcon}
            />
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-spark-text-primary mb-2">
                  Amount
                </label>
                <div className="relative">
                  <input
                    type={buy.isTokenMode ? 'text' : 'number'}
                    inputMode={buy.isTokenMode ? 'decimal' : 'numeric'}
                    value={buy.amountInput}
                    onChange={(e) => buy.setAmount(e.target.value)}
                    placeholder={
                      buy.isTokenMode && buy.tokenConfig
                        ? `Enter amount in ${buy.tokenConfig.symbol}`
                        : 'Enter amount in satoshis'
                    }
                    disabled={buy.isGenerating}
                    min={buy.isTokenMode ? undefined : 1}
                    className="w-full p-4 pr-16 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    data-testid="cashapp-amount-input"
                  />
                  {buy.isStableBalanceActive && buy.tokenConfig && (
                    <CurrencySwitcher
                      isTokenMode={buy.isTokenMode}
                      tokenSymbol={buy.tokenConfig.symbol}
                      onSwitch={buy.toggleDenomination}
                      disabled={buy.isGenerating}
                    />
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                {buy.quickAmounts.map((quickAmount) => (
                  <button
                    key={quickAmount}
                    type="button"
                    onClick={() => buy.setQuickAmount(quickAmount)}
                    disabled={buy.isGenerating}
                    className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                      buy.amountInput === String(quickAmount)
                        ? 'bg-spark-primary text-white'
                        : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                    }`}
                  >
                    {formatQuickAmount(quickAmount, buy.tokenConfig, buy.isTokenMode)}
                  </button>
                ))}
              </div>

              <p className="text-xs text-spark-text-muted">
                Cash App will show the equivalent amount in your local currency and charge your Cash or BTC balance.
              </p>

              <FormError error={buy.error} />

              <PrimaryButton
                onClick={buy.generate}
                disabled={buy.isGenerating || !buy.validAmount}
                className="w-full"
                data-testid="cashapp-continue-button"
              >
                {buy.isGenerating ? <LoadingSpinner size="small" /> : 'Continue'}
              </PrimaryButton>
            </div>
          </>
        )}

        {buy.step === 'qr' && buy.cashAppUrl && buy.generatedAmountSats !== null && (
          <>
            <DialogHeader
              title="Buy with Cash App"
              onClose={onClose}
              onBack={buy.goBackToAmount}
              icon={cashAppHeaderIcon}
            />
            <div className="flex flex-col items-center gap-6 pt-2">
              <p className="text-center text-sm text-spark-text-secondary">
                Scan this code with Cash App
              </p>

              <QRCodeContainer value={buy.cashAppUrl} />

              <CopyableText
                text={buy.cashAppUrl}
                hideText
                showShare
                label="Cash App link"
                onCopied={() => showToast('success', 'Copied!')}
                onShareError={() => showToast('error', 'Failed to share')}
              />
            </div>
          </>
        )}
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default BuyBitcoinDialog;
