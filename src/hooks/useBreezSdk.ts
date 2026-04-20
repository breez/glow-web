import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
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
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { useLatest } from './useLatest';
import { buildConnectConfig } from './buildConnectConfig';
import { logger, LogCategory, logSdkMessage } from '../services/logger';
import { formatError } from '../utils/formatError';
import { isDepositRejected, clearRejectedDeposits } from '../services/depositState';
import { setCachedStableTicker, clearNetworkOverride, clearStableRestorePrompted, type BuyBitcoinProvider } from '../services/settings';
import { hideSplash } from '../main';
import {
  isPrfAvailable,
  isPasskeyMode,
  setPasskeyMode,
  clearPasskeyMode,
  getKnownCredentialIdsBase64,
  hasPasskeyHistory,
  markLabelUsed,
  invalidatePasskey,
  pinActivePasskeyCredentialId,
  signInPinnedToActiveCredential,
  setPendingSwitchFromCredentialId,
} from '../services/passkeyService';
import { secureStorage, deviceOnlyStorage, SecureStorageError } from '../services/secureStorage';


// ============================================
// Payment filtering
// ============================================

/** Filter out ongoing payment conversions not yet linked */
function filterOngoingConversionPayments(payments: Payment[]): Payment[] {
  return payments.filter(p => {
    const conversionInfo = p.details &&
      'conversionInfo' in p.details ? p.details.conversionInfo : null;
    if (!conversionInfo || conversionInfo.type !== 'amm') return true;
    return conversionInfo.purpose?.type !== 'ongoingPayment';
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
 * On native, copy any plaintext localStorage mnemonic into the
 * device-only secure-storage tier (NOT the biometric-bound tier:
 * these are pre-0.0.3 non-passkey users who never opted into
 * biometrics) and wipe the plaintext copy. Idempotent and non-fatal:
 * retried every startup until done, legacy path keeps working in the
 * meantime.
 */
async function migrateLegacyMnemonicIfNeeded(): Promise<void> {
  if (!deviceOnlyStorage.isSupported()) return;
  const legacy = getSavedMnemonic();
  if (!legacy) return;
  try {
    if (await deviceOnlyStorage.hasStoredSeed()) return;
    await deviceOnlyStorage.storeSeed({ type: 'mnemonic', mnemonic: legacy });
    clearMnemonic();
    logger.info(LogCategory.AUTH, 'Migrated plaintext mnemonic into device-only secure storage');
  } catch {
    // deviceOnlyStorage logged the typed error; we'll retry next startup.
  }
}

// ============================================
// Types
// ============================================

/**
 * Coarse-grained state machine for startup / lock screen routing:
 * - `'loading'`: mount, auto-reconnect in progress (spinner).
 * - `'no-wallet'`: no credentials persisted (welcome / onboarding).
 * - `'native-unlocking'`: auth ceremony in flight (biometric on native,
 *   WebAuthn on web). Router shows branded UnlockingPage placeholder.
 * - `'native-locked'`: biometric cancelled or locked out (interactive
 *   UnlockPage with retry + re-onboard escape).
 * - `'connected'`: SDK is connected to a wallet.
 */
export type StartupState =
  | 'loading'
  | 'no-wallet'
  | 'native-unlocking'
  | 'native-locked'
  | 'connected';

export interface BreezSdkState {
  sdk: BreezSdk | null;
  isConnected: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  walletInfo: GetInfoResponse | null;
  transactions: Payment[];
  hasPendingConversion: boolean;
  unclaimedDeposits: DepositInfo[];
  config: Config | null;
  error: string | null;
  hasRejectedDeposits: boolean;
  celebrationPayment: Payment | null;
  prfAvailable: boolean;
  hasPasskeyBefore: boolean;
  /**
   * True on the first app session after a fresh install (or
   * cross-device Apple-ID restore), set when the startup probe
   * restores `passkeyRegistered` from the iCloud-synced keychain.
   * PasskeyPage consumes this once to allow ONE silent retry of the
   * detecting phase: credential-ID metadata syncs faster than the
   * actual passkey records, so the first assertion can fast-fail with
   * no Face ID prompt; the retry bridges that window.
   */
  isFreshInstallRestore: boolean;
  startupState: StartupState;
  /**
   * True while `secureStorage.storeSeed` is in flight during
   * onboarding so the UI can swap "Starting Glow…" for "Setting up
   * biometric unlock…", explaining the second biometric prompt right
   * after the passkey ceremony. Only set by `connectWallet`'s
   * onboarding path; the retrieve path has its own loading copy.
   */
  isSecuringSeed: boolean;
}

export type SdkEventHandler = (event: SdkEvent) => void;
export type SdkEventUnsubscribe = () => void;

/**
 * Where the seed handed to `connectWallet` came from. Gates the
 * post-connect persist block: `'onboarding'` writes to secure storage,
 * `'secureStorage'` skips it (the seed was just retrieved from there).
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
  subscribeToSdkEvents: (handler: SdkEventHandler) => SdkEventUnsubscribe;
  /**
   * Read `isFreshInstallRestore` and atomically flip it to false so
   * the silent retry only fires on the first sign-in attempt of a
   * post-fresh-install session.
   */
  consumeFreshInstallSignal: () => boolean;
  /**
   * Called from `UnlockPage` to retry the biometric unlock after an earlier
   * cancel or lockout. Re-runs `secureStorage.retrieveSeed` then
   * `connectWallet` and updates `startupState` based on the outcome.
   */
  retryUnlock: () => Promise<void>;
  /**
   * Disconnect, derive the new wallet via passkey, reconnect with it.
   * Throws on PRF cancel / network failure / SDK error.
   */
  switchPasskeyLabel: (newLabel: string) => Promise<void>;
  /**
   * Pin a different passkey credential for the next sign-in and clear
   * the active SDK session + label so the caller can route through
   * PasskeyPage (which runs label discovery against the new cred's
   * Nostr identity). Does not run any biometric ceremony itself.
   *
   * The optional `onPinned` callback fires synchronously after the
   * localStorage pin but BEFORE the SDK is nulled, so callers can
   * navigate away from layers that depend on `useWallet()` (e.g.
   * SettingsPage under PasskeyManagementPage) before the SDK
   * disappears, avoiding a transient render with `sdk = null` while
   * those layers are still mounted.
   */
  prepareSwitchPasskeyCredential: (newCredId: string, onPinned?: () => void) => Promise<void>;
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
  // Any payment in the latest snapshot that's still mid-conversion (e.g.
  // auto-conversion in flight after a receive). While true, balances are in
  // motion and Send All flows shouldn't trust the snapshot.
  const hasPendingConversion = useMemo(
    () => transactions.some(p => p.conversionDetails?.status === 'pending'),
    [transactions],
  );
  const [unclaimedDeposits, setUnclaimedDeposits] = useState<DepositInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [hasRejectedDeposits, setHasRejectedDeposits] = useState(false);
  const [celebrationPayment, setCelebrationPayment] = useState<Payment | null>(null);
  const [prfAvailable, setPrfAvailable] = useState(false);
  const [startupState, setStartupState] = useState<StartupState>('loading');
  const [isSecuringSeed, setIsSecuringSeed] = useState(false);

  // Refs
  const isInitialLoadRef = useRef(true);
  const eventListenerIdRef = useRef<string | null>(null);
  const shownPaymentIdsRef = useRef<Set<string>>(new Set());
  const sdkRef = useLatest(sdk);
  // Guards the retryUnlock flow against concurrent invocation. The
  // app-resume listener and checkForExistingWallet both try to fire
  // retryUnlock on their own schedules, and BiometricPrompt crashes
  // if authenticate() is called while another prompt is already live.
  const retryUnlockInFlightRef = useRef(false);

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
        // Send toast suppressed: ResultStep dialog already shows success
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

      // Non-sensitive marker so the legacy path can still detect
      // passkey mode if secure storage is unavailable later
      // (KEY_INVALIDATED on biometric change).
      if (passkeyLabel != null) {
        setPasskeyMode(passkeyLabel);
        markLabelUsed(passkeyLabel);
      }

      // Write the seed to the right tier for this mode. Skip entirely
      // when the seed was just retrieved from secure storage. Storage
      // tiers: passkey native => biometric-bound `secureStorage`,
      // non-passkey native => `deviceOnlyStorage` (no biometric gate),
      // web passkey => no cache, web non-passkey => plaintext fallback.
      // Failures are non-fatal: the wallet is already connected, and
      // the storage layer emits its own typed breadcrumb.
      if (source !== 'secureStorage') {
        if (passkeyLabel != null && secureStorage.isSupported()) {
          // Defer the loading-copy flip so a fast Keystore write
          // doesn't flash the "Setting up biometric unlock…" label.
          const labelDeferMs = 250;
          let flipped = false;
          const flipTimer = setTimeout(() => {
            flipped = true;
            setIsSecuringSeed(true);
          }, labelDeferMs);
          try {
            await secureStorage.storeSeed(seed);
          } catch {
            // non-fatal; storage layer logged.
          } finally {
            clearTimeout(flipTimer);
            if (flipped) setIsSecuringSeed(false);
          }
        } else if (deviceOnlyStorage.isSupported()) {
          try {
            await deviceOnlyStorage.storeSeed(seed);
          } catch {
            // non-fatal; storage layer logged.
          }
        } else if (passkeyLabel != null) {
          // Web passkey mode: never cache the PRF-derived seed.
          clearMnemonic();
        } else if (seed.type === 'mnemonic') {
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

    // Wipe reconnect signals first so a hung sdk.disconnect() can't
    // strand the user with a wallet that auto-reconnects on refresh.
    clearMnemonic();
    clearPasskeyMode();

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

    // Wipe both tiers. Non-fatal: the user is logged out either way,
    // and each tier emits its own typed error breadcrumb.
    if (secureStorage.isSupported()) {
      try { await secureStorage.clearSeed(); } catch { /* non-fatal */ }
    }
    if (deviceOnlyStorage.isSupported()) {
      try { await deviceOnlyStorage.clearSeed(); } catch { /* non-fatal */ }
    }

    // Always reset all state, even if disconnect threw.
    setSdk(null);
    setCachedStableTicker(null);
    clearStableRestorePrompted();
    clearRejectedDeposits();
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

  const switchPasskeyLabel = useCallback(async (newLabel: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    // Drop the cached Passkey so the new label gets a fresh Nostr
    // OnceCell. Without this, the SDK reuses the prior label's
    // identity in cached state.
    invalidatePasskey();

    // PRF first so a cancel here leaves the active wallet untouched.
    let wallet;
    try {
      // Switching label stays on the same passkey, so this pins to the
      // active credential rather than letting the OS picker derive the
      // new label under a different identity.
      const result = await signInPinnedToActiveCredential(newLabel);
      wallet = result.wallet;
    } catch (e) {
      setIsLoading(false);
      throw e;
    }

    if (sdk) {
      try {
        await sdk.disconnect();
      } catch (e) {
        logger.warn(LogCategory.SDK, 'SDK disconnect failed during label switch', {
          error: formatError(e),
        });
      }
    }
    setSdk(null);
    setIsConnected(false);
    setIsSyncing(true);
    setWalletInfo(null);
    setTransactions([]);
    setUnclaimedDeposits([]);
    setHasRejectedDeposits(false);
    setCelebrationPayment(null);
    setCachedStableTicker(null);
    clearStableRestorePrompted();
    shownPaymentIdsRef.current.clear();

    if (secureStorage.isSupported()) {
      try {
        await secureStorage.clearSeed();
      } catch {
        // storeSeed below overwrites anyway.
      }
    }

    let connectedSdk: BreezSdk | undefined;
    try {
      const cfg = buildConnectConfig();
      setConfig(cfg);

      connectedSdk = await connect({
        config: cfg,
        seed: wallet.seed,
        storageDir: 'spark-wallet-example',
      });
      setSdk(connectedSdk);
      setPasskeyMode(wallet.label);

      if (secureStorage.isSupported()) {
        try {
          await secureStorage.storeSeed(wallet.seed);
        } catch {
          // In-memory seed keeps the session alive; relaunch re-prompts.
        }
      }

      const [info, txns] = await Promise.all([
        connectedSdk.getInfo({}),
        connectedSdk.listPayments({ offset: 0, limit: 100 }),
      ]);
      setWalletInfo(info);
      setTransactions(filterOngoingConversionPayments(txns.payments));
      setIsConnected(true);
      markLabelUsed(wallet.label);

      try {
        const result = await connectedSdk.listUnclaimedDeposits({});
        setUnclaimedDeposits(result.deposits);
        setHasRejectedDeposits(result.deposits.some(d => isDepositRejected(d.txid, d.vout)));
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Deposit fetch failed after label switch', {
          error: formatError(e),
        });
      }
    } catch (e) {
      const errorMsg = formatError(e);
      logger.error(LogCategory.SDK, 'Failed to connect after label switch', { error: errorMsg });
      if (connectedSdk) {
        try { await connectedSdk.disconnect(); } catch { /* best-effort */ }
        setSdk(null);
      }
      setError('Failed to switch label. Please try again.');
      throw e;
    } finally {
      setIsSyncing(false);
      setIsLoading(false);
    }
  }, [sdk]);

  const prepareSwitchPasskeyCredential = useCallback(async (
    newCredId: string,
    onPinned?: () => void,
  ): Promise<void> => {
    // Remember the prior cred so PasskeyPage's detect-failure branch
    // can roll back if the new one turns out to be deleted.
    const fromCredId = localStorage.getItem('passkeyActiveCredentialId');
    if (fromCredId && fromCredId !== newCredId) {
      setPendingSwitchFromCredentialId(fromCredId);
    }

    // Pin BEFORE invalidating so the next derive (in PasskeyPage's
    // detect) picks up the new cred via `allowCredentials`. Also
    // clears the active label since each cred has its own Nostr id.
    pinActivePasskeyCredentialId(newCredId);

    // Fire onPinned synchronously so callers can unmount any layers
    // that depend on `useWallet()` BEFORE we null the SDK below.
    // Otherwise SettingsPage's useWallet() throws on the transient
    // sdk=null render and blanks the screen until reload.
    onPinned?.();

    setIsLoading(true);
    setError(null);

    if (sdk) {
      try {
        await sdk.disconnect();
      } catch (e) {
        logger.warn(LogCategory.SDK, 'SDK disconnect failed during credential switch', {
          error: formatError(e),
        });
      }
    }

    // Wipe the previous identity's seed from secure storage so the
    // startup probe doesn't auto-rehydrate the old wallet on the way
    // back through PasskeyPage.
    if (secureStorage.isSupported()) {
      try {
        await secureStorage.clearSeed();
      } catch {
        // Best effort; the next storeSeed overwrites.
      }
    }

    setSdk(null);
    setIsConnected(false);
    setIsSyncing(false);
    setWalletInfo(null);
    setTransactions([]);
    setUnclaimedDeposits([]);
    setHasRejectedDeposits(false);
    setCelebrationPayment(null);
    setCachedStableTicker(null);
    clearStableRestorePrompted();
    shownPaymentIdsRef.current.clear();
    setIsLoading(false);
  }, [sdk]);

  // Re-run the biometric unlock flow after the user cancelled or was locked
  // out on the previous attempt. Called by UnlockPage's "Unlock" button,
  // and also auto-fired by checkForExistingWallet on mount and by the
  // app-resume listener when the user tabs back into a stuck
  // UnlockingPage.
  const retryUnlock = useCallback(async () => {
    logger.info(LogCategory.AUTH, 'retryUnlock:enter');
    // Prevent concurrent biometric prompts: BiometricPrompt throws if
    // authenticate() is called while another prompt is already live,
    // and the two call-sites (mount timeout + resume listener) can
    // race. The ref is set synchronously before the first await so
    // the second caller bails out cleanly.
    if (retryUnlockInFlightRef.current) {
      logger.warn(LogCategory.AUTH, 'retryUnlock:skipped (in-flight)');
      return;
    }
    retryUnlockInFlightRef.current = true;
    if (!secureStorage.isSupported()) {
      if (!isPasskeyMode()) {
        setStartupState('no-wallet');
        retryUnlockInFlightRef.current = false;
        return;
      }
      setError(null);
      flushSync(() => {
        setStartupState('native-unlocking');
        setIsLoading(true);
      });
      try {
        const effectiveLabel = localStorage.getItem('passkeyLabel') ?? undefined;
        const response = await signInPinnedToActiveCredential(effectiveLabel);
        await connectWallet(response.wallet.seed, false, response.wallet.label);
      } catch (e) {
        logger.error(LogCategory.AUTH, 'Web passkey retry failed', { error: formatError(e) });
        setError('Failed to authenticate with passkey. Please try again.');
        setStartupState('native-locked');
        setIsLoading(false);
      } finally {
        retryUnlockInFlightRef.current = false;
      }
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      logger.info(LogCategory.AUTH, 'retryUnlock:callingRetrieveSeed');
      const seed = await secureStorage.retrieveSeed();
      await connectWallet(seed, false, undefined, 'secureStorage');
      // connectWallet sets startupState='connected' on success.
    } catch (e) {
      setIsLoading(false);
      if (e instanceof SecureStorageError) {
        switch (e.code) {
          case 'USER_CANCELLED':
            // Silent: stay on UnlockPage and let the user tap again.
            setStartupState('native-locked');
            break;
          case 'BIOMETRIC_LOCKOUT':
            setError(
              'Biometric unlock is locked. Unlock your device with your passcode and try again.',
            );
            setStartupState('native-locked');
            break;
          case 'KEY_INVALIDATED':
            // Voided by a new biometric enrollment. Wipe + re-onboard.
            await secureStorage.clearSeed().catch(() => { /* best-effort */ });
            setError('Your biometric enrollment changed. Please set up your wallet again.');
            setStartupState('no-wallet');
            break;
          case 'BIOMETRIC_NOT_ENROLLED':
            setError('Biometric authentication is not set up on this device.');
            setStartupState('no-wallet');
            break;
          case 'BIOMETRIC_UNAVAILABLE':
            // Common iOS cause: user denied NSFaceIDUsageDescription.
            // Keep the user on UnlockPage with actionable copy instead
            // of routing back to welcome (which would look like the
            // wallet was lost).
            setError(
              'Biometric authentication is unavailable. Please enable Face ID / Touch ID / fingerprint for Glow in your device settings and try again.',
            );
            setStartupState('native-locked');
            break;
          case 'NO_STORED_SEED':
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
    } finally {
      retryUnlockInFlightRef.current = false;
    }
  }, [connectWallet]);

  const handleBuyBitcoin = useCallback(async (provider: BuyBitcoinProvider) => {
    if (!sdk) return;
    // CashApp requires an amount and is driven by the BuyBitcoinDialog amount step
    // (see useBuyBitcoin.generate), so this top-level handler only covers
    // redirect-only providers like MoonPay.
    if (provider === 'cashApp') return;

    // On web, pre-open a blank tab synchronously during the user gesture
    // so the popup blocker doesn't swallow it after the await. On native
    // hosts we defer the URL open until after the SDK responds and hand
    // it straight to @capacitor/browser (Chrome Custom Tabs on Android,
    // SFSafariViewController on iOS), which opens the provider page
    // completely outside the app's WebView (avoiding the earlier bug
    // where setting window.location.href navigated the glow-web WebView
    // to the provider URL and got stuck in a redirect loop when the
    // user returned to the app).
    const isNative = Capacitor.isNativePlatform();
    const newTab = isNative ? null : window.open('', '_blank');

    try {
      const response = await sdk.buyBitcoin({ type: 'moonpay' });
      if (isNative) {
        await Browser.open({ url: response.url });
      } else if (newTab) {
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

  // Set on the first launch after a fresh install (or cross-device
  // Apple-ID restore) when the startup probe sees credentials in the
  // iCloud-synced keychain but no local `passkeyRegistered` flag.
  // PasskeyPage consumes this once to allow a silent retry while the
  // synced credential records finish propagating (see BreezSdkState).
  const [freshInstallRestore, setFreshInstallRestore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const ids = await getKnownCredentialIdsBase64();
        if (cancelled) return;
        if (ids.length > 0 && localStorage.getItem('passkeyRegistered') !== '1') {
          logger.info(LogCategory.AUTH, 'Restoring passkeyRegistered flag from synced keychain', { count: ids.length });
          localStorage.setItem('passkeyRegistered', '1');
          setFreshInstallRestore(true);
        }
      } catch (e) {
        // Web build returns []; native plugin failures shouldn't block start.
        logger.debug(LogCategory.AUTH, 'getKnownCredentialIds failed during startup probe', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };
    run();
    return () => { cancelled = true; };
  }, []);

  // Auto-reconnect on mount
  useEffect(() => {
    logger.initSession().catch((e) => {
      logger.warn(LogCategory.SESSION, 'Failed to initialize log session', { error: formatError(e) });
    });

    const checkForExistingWallet = async () => {
      // (A) Legacy plaintext-mnemonic migration (native only).
      await migrateLegacyMnemonicIfNeeded();

      // (B) 0.0.3 regression recovery: that release wrote every seed
      //     into the biometric-bound tier, including non-passkey users.
      //     Wipe the orphan silently so they re-onboard via mnemonic
      //     into the right tier. `clearSeed` is unauthenticated.
      if (
        secureStorage.isSupported()
        && !isPasskeyMode()
        && (await secureStorage.hasStoredSeed())
      ) {
        logger.warn(
          LogCategory.AUTH,
          'Clearing orphaned biometric-bound seed from 0.0.3 regression',
        );
        await secureStorage.clearSeed().catch(() => { /* best-effort */ });
      }

      // (C) Passkey biometric unlock. Order matters so the OS prompt
      //     lands over a fully-painted UnlockingPage, not a black
      //     splash: flushSync commits the route change before
      //     hideSplash() awaits the WAAPI fade on the compositor, then
      //     retryUnlock fires. CSS-transition-based fades janked the
      //     main thread on Android WebView; WAAPI sidesteps that.
      let useLegacy = true;
      if (
        isPasskeyMode()
        && secureStorage.isSupported()
        && (await secureStorage.hasStoredSeed())
      ) {
        logger.info(LogCategory.AUTH, 'unlock:start');
        flushSync(() => {
          setStartupState('native-unlocking');
        });
        useLegacy = false;

        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
          await hideSplash();
        }

        // Fire-and-forget: retryUnlock owns its error handling and
        // transitions startupState (success => 'connected',
        // cancel/lockout => 'native-locked').
        void retryUnlock();
      } else if (
        deviceOnlyStorage.isSupported()
        && (await deviceOnlyStorage.hasStoredSeed())
      ) {
        // (D) Non-passkey native silent reconnect. Plain decrypt, no
        //     biometric prompt. `source: 'secureStorage'` skips the
        //     redundant re-write.
        useLegacy = false;
        setIsLoading(true);
        try {
          const seed = await deviceOnlyStorage.retrieveSeed();
          await connectWallet(seed, false, undefined, 'secureStorage');
        } catch (e) {
          logger.error(
            LogCategory.SDK,
            'Failed to silently reconnect from device-only storage',
            { error: formatError(e) },
          );
          setIsLoading(false);
        }
      }

      // (E) Legacy flow: web, or native with no stored seed.
      if (useLegacy) {
        if (isPasskeyMode()) {
          // Passkey mode always re-derives via PRF on launch.
          clearMnemonic();
        }
        const savedMnemonic = !isPasskeyMode() ? getSavedMnemonic() : null;
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
          // Passkey mode without stored seed: re-derive via PRF.
          // flushSync commits UnlockingPage before the WebAuthn prompt
          // fires, then hideSplash drops the index.html splash so it
          // doesn't sit on top.
          flushSync(() => {
            setStartupState('native-unlocking');
            setIsLoading(true);
          });
          if (isInitialLoadRef.current) {
            isInitialLoadRef.current = false;
            await hideSplash();
          }
          let wallet;
          try {
            // Falls back to the stored `passkeyLabel`; SDK accepts
            // `undefined` for "use whatever signIn negotiates".
            const effectiveLabel = localStorage.getItem('passkeyLabel') ?? undefined;
            const result = await signInPinnedToActiveCredential(effectiveLabel);
            wallet = result.wallet;
          } catch (e) {
            logger.error(LogCategory.AUTH, 'Passkey authentication failed', { error: formatError(e) });
            setError('Failed to authenticate with passkey. Please try again.');
            setStartupState('native-locked');
            setIsLoading(false);
          }
          if (wallet) {
            try {
              await connectWallet(wallet.seed, false, wallet.label);
            } catch (e) {
              logger.error(LogCategory.SDK, 'Failed to connect after passkey auth', { error: formatError(e) });
              setError('Failed to connect wallet. Please try again.');
              setStartupState('native-locked');
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
        // Fire-and-forget on the non-passkey tail: we're not racing
        // the biometric prompt here, so there's no reason to await
        // the fade. hideSplash resolves on its own timeline.
        void hideSplash();
      }
    };

    checkForExistingWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initialization
  }, []);

  // Re-fire retryUnlock on foreground return while stuck on
  // UnlockingPage. Guards the race where the user backgrounds the app
  // during the splash fade: BiometricPrompt would land on a
  // non-STARTED activity, FragmentManager would refuse the
  // transaction, and the auth callback would never fire (JS Promise
  // hangs, UnlockingPage visible with no prompt). Native side guards
  // this too; this listener is a belt-and-braces fallback.
  // `retryUnlockInFlightRef` makes the call idempotent.
  const startupStateRef = useLatest(startupState);
  const retryUnlockRef = useLatest(retryUnlock);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      if (startupStateRef.current === 'native-unlocking') {
        void retryUnlockRef.current();
      }
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [startupStateRef, retryUnlockRef]);

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
    hasPendingConversion,
    unclaimedDeposits,
    config,
    error,
    hasRejectedDeposits,
    celebrationPayment,
    prfAvailable,
    hasPasskeyBefore: hasPasskeyHistory(),
    isFreshInstallRestore: freshInstallRestore,
    startupState,
    isSecuringSeed,
    // Actions
    connectWallet,
    refreshWalletData,
    fetchUnclaimedDeposits,
    handleLogout,
    handleBuyBitcoin,
    clearError: () => setError(null),
    dismissCelebration: () => setCelebrationPayment(null),
    subscribeToSdkEvents,
    consumeFreshInstallSignal: () => {
      const v = freshInstallRestore;
      if (v) setFreshInstallRestore(false);
      return v;
    },
    retryUnlock,
    switchPasskeyLabel,
    prepareSwitchPasskeyCredential,
  };
}
