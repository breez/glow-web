import { useCallback, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import type { Network } from '@breeztech/breez-sdk-spark';
import { useWallet } from '../../../contexts/WalletContext';
import { useInvoicePaid } from '../../../hooks/useInvoicePaid';
import { useAmountInput } from '../../../hooks/useAmountInput';
import { logger, LogCategory } from '../../../services/logger';
import { formatError } from '../../../utils/formatError';
import { fixedQuickAmounts, type TokenDisplayConfig } from '../../../utils/tokenFormatting';
import { toSdkAmountNumber, type Sats } from '../../../types/sats';
import {
  getBuyProviderSettings,
  filterProvidersByNetwork,
  filterProvidersByPlatform,
  hasBuyProviderSettings,
  type BuyBitcoinProvider,
} from '../../../services/settings';
import { useCashAppInstalled } from '../../../hooks/useCashAppInstalled';

export type BuyStep = 'select' | 'amount' | 'link';

/** What a Cash App quick amount is worth, in dollars. They start where a
 *  purchase is worth making: below this the provider's fee takes much of it.
 *  Any amount can still be typed, down to `MIN_CASH_APP_SATS`. */
const CASH_APP_POINTS_USD = [20, 50, 100];
const MIN_CASH_APP_SATS: Sats = 1n as Sats;

export interface UseBuyBitcoinOptions {
  /** Whether the dialog is open — used to reset state when closed. */
  isOpen: boolean;
  /** Current network; filters the provider list (e.g. Cash App is mainnet-only). */
  network?: Network;
  /** Called for providers that redirect externally (MoonPay). */
  onSelectRedirectProvider: (provider: BuyBitcoinProvider) => Promise<void>;
  /** Called after the native Cash App handoff; the caller closes the dialog. */
  onMobileRedirectComplete: () => void;
  /** Called when the displayed invoice is paid; the caller typically closes the dialog. */
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
  goBackToSelect: (() => void) | null;
  goBackToAmount: () => void;
}

export function useBuyBitcoin({
  isOpen,
  network,
  onSelectRedirectProvider,
  onMobileRedirectComplete,
  onInvoicePaid,
}: UseBuyBitcoinOptions): UseBuyBitcoinReturn {
  const sdk = useWallet();

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
    quickAmountScale,
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

  const [redirectingProvider, setRedirectingProvider] = useState<BuyBitcoinProvider | null>(null);
  const [cashAppUrl, setCashAppUrl] = useState<string | null>(null);
  const [generatedAmountSats, setGeneratedAmountSats] = useState<Sats | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cashAppInstalled = useCashAppInstalled();
  const enabledProviders = useMemo(
    () => filterProvidersByPlatform(
      filterProvidersByNetwork(getBuyProviderSettings(), network),
      cashAppInstalled,
    ),
    // Re-read when the dialog opens so updates from settings are reflected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, network, cashAppInstalled]
  );

  // A lone Cash App entry (iOS) has nothing to pick, so the picker is skipped
  // and the sheet opens on the amount. Safe as a mount-time decision: the
  // parent remounts this hook on every open.
  const skipsProviderSelect = !hasBuyProviderSettings()
    && enabledProviders.length === 1 && enabledProviders[0] === 'cashApp';
  const [step, setStep] = useState<BuyStep>(skipsProviderSelect ? 'amount' : 'select');

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

    try {
      const response = await sdk.buyBitcoin({ type: 'cashApp', amountSats: amountSatsForSdk });
      setGeneratedAmountSats(amountSats);
      if (Capacitor.isNativePlatform()) {
        // AppLauncher bridges to UIApplication.open, the only iOS API that
        // hands an https universal link (cash.app/launch/...) off to the
        // Cash App app. Browser.open (SFSafariViewController) only loads the
        // web page: iOS suppresses universal-link handoff on a programmatic
        // in-app-browser load. Falls back to Safari if Cash App is absent.
        await AppLauncher.openUrl({ url: response.url });
        onMobileRedirectComplete();
        return;
      }
      // Web hands the URL to a real anchor the person taps (see the `link`
      // step). Scripted navigation cannot reach the Cash App app: iOS only
      // resolves a universal link from a genuine tap, and Chrome refuses to
      // hand an App Link to an app without user activation, which the await
      // above has already spent.
      setCashAppUrl(response.url);
      setStep('link');
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to create Cash App buy URL', { error: formatError(e) });
      setError('Failed to create invoice. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [amountSats, sdk, onMobileRedirectComplete]);

  // Cash App URLs are `https://cash.app/launch/lightning/<bolt11>`. Extract the
  // invoice only while the link is on screen so the bus subscription pauses
  // once we leave that step.
  const activeInvoice = useMemo(() => {
    if (step !== 'link' || !cashAppUrl) return null;
    return cashAppUrl.split('/').pop() ?? null;
  }, [step, cashAppUrl]);

  useInvoicePaid(activeInvoice, onInvoicePaid);

  const goBackToSelectFn = useCallback(() => {
    setStep('select');
    resetAmount();
    setError(null);
  }, [resetAmount]);
  // null when there is no picker behind us, so the caller drops the back arrow.
  const goBackToSelect = skipsProviderSelect ? null : goBackToSelectFn;

  const goBackToAmount = useCallback(() => {
    setStep('amount');
    setCashAppUrl(null);
  }, []);

  const validAmount = amountInput !== ''
    && amountSats !== null
    && amountSats >= MIN_CASH_APP_SATS
    && !amountTooLarge;

  const displayedError = error ?? (amountTooLarge ? 'Invalid amount' : null);

  // Buying adds funds, so there is no balance to scale against: fixed points of
  // value, held there by the rate. One set covers both denominations, since a
  // purchase has no reason to reach higher in sats than in fiat.
  const quickAmounts = fixedQuickAmounts(quickAmountScale, CASH_APP_POINTS_USD);

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
