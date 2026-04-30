import { useState, useCallback } from 'react';
import { useWallet } from '../../../contexts/WalletContext';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { toSdkAmountNumber, type Sats } from '../../../types/sats';
import type { PaymentMethod, ReceiveStep } from '../../../types/domain';
import { LIGHTNING_INVOICE_MIN_SATS, LIGHTNING_INVOICE_MAX_SATS } from '../../../constants/receive';

export interface UseReceivePaymentReturn {
  // State
  activeTab: PaymentMethod;
  currentStep: ReceiveStep;
  description: string;
  /** Validated amount in sats (or null until set / when invalid). */
  amountSats: Sats | null;
  error: string | null;
  isLoading: boolean;
  paymentData: string;
  feeSats: number;
  sparkAddress: string | null;
  bitcoinAddress: string | null;
  sparkLoading: boolean;
  bitcoinLoading: boolean;
  showAmountPanel: boolean;
  // Monotonically-increasing counter bumped by `reset()` AND by
  // `closeAmountPanel()`. AmountPanel watches this to clear its own
  // local state (`displayAmount`, `isTokenMode`) so the amount
  // fields are empty on the next open. We can't rely on unmount /
  // remount to do that for us because the outer BottomSheet keeps
  // the subtree mounted across opens (`unmount={false}` — avoids
  // first-open animation jank). The counter semantics cleanly
  // distinguish user-initiated closes (which bump) from internal
  // `setShowAmountPanel(false)` → true transitions on the
  // SDK-error-recovery path (which don't bump, so the amount is
  // preserved when the panel re-opens with the error message).
  resetCount: number;
  // Actions
  setDescription: (desc: string) => void;
  setAmountSats: (sats: Sats | null) => void;
  setShowAmountPanel: (show: boolean) => void;
  // User-initiated close of the AmountPanel. Clears the typed
  // amount + description, bumps `resetCount`, and collapses the
  // panel. Wired into the AmountPanel's X button + backdrop tap +
  // back-button gesture. The raw `setShowAmountPanel(false)` stays
  // available as an escape hatch for the SDK-error-recovery path
  // where the amount must survive the panel closing and reopening.
  closeAmountPanel: () => void;
  handleTabChange: (tab: PaymentMethod, loadLightningAddress: () => void) => void;
  generateBitcoinAddress: () => Promise<void>;
  generateBolt11Invoice: () => Promise<void>;
  reset: () => void;
}

export function useReceivePayment(): UseReceivePaymentReturn {
  const wallet = useWallet();

  const [activeTab, setActiveTab] = useState<PaymentMethod>('lightning');
  // Initialise to 'input' (not a loading placeholder) so that when the
  // BottomSheet is held in the tree across opens (`unmount={false}` in
  // BottomSheet.tsx), the first paint on first-ever open shows the
  // input step directly rather than a short-lived spinner frame that
  // swaps out to taller input content mid-enter animation. `reset()`
  // below still sets 'input' on every open, so this only changes the
  // pre-reset initial render.
  const [currentStep, setCurrentStep] = useState<ReceiveStep>('input');
  const [description, setDescription] = useState<string>('');
  const [amountSats, setAmountSats] = useState<Sats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [paymentData, setPaymentData] = useState<string>('');
  const [feeSats, setFeeSats] = useState<number>(0);

  const [sparkAddress, setSparkAddress] = useState<string | null>(null);
  const [bitcoinAddress, setBitcoinAddress] = useState<string | null>(null);
  const [sparkLoading, setSparkLoading] = useState<boolean>(false);
  const [bitcoinLoading, setBitcoinLoading] = useState<boolean>(false);
  const [showAmountPanel, setShowAmountPanel] = useState<boolean>(false);
  const [resetCount, setResetCount] = useState<number>(0);

  const reset = useCallback(() => {
    setCurrentStep('input');
    setDescription('');
    setAmountSats(null);
    setError(null);
    setIsLoading(false);
    setPaymentData('');
    setFeeSats(0);
    setSparkAddress(null);
    setBitcoinAddress(null);
    setSparkLoading(false);
    setBitcoinLoading(false);
    setShowAmountPanel(false);
    setResetCount((c) => c + 1);
  }, []);

  const closeAmountPanel = useCallback(() => {
    // User-initiated close: collapse the panel, then clear the
    // typed amount + description + any lingering error AFTER the
    // BottomSheet exit animation (~200ms Material 3 emphasized-
    // accelerate, per BottomSheet.tsx) finishes. Without the
    // deferral, the fields visibly blank out while the panel is
    // still sliding off-screen — jarring. The +50ms buffer absorbs
    // minor variation in animation end timing so the clear always
    // lands after the panel is fully hidden. Bumping `resetCount`
    // is what signals AmountPanel to reset its local
    // `displayAmount` / `isTokenMode` on the next reopen. Does NOT
    // touch `currentStep` / `paymentData` / `feeSats` because those
    // belong to the outer dialog's tab state, not the amount panel.
    setShowAmountPanel(false);
    setTimeout(() => {
      setAmountSats(null);
      setDescription('');
      setError(null);
      setResetCount((c) => c + 1);
    }, 250);
  }, []);

  const generateSparkAddress = useCallback(async () => {
    if (sparkAddress || sparkLoading) return;
    setSparkLoading(true);
    try {
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: { type: 'sparkAddress' },
      });
      setSparkAddress(receiveResponse.paymentRequest);
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to generate Spark address', { error: formatError(err) });
      setError(`Failed to generate Spark address: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSparkLoading(false);
    }
  }, [wallet, sparkAddress, sparkLoading]);

  const generateBitcoinAddress = useCallback(async () => {
    if (bitcoinAddress || bitcoinLoading) return;
    setBitcoinLoading(true);
    try {
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: { type: 'bitcoinAddress', newAddress: true },
      });
      setBitcoinAddress(receiveResponse.paymentRequest);
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to generate Bitcoin address', { error: formatError(err) });
      setError(`Failed to generate Bitcoin address: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setBitcoinLoading(false);
    }
  }, [wallet, bitcoinAddress, bitcoinLoading]);

  const generateBolt11Invoice = useCallback(async () => {
    logger.info(LogCategory.PAYMENT, 'Starting invoice generation', {
      amountSats: amountSats !== null ? String(amountSats) : null,
    });
    setError(null);

    // Synchronous validation before switching to the loading state.
    // Defense-in-depth: AmountPanel's `validAmount` guard already
    // disables the submit controls for invalid or out-of-range
    // amounts, so this should never fire from the UI path. Kept to
    // protect against programmatic callers and to keep the invariant
    // close to the SDK call. Errors here skip the loading-step flash
    // and just set `error` so the panel stays open with the message.
    if (amountSats === null) {
      setError('Please enter a valid amount');
      return;
    }
    if (amountSats < BigInt(LIGHTNING_INVOICE_MIN_SATS)) {
      setError(`Amount must be at least ₿${LIGHTNING_INVOICE_MIN_SATS.toLocaleString()}`);
      return;
    }
    if (amountSats > BigInt(LIGHTNING_INVOICE_MAX_SATS)) {
      setError(`Amount must be at most ₿${LIGHTNING_INVOICE_MAX_SATS.toLocaleString()}`);
      return;
    }

    const amountSatsForSdk = toSdkAmountNumber(amountSats);
    if (amountSatsForSdk === null) {
      setError('Invalid amount');
      return;
    }

    setIsLoading(true);
    setCurrentStep('loading');

    if (showAmountPanel) {
      logger.debug(LogCategory.PAYMENT, 'Closing amount panel before generating invoice');
      setShowAmountPanel(false);
    }

    try {
      logger.debug(LogCategory.PAYMENT, 'Calling wallet.receivePayment for bolt11 invoice', {
        amountSats: amountSatsForSdk,
      });
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: {
          type: 'bolt11Invoice',
          description,
          amountSats: amountSatsForSdk,
        },
      });
      logger.info(LogCategory.PAYMENT, 'Invoice generated successfully', {
        paymentRequestLength: receiveResponse.paymentRequest.length,
        fee: Number(receiveResponse.fee) || 0,
      });
      setPaymentData(receiveResponse.paymentRequest);
      setFeeSats(Number(receiveResponse.fee) || 0);
      setCurrentStep('qr');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to generate invoice', { error: formatError(err) });
      setError(`Failed to generate invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setCurrentStep('input');
      setShowAmountPanel(true);
    } finally {
      setIsLoading(false);
      logger.debug(LogCategory.PAYMENT, 'Receive invoice generation process finished');
    }
  }, [wallet, amountSats, description, showAmountPanel]);

  const handleTabChange = useCallback((tab: PaymentMethod, loadLightningAddress: () => void) => {
    setActiveTab(tab);
    setCurrentStep('input');
    setError(null);
    setPaymentData('');
    setFeeSats(0);

    if (tab === 'lightning') {
      loadLightningAddress();
    } else if (tab === 'spark') {
      generateSparkAddress();
    } else if (tab === 'bitcoin') {
      generateBitcoinAddress();
    }
  }, [generateSparkAddress, generateBitcoinAddress]);

  return {
    activeTab,
    currentStep,
    description,
    amountSats,
    error,
    isLoading,
    paymentData,
    feeSats,
    sparkAddress,
    bitcoinAddress,
    sparkLoading,
    bitcoinLoading,
    showAmountPanel,
    resetCount,
    setDescription,
    setAmountSats,
    setShowAmountPanel,
    closeAmountPanel,
    handleTabChange,
    generateBitcoinAddress,
    generateBolt11Invoice,
    reset,
  };
}
