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
import { secureStorage, SecureStorageError } from '../services/secureStorage';


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
// Legacy mnemonic → secure storage migration
// ============================================

/**
 * One-shot migration helper. On a native build, if the user has a plaintext
 * mnemonic in localStorage AND nothing in secure storage yet, copy it across
 * and wipe the plaintext copy. Runs silently on every startup until the
 * migration completes — after that, `getSavedMnemonic()` returns null and
 * the helper is a no-op.
 *
 * Failure here is non-fatal: we keep the legacy mnemonic in place and try
 * again on the next startup. The wallet still connects via the legacy path
 * in the meantime.
 */
async function migrateLegacyMnemonicIfNeeded(): Promise<void> {
  if (!secureStorage.isSupported()) return;
  const legacy = getSavedMnemonic();
  if (!legacy) return;
  try {
    if (await secureStorage.hasStoredSeed()) return;
    await secureStorage.storeSeed({ type: 'mnemonic', mnemonic: legacy });
    clearMnemonic();
    logger.info(LogCategory.AUTH, 'Migrated plaintext mnemonic into secure storage');
  } catch {
    // Failure is non-fatal — secureStorage already logged the typed error
    // code via its own breadcrumbs. We keep the legacy mnemonic in place
    // and try again on the next startup; the wallet still connects via
    // the legacy path in the meantime.
  }
}

// ============================================
// Types
// ============================================

/**
 * Coarse-grained state machine for the startup / lock screen routing.
 *
 * - `'loading'`: initial mount, auto-reconnect in progress. Router shows a spinner.
 * - `'no-wallet'`: no credentials persisted anywhere. Router shows the welcome
 *   / onboarding page.
 * - `'native-locked'`: a seed is persisted in native secure storage but the
 *   most recent biometric attempt was cancelled or locked out. Router shows
 *   the dedicated unlock page — from which the user can retry biometric or
 *   abandon the locked wallet and re-onboard.
 * - `'connected'`: the SDK is connected to a wallet.
 */
export type StartupState = 'loading' | 'no-wallet' | 'native-locked' | 'connected';

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
  startupState: StartupState;
}

/**
 * Where the seed handed to `connectWallet` came from. Controls whether the
 * post-connect persist block writes the seed back to secure storage.
 *
 * - `'onboarding'` (default): the seed is fresh from the passkey ceremony or
 *   mnemonic restore flow; secure storage doesn't have it yet, so we write.
 * - `'secureStorage'`: the seed was just retrieved from native secure
 *   storage; writing it back is a redundant Keystore round-trip.
 */
export type ConnectSeedSource = 'onboarding' | 'secureStorage';

export interface BreezSdkActions {
  connectWallet: (
    seed: Seed,
    restore: boolean,
    passkeyLabel?: string,
    source?: ConnectSeedSource,
  ) => Promise<void>;
  refreshWalletData: (showLoading?: boolean) => Promise<void>;
  fetchUnclaimedDeposits: () => Promise<void>;
  handleLogout: () => Promise<void>;
  handleBuyBitcoin: (provider: BuyBitcoinProvider) => Promise<void>;
  clearError: () => void;
  dismissCelebration: () => void;
  /**
   * Called from `UnlockPage` to retry the biometric unlock after an earlier
   * cancel or lockout. Re-runs `secureStorage.retrieveSeed` → `connectWallet`
   * and updates `startupState` based on the outcome.
   */
  retryUnlock: () => Promise<void>;
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
  const [startupState, setStartupState] = useState<StartupState>('loading');

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
  }, [refreshWalletData, fetchUnclaimedDeposits, isSyncingRef, showToastRef]);

  // ----------------------------------------
  // Connection lifecycle
  // ----------------------------------------

  const connectWallet = useCallback(async (
    seed: Seed,
    restore: boolean,
    passkeyLabel?: string,
    source: ConnectSeedSource = 'onboarding',
  ) => {
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

      // Always persist the passkey label marker (non-sensitive) so the
      // legacy fallback path can still detect passkey mode if secure storage
      // becomes unavailable later (e.g. KEY_INVALIDATED on biometric change).
      if (passkeyLabel != null) {
        setPasskeyMode(passkeyLabel);
      }

      // Persist the seed itself — but skip this entirely when the seed was
      // sourced from secure storage (we'd be writing the same bytes back
      // through a Keystore round-trip on every relaunch, which is wasteful
      // and clutters the breadcrumb trail).
      if (source !== 'secureStorage') {
        if (secureStorage.isSupported()) {
          // Native: write to Keychain / Keystore. Non-fatal on failure —
          // the wallet is already connected from the in-memory seed;
          // we'll retry on the next successful connect. secureStorage
          // emits its own typed error breadcrumb on failure, so we
          // don't double-log here.
          try {
            await secureStorage.storeSeed(seed);
          } catch {
            // Intentionally swallowed — see comment above.
          }
        } else if (seed.type === 'mnemonic') {
          // Web (legacy): unchanged plaintext localStorage write.
          saveMnemonic(seed.mnemonic);
        }
      }

      const [info, txns] = await Promise.all([
        connectedSdk.getInfo({}),
        connectedSdk.listPayments({ offset: 0, limit: 100 }),
      ]);
      setWalletInfo(info);
      setTransactions(filterOngoingConversionPayments(txns.payments));

      setIsConnected(true);
      setStartupState('connected');

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

    // Wipe secure storage first. Failure is non-fatal — the user is still
    // logged out either way. secureStorage emits its own typed error
    // breadcrumb on failure, so we don't double-log here.
    if (secureStorage.isSupported()) {
      try {
        await secureStorage.clearSeed();
      } catch {
        // Intentionally swallowed — see comment above.
      }
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
    setStartupState('no-wallet');
    clearNetworkOverride();
    showToast('success', 'Successfully logged out');
  }, [sdk, showToast]);

  // Re-run the biometric unlock flow after the user cancelled or was locked
  // out on the previous attempt. Called by UnlockPage's "Unlock" button.
  const retryUnlock = useCallback(async () => {
    if (!secureStorage.isSupported()) {
      // Web or unsupported host — should never reach UnlockPage here, but
      // route back to welcome just in case.
      setStartupState('no-wallet');
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const seed = await secureStorage.retrieveSeed();
      await connectWallet(seed, false, undefined, 'secureStorage');
      // connectWallet sets startupState='connected' on success.
    } catch (e) {
      setIsLoading(false);
      if (e instanceof SecureStorageError) {
        switch (e.code) {
          case 'USER_CANCELLED':
            // Silent — stay on UnlockPage, let the user tap again.
            setStartupState('native-locked');
            break;
          case 'BIOMETRIC_LOCKOUT':
            setError(
              'Biometric unlock is locked. Unlock your device with your passcode and try again.',
            );
            setStartupState('native-locked');
            break;
          case 'KEY_INVALIDATED':
            // Stored entry voided (e.g. new biometric enrollment). Wipe and
            // route the user back to welcome so they can re-onboard.
            await secureStorage.clearSeed().catch(() => { /* best-effort */ });
            setError('Your biometric enrollment changed. Please set up your wallet again.');
            setStartupState('no-wallet');
            break;
          case 'BIOMETRIC_NOT_ENROLLED':
          case 'BIOMETRIC_UNAVAILABLE':
            setError('Biometric authentication is no longer available on this device.');
            setStartupState('no-wallet');
            break;
          case 'NO_STORED_SEED':
            // Nothing to retrieve — back to welcome.
            setStartupState('no-wallet');
            break;
          case 'NOT_SUPPORTED':
          case 'UNKNOWN':
          default:
            setError('Unable to unlock wallet. Please try again.');
            setStartupState('native-locked');
            break;
        }
      } else {
        logger.error(LogCategory.SDK, 'Unexpected error retrying unlock', {
          error: formatError(e),
        });
        setError('Unable to unlock wallet. Please try again.');
        setStartupState('native-locked');
      }
    }
  }, [connectWallet]);

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
      // (A) One-shot migration: on native, copy any plaintext mnemonic into
      //     secure storage and wipe the plaintext copy. No-op on web.
      await migrateLegacyMnemonicIfNeeded();

      // (B) Native secure-storage path. Tries biometric unlock first; on any
      //     recoverable failure, falls through to the legacy path below.
      let useLegacy = true;
      if (secureStorage.isSupported() && (await secureStorage.hasStoredSeed())) {
        setIsLoading(true);
        try {
          const seed = await secureStorage.retrieveSeed();
          // Pass source='secureStorage' so connectWallet's post-connect
          // persist block skips the redundant storeSeed write — we just
          // pulled this seed from the same store.
          await connectWallet(seed, false, undefined, 'secureStorage');
          useLegacy = false;
        } catch (e) {
          if (e instanceof SecureStorageError) {
            switch (e.code) {
              case 'USER_CANCELLED':
                // User dismissed the biometric prompt. Route to the
                // dedicated UnlockPage so they can retry or abandon the
                // stored wallet.
                setIsLoading(false);
                setStartupState('native-locked');
                useLegacy = false;
                break;
              case 'BIOMETRIC_LOCKOUT':
                setError(
                  'Biometric unlock is locked. Unlock your device with your passcode and try again.',
                );
                setIsLoading(false);
                setStartupState('native-locked');
                useLegacy = false;
                break;
              case 'KEY_INVALIDATED':
                // Stored entry voided (e.g. new biometric enrollment).
                // Wipe and fall through to legacy onboarding.
                await secureStorage.clearSeed().catch(() => {
                  /* best-effort */
                });
                break;
              case 'NO_STORED_SEED':
              case 'BIOMETRIC_NOT_ENROLLED':
              case 'BIOMETRIC_UNAVAILABLE':
              case 'NOT_SUPPORTED':
              case 'UNKNOWN':
              default:
                // Fall through to legacy path.
                break;
            }
          } else {
            logger.error(LogCategory.SDK, 'Unexpected error retrieving secure seed', {
              error: formatError(e),
            });
            // Fall through to legacy path.
          }
        }
      }

      // (C) Legacy flow. Reached on web, or on native when secure storage
      //     was bypassed (no stored seed, biometric not enrolled, etc.).
      if (useLegacy) {
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
      }

      // Default any leftover 'loading' state to 'no-wallet' so the router
      // can show the welcome page. If a success path already transitioned
      // to 'connected' or a locked path set 'native-locked', this functional
      // update leaves it untouched.
      setStartupState((current) => (current === 'loading' ? 'no-wallet' : current));

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
    startupState,
    // Actions
    connectWallet,
    refreshWalletData,
    fetchUnclaimedDeposits,
    handleLogout,
    handleBuyBitcoin,
    clearError: () => setError(null),
    dismissCelebration: () => setCelebrationPayment(null),
    retryUnlock,
  };
}
