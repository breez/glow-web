import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  BreezSdk,
  Config,
  GetInfoResponse,
  Network,
  Payment,
  SdkEvent,
  Rate,
  FiatCurrency,
  DepositInfo,
  LogEntry,
} from '@breeztech/breez-sdk-spark';
import { connect, initLogging } from '@breeztech/breez-sdk-spark';
import { useLatest } from './useLatest';
import { buildConnectConfig } from './buildConnectConfig';
import { logger, LogCategory, logSdkMessage } from '../services/logger';
import { formatError } from '../utils/formatError';
import { isDepositRejected } from '../services/depositState';
import { hideSplash } from '../main';

// ============================================
// SDK logging (initialized once)
// ============================================

let sdkLoggerInitialized = false;

function initSdkLogging() {
  if (sdkLoggerInitialized) return;
  sdkLoggerInitialized = true;
  initLogging({ log: (entry: LogEntry) => logSdkMessage(entry.level, entry.line) });
}

// ============================================
// Mnemonic storage (localStorage)
// ============================================

const MNEMONIC_KEY = 'walletMnemonic';
const saveMnemonic = (m: string) => localStorage.setItem(MNEMONIC_KEY, m);
const getSavedMnemonic = () => localStorage.getItem(MNEMONIC_KEY);
const clearMnemonic = () => localStorage.removeItem(MNEMONIC_KEY);

// ============================================
// Types
// ============================================

export interface BreezSdkState {
  sdk: BreezSdk | null;
  isConnected: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  walletInfo: GetInfoResponse | null;
  transactions: Payment[];
  unclaimedDeposits: DepositInfo[];
  fiatRates: Rate[];
  fiatCurrencies: FiatCurrency[];
  config: Config | null;
  error: string | null;
  hasRejectedDeposits: boolean;
  celebrationAmount: number | null;
}

export interface BreezSdkActions {
  connectWallet: (mnemonic: string, restore: boolean, overrideNetwork?: Network) => Promise<void>;
  refreshWalletData: (showLoading?: boolean) => Promise<void>;
  fetchUnclaimedDeposits: () => Promise<void>;
  handleLogout: () => Promise<void>;
  handleBuyBitcoin: () => Promise<void>;
  clearError: () => void;
  dismissCelebration: () => void;
}

// ============================================
// Hook
// ============================================

export function useBreezSdk(
  showToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void,
): BreezSdkState & BreezSdkActions {
  // Core state
  const [sdk, setSdk] = useState<BreezSdk | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [walletInfo, setWalletInfo] = useState<GetInfoResponse | null>(null);
  const [transactions, setTransactions] = useState<Payment[]>([]);
  const [unclaimedDeposits, setUnclaimedDeposits] = useState<DepositInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fiatRates, setFiatRates] = useState<Rate[]>([]);
  const [fiatCurrencies, setFiatCurrencies] = useState<FiatCurrency[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [hasRejectedDeposits, setHasRejectedDeposits] = useState(false);
  const [celebrationAmount, setCelebrationAmount] = useState<number | null>(null);

  // Refs
  const isInitialLoadRef = useRef(true);
  const eventListenerIdRef = useRef<string | null>(null);
  const shownPaymentIdsRef = useRef<Set<string>>(new Set());
  const sdkRef = useLatest(sdk);

  // Stable refs for callbacks used in event handler
  const showToastRef = useLatest(showToast);
  const isSyncingRef = useLatest(isSyncing);

  // ----------------------------------------
  // Data fetching (uses sdkRef for latest SDK)
  // ----------------------------------------

  const refreshWalletData = useCallback(async (showLoading = true) => {
    const s = sdkRef.current;
    if (!s) return;
    try {
      if (showLoading) setIsLoading(true);
      const [info, txns] = await Promise.all([
        s.getInfo({}),
        s.listPayments({ offset: 0, limit: 100 }),
      ]);
      setWalletInfo(info);
      setTransactions(txns.payments);
    } catch (e) {
      logger.error(LogCategory.SDK, 'Error refreshing wallet data', { error: formatError(e) });
      setError('Failed to refresh wallet data.');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [sdkRef]);

  const fetchUnclaimedDeposits = useCallback(async () => {
    const s = sdkRef.current;
    if (!s) return;
    try {
      const result = await s.listUnclaimedDeposits({});
      const deposits = result.deposits;
      setUnclaimedDeposits(deposits);
      setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to fetch unclaimed deposits', { error: formatError(e) });
      setUnclaimedDeposits([]);
      setHasRejectedDeposits(false);
    }
  }, [sdkRef]);

  const fetchFiatData = useCallback(async () => {
    const s = sdkRef.current;
    if (!s) return;
    try {
      const [ratesResult, currenciesResult] = await Promise.all([
        s.listFiatRates(),
        s.listFiatCurrencies(),
      ]);
      setFiatRates(ratesResult.rates);
      setFiatCurrencies(currenciesResult.currencies);
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to fetch fiat data', { error: formatError(e) });
    }
  }, [sdkRef]);

  // ----------------------------------------
  // SDK event handler
  // ----------------------------------------

  const handleSdkEvent = useCallback((event: SdkEvent) => {
    logger.debug(LogCategory.SDK, 'SDK event received', { eventType: event.type });

    if (event.type === 'synced') {
      if (isSyncingRef.current) {
        logger.info(LogCategory.SESSION, 'Restoration sync complete; hiding overlay');
        setIsSyncing(false);
      }
      document.body.setAttribute('data-wallet-synced', 'true');
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    } else if (event.type === 'paymentSucceeded') {
      const paymentId = event.payment.id;
      if (!shownPaymentIdsRef.current.has(paymentId)) {
        shownPaymentIdsRef.current.add(paymentId);
        setTimeout(() => shownPaymentIdsRef.current.delete(paymentId), 30000);

        const isReceived = event.payment.paymentType === 'receive';
        const amountSats = Number(event.payment.amount);

        if (isReceived) {
          setCelebrationAmount(amountSats);
        } else {
          showToastRef.current('success', 'Payment Sent', `${event.payment.amount} sats sent successfully`);
        }
      }
      refreshWalletData(false);
    } else if (event.type === 'claimedDeposits') {
      logger.info(LogCategory.PAYMENT, 'Deposits claimed', { count: event.claimedDeposits.length });
      showToastRef.current('success', 'Deposits Claimed Successfully', `${event.claimedDeposits.length} deposits were claimed`);
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    } else if (event.type === 'unclaimedDeposits') {
      logger.warn(LogCategory.PAYMENT, 'Claim deposits failed', { remaining: event.unclaimedDeposits.length });
      showToastRef.current('error', 'Failed to Claim Deposits', `${event.unclaimedDeposits.length} deposits could not be claimed`);
      fetchUnclaimedDeposits();
    }
  }, [refreshWalletData, fetchUnclaimedDeposits, isSyncingRef, showToastRef]);

  // ----------------------------------------
  // Connection lifecycle
  // ----------------------------------------

  const connectWallet = useCallback(async (mnemonic: string, restore: boolean, overrideNetwork?: Network) => {
    let connectedSdk: BreezSdk | undefined;
    try {
      logger.info(LogCategory.SDK, 'Initiating wallet connection', { restore });
      if (sdk) {
        logger.debug(LogCategory.SDK, 'Wallet already connected; skipping');
        return;
      }

      setIsLoading(true);
      setIsSyncing(restore);
      setError(null);

      if (!import.meta.env.VITE_BREEZ_API_KEY) {
        showToast('error', 'Missing API Key', 'Please add VITE_BREEZ_API_KEY to your .env file');
      }

      initSdkLogging();

      const cfg = buildConnectConfig(overrideNetwork);
      setConfig(cfg);

      connectedSdk = await connect({
        config: cfg,
        seed: { type: 'mnemonic', mnemonic },
        storageDir: 'spark-wallet-example',
      });
      setSdk(connectedSdk);

      logger.sdkInitialized();
      logger.authSuccess('mnemonic');
      logger.info(LogCategory.SDK, 'Wallet connected successfully');
      saveMnemonic(mnemonic);

      const [info, txns] = await Promise.all([
        connectedSdk.getInfo({}),
        connectedSdk.listPayments({ offset: 0, limit: 100 }),
      ]);
      setWalletInfo(info);
      setTransactions(txns.payments);

      setIsConnected(true);

      // Fetch unclaimed deposits using the new SDK instance directly
      try {
        const result = await connectedSdk.listUnclaimedDeposits({});
        const deposits = result.deposits;
        setUnclaimedDeposits(deposits);
        setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Failed to fetch unclaimed deposits', { error: formatError(e) });
      }

      setIsLoading(false);
    } catch (e) {
      const errorMsg = formatError(e);
      logger.error(LogCategory.SDK, 'Error connecting wallet', { error: errorMsg });
      logger.authFailure('mnemonic', errorMsg);

      // If SDK connected but a subsequent step failed, disconnect to avoid leaked instance
      if (connectedSdk) {
        try { await connectedSdk.disconnect(); } catch { /* best-effort cleanup */ }
        setSdk(null);
      }

      setError('Failed to connect wallet. Please check your mnemonic and try again.');
      setIsSyncing(false);
      setIsLoading(false);
      setConfig(null);
      throw e;
    }
  }, [sdk, showToast]);

  const handleLogout = useCallback(async () => {
    setIsLoading(true);
    try {
      if (sdk) {
        await sdk.disconnect();
      }
    } catch (e) {
      logger.error(LogCategory.SDK, 'SDK disconnect failed', { error: formatError(e) });
    }
    try {
      await logger.endSession();
    } catch (e) {
      logger.warn(LogCategory.SESSION, 'Failed to end log session', { error: formatError(e) });
    }

    // Always reset all state — even if disconnect threw
    setSdk(null);
    clearMnemonic();
    shownPaymentIdsRef.current.clear();
    setIsConnected(false);
    setIsSyncing(false);
    setWalletInfo(null);
    setTransactions([]);
    setUnclaimedDeposits([]);
    setFiatRates([]);
    setFiatCurrencies([]);
    setConfig(null);
    setError(null);
    setHasRejectedDeposits(false);
    setCelebrationAmount(null);
    setIsLoading(false);
    showToast('success', 'Successfully logged out');
  }, [sdk, showToast]);

  const handleBuyBitcoin = useCallback(async () => {
    if (!sdk) return;
    try {
      const response = await sdk.buyBitcoin({});
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to open Buy Bitcoin', { error: formatError(e) });
      showToast('error', 'Buy Bitcoin', 'Failed to open MoonPay. Please try again.');
    }
  }, [sdk, showToast]);

  // ----------------------------------------
  // Effects
  // ----------------------------------------

  // LNURL domain body attribute
  useEffect(() => {
    const lnurlEnabled = config?.lnurlDomain ? 'true' : 'false';
    document.body.setAttribute('data-lnurl-enabled', lnurlEnabled);
    return () => { document.body.setAttribute('data-lnurl-enabled', 'false'); };
  }, [config?.lnurlDomain]);

  // Auto-reconnect on mount
  useEffect(() => {
    logger.initSession().catch((e) => {
      logger.warn(LogCategory.SESSION, 'Failed to initialize log session', { error: formatError(e) });
    });

    const checkForExistingWallet = async () => {
      const savedMnemonic = getSavedMnemonic();
      if (savedMnemonic) {
        try {
          setIsLoading(true);
          await connectWallet(savedMnemonic, false);
        } catch (e) {
          logger.error(LogCategory.SDK, 'Failed to connect with saved mnemonic', { error: formatError(e) });
          setError('Failed to connect with saved mnemonic. Please try again.');
          clearMnemonic();
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }

      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        hideSplash();
      }
    };

    checkForExistingWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initialization
  }, []);

  // Event listener lifecycle
  useEffect(() => {
    if (isConnected && sdk) {
      sdk.addEventListener({ onEvent: handleSdkEvent })
        .then(id => {
          eventListenerIdRef.current = id;
          logger.debug(LogCategory.SDK, 'Registered wallet event listener', { listenerId: id });
        })
        .catch(e => {
          logger.error(LogCategory.SDK, 'Failed to add wallet event listener', { error: formatError(e) });
          setError('Failed to set up event listeners.');
        });

      return () => {
        if (eventListenerIdRef.current) {
          sdk.removeEventListener(eventListenerIdRef.current).catch(e => {
            logger.error(LogCategory.SDK, 'Error removing wallet event listener', { error: formatError(e) });
          });
          eventListenerIdRef.current = null;
        }
      };
    }
  }, [isConnected, sdk, handleSdkEvent]);

  // Periodic fiat rate fetching
  useEffect(() => {
    if (isConnected) {
      fetchFiatData();
      const interval = setInterval(fetchFiatData, 60000);
      return () => clearInterval(interval);
    }
  }, [isConnected, fetchFiatData]);

  return {
    // State
    sdk,
    isConnected,
    isLoading,
    isSyncing,
    walletInfo,
    transactions,
    unclaimedDeposits,
    fiatRates,
    fiatCurrencies,
    config,
    error,
    hasRejectedDeposits,
    celebrationAmount,
    // Actions
    connectWallet,
    refreshWalletData,
    fetchUnclaimedDeposits,
    handleLogout,
    handleBuyBitcoin,
    clearError: () => setError(null),
    dismissCelebration: () => setCelebrationAmount(null),
  };
}
