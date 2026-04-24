import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  BreezSdk,
  Config,
  GetInfoResponse,
  Payment,
  SdkEvent,
  DepositInfo,
  LogEntry,
  Seed,
} from '@breeztech/breez-sdk-spark';
import { connect, initLogging } from '@breeztech/breez-sdk-spark';
import { useLatest } from './useLatest';
import { buildConnectConfig } from './buildConnectConfig';
import { logger, LogCategory, logSdkMessage } from '../services/logger';
import { formatError } from '../utils/formatError';
import { isDepositRejected } from '../services/depositState';
import { setCachedStableTicker, clearNetworkOverride, clearStableRestorePrompted, type BuyBitcoinProvider } from '../services/settings';
import { hideSplash } from '../main';
import {
  isPrfAvailable,
  isPasskeyMode,
  setPasskeyMode,
  clearPasskeyMode,
  getWallet,
} from '../services/passkeyService';


// ============================================
// Payment filtering
// ============================================

/** Filter out ongoing payment conversions not yet linked */
function filterOngoingConversionPayments(payments: Payment[]): Payment[] {
  return payments.filter(p => {
    const conversionInfo = p.details &&
      'conversionInfo' in p.details ? p.details.conversionInfo : null;
    return conversionInfo?.purpose?.type !== 'ongoingPayment';
  });
}

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
  config: Config | null;
  error: string | null;
  hasRejectedDeposits: boolean;
  celebrationPayment: Payment | null;
  prfAvailable: boolean;
}

export type SdkEventHandler = (event: SdkEvent) => void;
export type SdkEventUnsubscribe = () => void;

export interface BreezSdkActions {
  connectWallet: (seed: Seed, restore: boolean, passkeyLabel?: string) => Promise<void>;
  refreshWalletData: (showLoading?: boolean) => Promise<void>;
  fetchUnclaimedDeposits: () => Promise<void>;
  handleLogout: () => Promise<void>;
  handleBuyBitcoin: (provider: BuyBitcoinProvider) => Promise<void>;
  clearError: () => void;
  dismissCelebration: () => void;
  subscribeToSdkEvents: (handler: SdkEventHandler) => SdkEventUnsubscribe;
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
  const [config, setConfig] = useState<Config | null>(null);
  const [hasRejectedDeposits, setHasRejectedDeposits] = useState(false);
  const [celebrationPayment, setCelebrationPayment] = useState<Payment | null>(null);
  const [prfAvailable, setPrfAvailable] = useState(false);

  // Refs
  const isInitialLoadRef = useRef(true);
  const eventListenerIdRef = useRef<string | null>(null);
  const shownPaymentIdsRef = useRef<Set<string>>(new Set());
  const sdkRef = useLatest(sdk);

  // In-app event bus: feature hooks subscribe here instead of creating their
  // own SDK-level listeners, so we only ever register one listener per SDK.
  const eventSubscribersRef = useRef<Set<SdkEventHandler>>(new Set());
  const subscribeToSdkEvents = useCallback<BreezSdkActions['subscribeToSdkEvents']>(
    (handler) => {
      eventSubscribersRef.current.add(handler);
      return () => {
        eventSubscribersRef.current.delete(handler);
      };
    },
    []
  );

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
      setTransactions(filterOngoingConversionPayments(txns.payments));
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
      const alreadyShown = shownPaymentIdsRef.current.has(paymentId);
      logger.debug(LogCategory.PAYMENT, 'Payment succeeded event received', {
        alreadyShown,
        payment: JSON.parse(JSON.stringify(event.payment)),
      });
      if (!alreadyShown) {
        shownPaymentIdsRef.current.add(paymentId);
        setTimeout(() => shownPaymentIdsRef.current.delete(paymentId), 30000);

        const isReceived = event.payment.paymentType === 'receive';
        const hasConversionInfo = event.payment.details &&
          'conversionInfo' in event.payment.details &&
          event.payment.details.conversionInfo != null;

        if (!hasConversionInfo && isReceived) {
          setCelebrationPayment(event.payment);
        }
        // Send toast suppressed — ResultStep dialog already shows success
      }
      refreshWalletData(false);
    } else if (event.type === 'paymentPending') {
      logger.info(LogCategory.PAYMENT, 'Payment pending event received', {
        payment: JSON.parse(JSON.stringify(event.payment)),
      });
    } else if (event.type === 'paymentFailed') {
      logger.info(LogCategory.PAYMENT, 'Payment failed event received', {
        payment: JSON.parse(JSON.stringify(event.payment)),
      });
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

    // Fan out to feature subscribers. Each handler is isolated so one throwing
    // does not prevent the others from running.
    eventSubscribersRef.current.forEach((handler) => {
      try {
        handler(event);
      } catch (e) {
        logger.error(LogCategory.SDK, 'SDK event subscriber threw', { error: formatError(e) });
      }
    });
  }, [refreshWalletData, fetchUnclaimedDeposits, isSyncingRef, showToastRef]);

  // ----------------------------------------
  // Connection lifecycle
  // ----------------------------------------

  const connectWallet = useCallback(async (seed: Seed, restore: boolean, passkeyLabel?: string) => {
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
        setIsLoading(false);
        return;
      }

      initSdkLogging();

      const cfg = buildConnectConfig();
      setConfig(cfg);

      connectedSdk = await connect({
        config: cfg,
        seed,
        storageDir: 'spark-wallet-example',
      });
      setSdk(connectedSdk);

      logger.sdkInitialized();
      logger.authSuccess(seed.type);
      logger.info(LogCategory.SDK, 'Wallet connected successfully');

      if (passkeyLabel != null) {
        setPasskeyMode(passkeyLabel);
      } else if (seed.type === 'mnemonic') {
        saveMnemonic(seed.mnemonic);
      }

      const [info, txns] = await Promise.all([
        connectedSdk.getInfo({}),
        connectedSdk.listPayments({ offset: 0, limit: 100 }),
      ]);
      setWalletInfo(info);
      setTransactions(filterOngoingConversionPayments(txns.payments));

      setIsConnected(true);

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
      logger.authFailure(seed.type, errorMsg);

      // If SDK connected but a subsequent step failed, disconnect to avoid leaked instance
      if (connectedSdk) {
        try { await connectedSdk.disconnect(); } catch { /* best-effort cleanup */ }
        setSdk(null);
      }

      setError('Failed to connect wallet. Please try again.');
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
    clearPasskeyMode();
    setCachedStableTicker(null);
    clearStableRestorePrompted();
    shownPaymentIdsRef.current.clear();
    setIsConnected(false);
    setIsSyncing(false);
    setWalletInfo(null);
    setTransactions([]);
    setUnclaimedDeposits([]);
    setConfig(null);
    setError(null);
    setHasRejectedDeposits(false);
    setCelebrationPayment(null);
    setIsLoading(false);
    clearNetworkOverride();
    showToast('success', 'Successfully logged out');
  }, [sdk, showToast]);

  const handleBuyBitcoin = useCallback(async (provider: BuyBitcoinProvider) => {
    if (!sdk) return;

    // Pre-open a blank tab synchronously (during user gesture) to avoid popup blockers.
    // On mobile/PWA this will likely return null — we fall back to same-tab navigation.
    const newTab = window.open('', '_blank');

    try {
      const request = provider === 'cashApp'
        ? { type: 'cashApp' as const }
        : { type: 'moonpay' as const };
      const response = await sdk.buyBitcoin(request);
      if (newTab) {
        newTab.location.href = response.url;
      } else {
        window.location.href = response.url;
      }
    } catch (e) {
      // Close the blank tab if the SDK call failed
      newTab?.close();
      logger.error(LogCategory.SDK, 'Failed to open Buy Bitcoin', { error: formatError(e) });
      showToast('error', 'Buy Bitcoin', 'Failed to open purchase page. Please try again.');
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

  // Check PRF availability on mount
  useEffect(() => {
    isPrfAvailable().then(setPrfAvailable).catch(() => setPrfAvailable(false));
  }, []);

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
          await connectWallet({ type: 'mnemonic', mnemonic: savedMnemonic }, false);
        } catch (e) {
          logger.error(LogCategory.SDK, 'Failed to connect with saved mnemonic', { error: formatError(e) });
          setError('Failed to connect with saved mnemonic. Please try again.');
          clearMnemonic();
          setIsLoading(false);
        }
      } else if (isPasskeyMode()) {
        setIsLoading(true);
        let wallet;
        try {
          wallet = await getWallet();
        } catch (e) {
          logger.error(LogCategory.AUTH, 'Passkey authentication failed', { error: formatError(e) });
          if (e instanceof DOMException && e.name === 'NotAllowedError') {
            clearPasskeyMode();
          }
          setError('Failed to authenticate with passkey. Please try again.');
          setIsLoading(false);
        }
        if (wallet) {
          try {
            await connectWallet(wallet.seed, false, wallet.label);
          } catch (e) {
            logger.error(LogCategory.SDK, 'Failed to connect after passkey auth', { error: formatError(e) });
            setError('Failed to connect wallet. Please try again.');
            setIsLoading(false);
          }
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

  return {
    // State
    sdk,
    isConnected,
    isLoading,
    isSyncing,
    walletInfo,
    transactions,
    unclaimedDeposits,
    config,
    error,
    hasRejectedDeposits,
    celebrationPayment,
    prfAvailable,
    // Actions
    connectWallet,
    refreshWalletData,
    fetchUnclaimedDeposits,
    handleLogout,
    handleBuyBitcoin,
    clearError: () => setError(null),
    dismissCelebration: () => setCelebrationPayment(null),
    subscribeToSdkEvents,
  };
}
