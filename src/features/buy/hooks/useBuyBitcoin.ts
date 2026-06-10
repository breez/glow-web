import { useCallback, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import type { Network } from '@breeztech/breez-sdk-spark';
import { useWallet } from '../../../contexts/WalletContext';
import { usePlatform } from '../../../hooks/usePlatform';
import { useInvoicePaid } from '../../../hooks/useInvoicePaid';
import { useAmountInput } from '../../../hooks/useAmountInput';
import { logger, LogCategory } from '../../../services/logger';
import { formatError } from '../../../utils/formatError';
import { type TokenDisplayConfig } from '../../../utils/tokenFormatting';
import { toSdkAmountNumber, type Sats } from '../../../types/sats';
import {
  getBuyProviderSettings,
  filterProvidersByNetwork,
  type BuyBitcoinProvider,
} from '../../../services/settings';

export type BuyStep = 'select' | 'amount' | 'qr';

const CASH_APP_QUICK_AMOUNTS_SATS = [10000, 50000, 100000];
const CASH_APP_QUICK_AMOUNTS_TOKEN = [5, 10, 25];
const MIN_CASH_APP_SATS: Sats = 1n as Sats;

export interface UseBuyBitcoinOptions {
  /** Whether the dialog is open — used to reset state when closed. */
  isOpen: boolean;
  /** Current network; filters the provider list (e.g. Cash App is mainnet-only). */
  network?: Network;
  /** Called for providers that redirect externally (MoonPay). */
  onSelectRedirectProvider: (provider: BuyBitcoinProvider) => Promise<void>;
  /**
   * Closes the dialog and resolves once the sheet's leave transition has
   * finished (bounded by a timeout; resolves immediately when the page is
   * already hidden). The buy flow must not navigate away before this
   * resolves: a page frozen or snapshotted mid-close restores as a stuck
   * backdrop on return (breez/glow-web#213).
   */
  closeAndWaitForLeave: () => Promise<void>;
  /** Called when the displayed QR invoice is paid; the caller typically closes the dialog. */
  onInvoicePaid: () => void;
}

export interface UseBuyBitcoinReturn {
  // State
  step: BuyStep;
  enabledProviders: BuyBitcoinProvider[];
  redirectingProvider: BuyBitcoinProvider | null;
  /** Display string bound to the input. Holds fiat in token mode, sats otherwise. */
  amountInput: string;
  cashAppUrl: string | null;
  generatedAmountSats: Sats | null;
  isGenerating: boolean;
  error: string | null;
  validAmount: boolean;
  quickAmounts: number[];
  // Token mode
  isTokenMode: boolean;
  /** True when stable balance is currently active — gates the CurrencySwitcher. */
  isStableBalanceActive: boolean;
  tokenConfig: TokenDisplayConfig | null;
  // Actions
  selectProvider: (provider: BuyBitcoinProvider) => Promise<void>;
  setAmount: (value: string) => void;
  setQuickAmount: (value: number) => void;
  toggleDenomination: () => void;
  generate: () => Promise<void>;
  goBackToSelect: () => void;
  goBackToAmount: () => void;
}

export function useBuyBitcoin({
  isOpen,
  network,
  onSelectRedirectProvider,
  closeAndWaitForLeave,
  onInvoicePaid,
}: UseBuyBitcoinOptions): UseBuyBitcoinReturn {
  const sdk = useWallet();
  const platform = usePlatform();
  const isMobile = platform.isIOS || platform.isAndroid;

  const input = useAmountInput();
  const {
    amountInput,
    setAmount,
    setAmountInput,
    resetAmount,
    isTokenMode,
    toggleDenomination,
    isStableBalanceActive,
    config: tokenConfig,
    amountSats,
    btcFiatRate,
  } = input;

  // Detect "too large" inputs: parseAmountToSats returns null once the result
  // exceeds the absolute Bitcoin max. Without this hint, the user just sees
  // Continue stay disabled.
  const amountTooLarge = useMemo(() => {
    if (amountInput === '' || amountSats !== null) return false;
    const numeric = Number(amountInput);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;
    const projectedSats = isTokenMode && btcFiatRate > 0
      ? (numeric / btcFiatRate) * 100_000_000
      : numeric;
    return projectedSats > Number.MAX_SAFE_INTEGER;
  }, [amountInput, amountSats, isTokenMode, btcFiatRate]);

  const [step, setStep] = useState<BuyStep>('select');
  const [redirectingProvider, setRedirectingProvider] = useState<BuyBitcoinProvider | null>(null);
  const [cashAppUrl, setCashAppUrl] = useState<string | null>(null);
  const [generatedAmountSats, setGeneratedAmountSats] = useState<Sats | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledProviders = useMemo(
    () => filterProvidersByNetwork(getBuyProviderSettings(), network),
    // Re-read when the dialog opens so updates from settings are reflected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, network]
  );

  // No reset-on-close needed — parent (WalletPage) bumps `buyBitcoinSession`
  // on each open and passes it as `key`, so each open is a fresh mount of
  // the dialog and this hook, with all useState initialised to defaults.

  const selectProvider = useCallback(
    async (provider: BuyBitcoinProvider) => {
      if (provider === 'cashApp') {
        setStep('amount');
        return;
      }
      setRedirectingProvider(provider);
      try {
        await onSelectRedirectProvider(provider);
      } catch {
        // Errors from redirect providers are handled upstream (toast + logging).
      } finally {
        setRedirectingProvider(null);
      }
    },
    [onSelectRedirectProvider]
  );

  const setAmountWithErrorClear = useCallback(
    (value: string) => {
      setAmount(value);
      setError((prev) => (prev ? null : prev));
    },
    [setAmount],
  );

  const setQuickAmount = useCallback(
    (value: number) => {
      setAmountInput(String(value));
      setError(null);
    },
    [setAmountInput],
  );

  const toggleDenominationWithErrorClear = useCallback(() => {
    toggleDenomination();
    setError(null);
  }, [toggleDenomination]);

  const generate = useCallback(async () => {
    if (amountSats === null || amountSats < MIN_CASH_APP_SATS) {
      setError(`Amount must be at least ₿${MIN_CASH_APP_SATS.toString()}`);
      return;
    }
    const amountSatsForSdk = toSdkAmountNumber(amountSats);
    if (amountSatsForSdk === null) {
      setError('Invalid amount');
      return;
    }
    setError(null);
    setIsGenerating(true);

    // On mobile web, pre-open a blank tab synchronously during the user
    // gesture so browsers let us navigate it later without tripping popup
    // blockers. On native hosts we must NOT do this (or fall back to
    // window.location.href): that navigates the app's own WebView to
    // cash.app and gets stuck in a redirect loop when the user returns
    // (same bug as the MoonPay flow, see useBreezSdk.handleBuyBitcoin).
    // Instead, the URL is handed to @capacitor/browser after the SDK
    // responds (Chrome Custom Tabs / SFSafariViewController).
    const isNative = Capacitor.isNativePlatform();
    const mobileTab = isMobile && !isNative ? window.open('', '_blank') : null;

    try {
      const response = await sdk.buyBitcoin({ type: 'cashApp', amountSats: amountSatsForSdk });
      setGeneratedAmountSats(amountSats);
      if (isNative || isMobile) {
        // Order matters: fetch the URL with the sheet still open (spinner
        // and inline errors keep working), then close the sheet and wait
        // out its leave transition, then navigate (breez/glow-web#213).
        // Only the synchronous window.open above needs the tap gesture;
        // navigating an already-open tab handle and Browser.open have no
        // user-activation deadline.
        await closeAndWaitForLeave();
        if (isNative) {
          await Browser.open({ url: response.url });
        } else if (mobileTab) {
          mobileTab.location.href = response.url;
        } else {
          window.location.href = response.url;
        }
      } else {
        setCashAppUrl(response.url);
        setStep('qr');
      }
    } catch (e) {
      mobileTab?.close();
      logger.error(LogCategory.SDK, 'Failed to create Cash App buy URL', { error: formatError(e) });
      setError('Failed to create invoice. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [amountSats, isMobile, sdk, closeAndWaitForLeave]);

  // Cash App URLs are `https://cash.app/launch/lightning/<bolt11>`. Extract the
  // invoice only while we're showing the QR so the bus subscription pauses
  // once we leave that step.
  const activeInvoice = useMemo(() => {
    if (step !== 'qr' || !cashAppUrl) return null;
    return cashAppUrl.split('/').pop() ?? null;
  }, [step, cashAppUrl]);

  useInvoicePaid(activeInvoice, onInvoicePaid);

  const goBackToSelect = useCallback(() => {
    setStep('select');
    resetAmount();
    setError(null);
  }, [resetAmount]);

  const goBackToAmount = useCallback(() => {
    setStep('amount');
    setCashAppUrl(null);
  }, []);

  const validAmount = amountInput !== ''
    && amountSats !== null
    && amountSats >= MIN_CASH_APP_SATS
    && !amountTooLarge;

  const displayedError = error ?? (amountTooLarge ? 'Invalid amount' : null);

  const quickAmounts = isTokenMode ? CASH_APP_QUICK_AMOUNTS_TOKEN : CASH_APP_QUICK_AMOUNTS_SATS;

  return {
    step,
    enabledProviders,
    redirectingProvider,
    amountInput,
    cashAppUrl,
    generatedAmountSats,
    isGenerating,
    error: displayedError,
    validAmount,
    quickAmounts,
    isTokenMode,
    isStableBalanceActive,
    tokenConfig,
    selectProvider,
    setAmount: setAmountWithErrorClear,
    setQuickAmount,
    toggleDenomination: toggleDenominationWithErrorClear,
    generate,
    goBackToSelect,
    goBackToAmount,
  };
}
