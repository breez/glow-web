import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Network } from '@breeztech/breez-sdk-spark';
import { useWallet } from '../../../contexts/WalletContext';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { usePlatform } from '../../../hooks/usePlatform';
import { useInvoicePaid } from '../../../hooks/useInvoicePaid';
import { logger, LogCategory } from '../../../services/logger';
import { formatError } from '../../../utils/formatError';
import {
  fiatToSats,
  sanitizeTokenInput,
  type TokenDisplayConfig,
} from '../../../utils/tokenFormatting';
import {
  getBuyProviderSettings,
  filterProvidersByNetwork,
  type BuyBitcoinProvider,
} from '../../../services/settings';

export type BuyStep = 'select' | 'amount' | 'qr';

const CASH_APP_QUICK_AMOUNTS_SATS = [10000, 50000, 100000];
const CASH_APP_QUICK_AMOUNTS_TOKEN = [5, 10, 25];
const MIN_CASH_APP_SATS = 1;

export interface UseBuyBitcoinOptions {
  /** Whether the dialog is open — used to reset state when closed. */
  isOpen: boolean;
  /** Current network; filters the provider list (e.g. Cash App is mainnet-only). */
  network?: Network;
  /** Called for providers that redirect externally (MoonPay). */
  onSelectRedirectProvider: (provider: BuyBitcoinProvider) => Promise<void>;
  /** Called after a mobile Cash App redirect; the caller typically closes the dialog. */
  onMobileRedirectComplete: () => void;
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
  generatedAmountSats: number | null;
  isGenerating: boolean;
  error: string | null;
  validAmount: boolean;
  isMobile: boolean;
  quickAmounts: number[];
  // Token mode
  isTokenMode: boolean;
  hasTokenConfig: boolean;
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
  onMobileRedirectComplete,
  onInvoicePaid,
}: UseBuyBitcoinOptions): UseBuyBitcoinReturn {
  const sdk = useWallet();
  const stableBalance = useStableBalance();
  const platform = usePlatform();
  const isMobile = platform.isIOS || platform.isAndroid;

  const hasTokenConfig = !!stableBalance.displayConfig;
  const tokenConfig = stableBalance.displayConfig;

  const [step, setStep] = useState<BuyStep>('select');
  const [redirectingProvider, setRedirectingProvider] = useState<BuyBitcoinProvider | null>(null);
  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive && hasTokenConfig);
  const [amountInput, setAmountInput] = useState('');
  const [cashAppUrl, setCashAppUrl] = useState<string | null>(null);
  const [generatedAmountSats, setGeneratedAmountSats] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledProviders = useMemo(
    () => filterProvidersByNetwork(getBuyProviderSettings(), network),
    // Re-read when the dialog opens so updates from settings are reflected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, network]
  );

  // Reset local state whenever the dialog closes.
  useEffect(() => {
    if (!isOpen) {
      setStep('select');
      setRedirectingProvider(null);
      setIsTokenMode(stableBalance.isActive && hasTokenConfig);
      setAmountInput('');
      setCashAppUrl(null);
      setGeneratedAmountSats(null);
      setIsGenerating(false);
      setError(null);
    }
  }, [isOpen, stableBalance.isActive, hasTokenConfig]);

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

  const setAmount = useCallback(
    (value: string) => {
      if (isTokenMode && tokenConfig) {
        const sanitized = sanitizeTokenInput(value, tokenConfig.fractionSize);
        if (sanitized !== null) {
          setAmountInput(sanitized);
          setError((prev) => (prev ? null : prev));
        }
      } else {
        setAmountInput(value.replace(/[^0-9]/g, ''));
        setError((prev) => (prev ? null : prev));
      }
    },
    [isTokenMode, tokenConfig]
  );

  const setQuickAmount = useCallback((value: number) => {
    setAmountInput(String(value));
    setError(null);
  }, []);

  const toggleDenomination = useCallback(() => {
    setIsTokenMode((prev) => !prev);
    setAmountInput('');
    setError(null);
  }, []);

  // Convert the input string to sats based on the current mode.
  const amountSats = useMemo(() => {
    if (amountInput === '') return 0;
    if (isTokenMode && tokenConfig && stableBalance.btcFiatRate > 0) {
      const fiat = parseFloat(amountInput);
      if (!fiat || fiat <= 0) return 0;
      return fiatToSats(fiat, stableBalance.btcFiatRate);
    }
    const sats = parseInt(amountInput, 10);
    return Number.isFinite(sats) ? sats : 0;
  }, [amountInput, isTokenMode, tokenConfig, stableBalance.btcFiatRate]);

  const generate = useCallback(async () => {
    if (!amountSats || amountSats < MIN_CASH_APP_SATS) {
      setError(`Amount must be at least ₿${MIN_CASH_APP_SATS.toLocaleString()}`);
      return;
    }
    setError(null);
    setIsGenerating(true);

    // Pre-open a blank tab synchronously during the user gesture so mobile
    // browsers let us navigate it later without tripping popup blockers.
    const mobileTab = isMobile ? window.open('', '_blank') : null;

    try {
      const response = await sdk.buyBitcoin({ type: 'cashApp', amountSats });
      setGeneratedAmountSats(amountSats);
      if (isMobile) {
        if (mobileTab) {
          mobileTab.location.href = response.url;
        } else {
          window.location.href = response.url;
        }
        onMobileRedirectComplete();
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
  }, [amountSats, isMobile, sdk, onMobileRedirectComplete]);

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
    setAmountInput('');
    setError(null);
  }, []);

  const goBackToAmount = useCallback(() => {
    setStep('amount');
    setCashAppUrl(null);
  }, []);

  const validAmount = amountInput !== '' && amountSats >= MIN_CASH_APP_SATS;

  const quickAmounts = isTokenMode ? CASH_APP_QUICK_AMOUNTS_TOKEN : CASH_APP_QUICK_AMOUNTS_SATS;

  return {
    step,
    enabledProviders,
    redirectingProvider,
    amountInput,
    cashAppUrl,
    generatedAmountSats,
    isGenerating,
    error,
    validAmount,
    isMobile,
    quickAmounts,
    isTokenMode,
    hasTokenConfig,
    tokenConfig,
    selectProvider,
    setAmount,
    setQuickAmount,
    toggleDenomination,
    generate,
    goBackToSelect,
    goBackToAmount,
  };
}
