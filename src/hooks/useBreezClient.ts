import { useEffect, useState, useCallback, useRef } from 'react';
import { Config, GetInfoResponse, Network, Payment, SdkEvent, Rate, FiatCurrency, DepositInfo } from '@breeztech/breez-sdk-spark';
import { useWallet } from '../contexts/WalletContext';
import { useLatest } from './useLatest';
import { buildConnectConfig } from './buildConnectConfig';
import { logger, LogCategory } from '../services/logger';
import { formatError } from '../utils/formatError';
import { isDepositRejected } from '../services/depositState';
import { hideSplash } from '../main';
import {
  showPaymentReceivedNotification,
  showDepositClaimedNotification,
} from '../services/notificationService';

// ============================================
// Types
// ============================================

export interface BreezClientState {
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

export interface BreezClientActions {
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

export function useBreezClient(
  showToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void,
): BreezClientState & BreezClientActions {
  const wallet = useWallet();

  // Core state
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

  // Stable refs for callbacks used in event handler
  const showToastRef = useLatest(showToast);
  const isSyncingRef = useLatest(isSyncing);

  // ----------------------------------------
  // Data fetching
  // ----------------------------------------

  const refreshWalletData = useCallback(async (showLoading = true) => {
    if (!isConnected) return;
    try {
      if (showLoading) setIsLoading(true);
      const [info, txns] = await Promise.all([
        wallet.getWalletInfo(),
        wallet.getTransactions(),
      ]);
      setWalletInfo(info);
      setTransactions(txns);
    } catch (e) {
      logger.error(LogCategory.SDK, 'Error refreshing wallet data', { error: formatError(e) });
      setError('Failed to refresh wallet data.');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [isConnected, wallet]);

  const fetchUnclaimedDeposits = useCallback(async () => {
    try {
      const deposits = await wallet.unclaimedDeposits();
      setUnclaimedDeposits(deposits);
      setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to fetch unclaimed deposits', { error: formatError(e) });
      setUnclaimedDeposits([]);
      setHasRejectedDeposits(false);
    }
  }, [wallet]);

  const fetchFiatData = useCallback(async () => {
    try {
      const [rates, currencies] = await Promise.all([
        wallet.listFiatRates(),
        wallet.listFiatCurrencies(),
      ]);
      setFiatRates(rates);
      setFiatCurrencies(currencies);
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to fetch fiat data', { error: formatError(e) });
    }
  }, [wallet]);

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
          showPaymentReceivedNotification(amountSats);
        } else {
          showToastRef.current('success', 'Payment Sent', `${event.payment.amount} sats sent successfully`);
        }
      }
      refreshWalletData(false);
    } else if (event.type === 'claimedDeposits') {
      logger.info(LogCategory.PAYMENT, 'Deposits claimed', { count: event.claimedDeposits.length });
      showToastRef.current('success', 'Deposits Claimed Successfully', `${event.claimedDeposits.length} deposits were claimed`);
      showDepositClaimedNotification(event.claimedDeposits.length);
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
    try {
      logger.info(LogCategory.SDK, 'Initiating wallet connection', { restore });
      if (wallet.connected()) {
        logger.debug(LogCategory.SDK, 'Wallet already connected; skipping');
        return;
      }

      setIsLoading(true);
      setIsSyncing(restore);
      setError(null);

      if (!import.meta.env.VITE_BREEZ_API_KEY) {
        showToast('error', 'Missing API Key', 'Please add VITE_BREEZ_API_KEY to your .env file');
      }

      const cfg = buildConnectConfig(overrideNetwork);
      setConfig(cfg);
      await wallet.initWallet(mnemonic, cfg);

      logger.info(LogCategory.SDK, 'Wallet connected successfully');
      wallet.saveMnemonic(mnemonic);

      const [info, txns] = await Promise.all([
        wallet.getWalletInfo(),
        wallet.getTransactions(),
      ]);
      setWalletInfo(info);
      setTransactions(txns);

      setIsConnected(true);
      await fetchUnclaimedDeposits();
      setIsLoading(false);
    } catch (e) {
      logger.error(LogCategory.SDK, 'Error connecting wallet', { error: formatError(e) });
      setError('Failed to connect wallet. Please check your mnemonic and try again.');
      setIsSyncing(false);
      setIsLoading(false);
      setConfig(null);
      throw e;
    }
  }, [wallet, showToast, fetchUnclaimedDeposits]);

  const handleLogout = useCallback(async () => {
    try {
      setIsLoading(true);
      if (isConnected) await wallet.disconnect();
      await wallet.endLogSession();
      wallet.clearMnemonic();

      setIsConnected(false);
      setWalletInfo(null);
      setTransactions([]);
      setConfig(null);
      showToast('success', 'Successfully logged out');
    } catch (e) {
      logger.error(LogCategory.SESSION, 'Logout failed', { error: formatError(e) });
      setError('Failed to log out properly. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, wallet, showToast]);

  const handleBuyBitcoin = useCallback(async () => {
    try {
      const response = await wallet.buyBitcoin({});
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to open Buy Bitcoin', { error: formatError(e) });
      showToast('error', 'Buy Bitcoin', 'Failed to open MoonPay. Please try again.');
    }
  }, [wallet, showToast]);

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
    wallet.initLogSession().catch((e) => {
      logger.warn(LogCategory.SESSION, 'Failed to initialize log session', { error: formatError(e) });
    });

    const checkForExistingWallet = async () => {
      const savedMnemonic = wallet.getSavedMnemonic();
      if (savedMnemonic) {
        try {
          setIsLoading(true);
          await connectWallet(savedMnemonic, false);
        } catch (e) {
          logger.error(LogCategory.SDK, 'Failed to connect with saved mnemonic', { error: formatError(e) });
          setError('Failed to connect with saved mnemonic. Please try again.');
          wallet.clearMnemonic();
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
    if (isConnected) {
      wallet.addEventListener(handleSdkEvent)
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
          wallet.removeEventListener(eventListenerIdRef.current).catch(e => {
            logger.error(LogCategory.SDK, 'Error removing wallet event listener', { error: formatError(e) });
          });
          eventListenerIdRef.current = null;
        }
      };
    }
  }, [isConnected, handleSdkEvent, wallet]);

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
