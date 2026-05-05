import { useEffect, useState, useCallback, useRef } from 'react';
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
import { isDepositRejected } from '../services/depositState';
import { setCachedStableTicker, clearNetworkOverride, clearStableRestorePrompted, type BuyBitcoinProvider } from '../services/settings';
import { hideSplash } from '../main';
import {
  isPrfAvailable,
  isPasskeyMode,
  setPasskeyMode,
  clearPasskeyMode,
  getWallet,
  hasPasskeyHistory,
  markLabelUsed,
} from '../services/passkeyService';
import { secureStorage, deviceOnlyStorage, SecureStorageError } from '../services/secureStorage';
import { passkeyPrfProvider } from '../services/passkeyPrfProvider';


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
 * mnemonic in localStorage AND nothing in device-only secure storage yet,
 * copy it across and wipe the plaintext copy. Runs silently on every
 * startup until the migration completes — after that, `getSavedMnemonic()`
 * returns null and the helper is a no-op.
 *
 * Targets the device-only tier (not the biometric-bound tier) because
 * pre-0.0.3 installs had no passkey mode for these users — they are
 * non-passkey mnemonic users, and the 0.0.3 regression that forced them
 * through a biometric prompt is the whole reason this branch exists.
 * Migrating them into the biometric tier would repeat that mistake.
 *
 * Failure here is non-fatal: we keep the legacy mnemonic in place and try
 * again on the next startup. The wallet still connects via the legacy path
 * in the meantime.
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
    // Failure is non-fatal — deviceOnlyStorage already logged the typed
    // error code via its own breadcrumbs. We keep the legacy mnemonic
    // in place and try again on the next startup; the wallet still
    // connects via the legacy path in the meantime.
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
 * - `'native-unlocking'`: a seed is persisted in native secure storage and an
 *   auto-triggered biometric prompt is currently visible. Router shows the
 *   `UnlockingPage` placeholder (Glow logo + "Authenticating…" spinner) as a
 *   branded backdrop behind the OS biometric card.
 * - `'native-locked'`: the auto-triggered biometric was cancelled or hit the
 *   biometric lockout — router shows the interactive `UnlockPage` from which
 *   the user can retry biometric or abandon the locked wallet and re-onboard.
 * - `'connected'`: the SDK is connected to a wallet.
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
  unclaimedDeposits: DepositInfo[];
  config: Config | null;
  error: string | null;
  hasRejectedDeposits: boolean;
  celebrationPayment: Payment | null;
  prfAvailable: boolean;
  hasPasskeyBefore: boolean;
  /**
   * True for the first app session after a fresh install (or restore
   * from another Apple-ID device), set by the startup probe when it
   * restores `passkeyRegistered` from the iCloud-synced keychain.
   *
   * PasskeyPage reads this once on mount via `consumeFreshInstallSignal`
   * to enable a one-shot silent retry of the detecting phase: iCloud
   * Keychain syncs our credential-IDs metadata fast enough for the
   * home screen to render "Sign in with passkey", but the actual
   * passkey credential records can lag a few seconds. The first
   * assertion fails fast with no Face ID prompt; the silent retry
   * bridges that window.
   *
   * Consumed (flipped to false) on first read so subsequent sign-in
   * attempts in the same session don't get the silent retry — only
   * the post-fresh-install case where the iCloud race actually applies.
   */
  isFreshInstallRestore: boolean;
  startupState: StartupState;
  /**
   * True while `secureStorage.storeSeed` is in flight during
   * onboarding. UI code uses this to show a distinct loading label
   * ("Setting up biometric unlock…") instead of the generic "Starting
   * Glow…" spinner, so the user understands why they're being
   * prompted for a second biometric right after the passkey ceremony.
   *
   * Only set by the onboarding path in `connectWallet`. The retrieve
   * path (`checkForExistingWallet` then `retrieveSeed`) triggers its
   * own inline biometric prompt and has its own loading copy on the
   * welcome / unlock page, so this flag stays false there.
   */
  isSecuringSeed: boolean;
}

export type SdkEventHandler = (event: SdkEvent) => void;
export type SdkEventUnsubscribe = () => void;

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
        markLabelUsed(passkeyLabel);
      }

      // Persist the seed itself — but skip this entirely when the seed was
      // sourced from secure storage (we'd be writing the same bytes back
      // through a Keystore round-trip on every relaunch, which is wasteful
      // and clutters the breadcrumb trail).
      //
      // The write target depends on the onboarding mode:
      //   - Passkey mode (`passkeyLabel != null`) → biometric-bound
      //     `secureStorage`. Reads will prompt Face ID / Touch ID /
      //     BiometricPrompt on every relaunch.
      //   - Non-passkey mode → `deviceOnlyStorage`. Encrypted at rest
      //     via Keychain / Keystore but with no biometric gate, so
      //     relaunch reconnects silently like the web path does.
      //   - Web → plaintext localStorage fallback (unchanged).
      //
      // Non-fatal on failure for all paths — the wallet is already
      // connected from the in-memory seed; the typed error breadcrumb
      // is emitted by the storage layer, so we don't double-log here.
      if (source !== 'secureStorage') {
        if (passkeyLabel != null && secureStorage.isSupported()) {
          // Only flip the label if storeSeed actually prompts. The
          // platform grace period often returns within 250ms, in which
          // case we never show "Setting up biometric unlock…".
          const labelDeferMs = 250;
          let flipped = false;
          const flipTimer = setTimeout(() => {
            flipped = true;
            setIsSecuringSeed(true);
          }, labelDeferMs);
          try {
            await secureStorage.storeSeed(seed);
          } catch {
            // Intentionally swallowed — see comment above.
          } finally {
            clearTimeout(flipTimer);
            if (flipped) setIsSecuringSeed(false);
          }
        } else if (deviceOnlyStorage.isSupported()) {
          // Non-passkey on native: encrypted-at-rest storage with no
          // biometric prompt. No `isSecuringSeed` flip — this path is
          // silent by design.
          try {
            await deviceOnlyStorage.storeSeed(seed);
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

    // Wipe BOTH secure-storage tiers first. Failure is non-fatal — the
    // user is still logged out either way. Each tier emits its own typed
    // error breadcrumb on failure, so we don't double-log here.
    if (secureStorage.isSupported()) {
      try {
        await secureStorage.clearSeed();
      } catch {
        // Intentionally swallowed — see comment above.
      }
    }
    if (deviceOnlyStorage.isSupported()) {
      try {
        await deviceOnlyStorage.clearSeed();
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

  const switchPasskeyLabel = useCallback(async (newLabel: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    // PRF first so a cancel here leaves the active wallet untouched.
    let wallet;
    try {
      wallet = await getWallet(newLabel);
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
      // Web or unsupported host — should never reach UnlockPage here, but
      // route back to welcome just in case.
      setStartupState('no-wallet');
      retryUnlockInFlightRef.current = false;
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
            setError('Biometric authentication is not set up on this device.');
            setStartupState('no-wallet');
            break;
          case 'BIOMETRIC_UNAVAILABLE':
            // Most common cause on iOS: the user denied the
            // NSFaceIDUsageDescription system permission prompt, so
            // LAContext.canEvaluatePolicy now returns false. Keep the
            // user on UnlockPage with a helpful error so they can grant
            // the permission in Settings and retry, rather than
            // routing them back to welcome / onboarding which would
            // look like the wallet was lost.
            setError(
              'Biometric authentication is unavailable. Please enable Face ID / Touch ID / fingerprint for Glow in your device settings and try again.',
            );
            setStartupState('native-locked');
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

  // Set when the startup probe restores the `passkeyRegistered` flag
  // from the plugin's iCloud-synced keychain — i.e. this app launch
  // is the first one after a fresh install (or restore from another
  // Apple-ID device). PasskeyPage uses this signal to allow ONE
  // silent retry of the detecting phase: iCloud Keychain syncs the
  // credential-IDs metadata fast enough for the home screen, but the
  // actual passkey records can lag a few seconds, causing the first
  // assertion to fail with no Face ID prompt.
  // Reset to false after PasskeyPage consumes it (via
  // `consumeFreshInstallSignal`) so subsequent sign-ins in the same
  // session don't get the auto-retry quietness.
  const [freshInstallRestore, setFreshInstallRestore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const ids = await passkeyPrfProvider.getKnownCredentialIds();
        if (cancelled) return;
        if (ids.length > 0 && localStorage.getItem('passkeyRegistered') !== '1') {
          logger.info(LogCategory.AUTH, 'Restoring passkeyRegistered flag from synced keychain', { count: ids.length });
          localStorage.setItem('passkeyRegistered', '1');
          setFreshInstallRestore(true);
        }
      } catch (e) {
        // Best-effort: a missing plugin (web build) returns []. Other
        // failures shouldn't block app start.
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
      // (A) One-shot migration: on native, copy any plaintext mnemonic
      //     into device-only secure storage and wipe the plaintext copy.
      //     No-op on web.
      await migrateLegacyMnemonicIfNeeded();

      // (B) 0.0.3 regression recovery. The 0.0.3 release wrote every
      //     seed into the biometric-bound `secureStorage` tier,
      //     including non-passkey mnemonic users who never opted into
      //     a biometric flow. On upgrade, those users would get a
      //     biometric prompt on every relaunch and the Backup page
      //     would report "no seed" (because it only checked
      //     localStorage). Detect the orphan entry and wipe it
      //     silently so the user lands on the welcome screen and
      //     re-restores from their 24 words into the correct tier.
      //     `clearSeed` is unauthenticated on both platforms, so this
      //     wipe does NOT trigger a biometric prompt.
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

      // (C) Passkey biometric unlock. Two carefully ordered steps so
      //     the OS biometric prompt lands over a fully-painted branded
      //     placeholder, not a black splash:
      //
      //       1. `flushSync(setStartupState('native-unlocking'))` forces
      //          React to commit the route change to the DOM before we
      //          touch the splash — without it the commit can be
      //          batched past the next step.
      //       2. `await hideSplash()` runs the fade on the native
      //          compositor via the Web Animations API. It awaits the
      //          animation's `.finished` Promise before resolving, so
      //          `retryUnlock` (and therefore the biometric prompt)
      //          only fires once the splash is fully gone and
      //          UnlockingPage is on screen.
      //
      //     An earlier CSS-transition-based fade failed here: on
      //     Android WebView, `transitionend` never fired, so a 300ms
      //     fallback timer caught it — meaning the transition was
      //     being janked on the main thread and the splash stayed
      //     partially visible while the biometric prompt raced in on
      //     top of it. WAAPI sidesteps that by running on the
      //     compositor thread.
      //
      //     The two-page split (UnlockingPage vs UnlockPage) keeps the
      //     placeholder purely decorative — just the Glow logo and an
      //     "Authenticating…" spinner — and the retry screen purely
      //     interactive, so each surface reads cleanly without a
      //     mid-component isLoading toggle.
      let useLegacy = true;
      if (
        isPasskeyMode()
        && secureStorage.isSupported()
        && (await secureStorage.hasStoredSeed())
      ) {
        logger.info(LogCategory.AUTH, 'unlock:start');
        // flushSync forces React to commit this state update BEFORE
        // the await below yields control. Without it, the commit can
        // be batched past hideSplash and the biometric prompt lands
        // on a still-unmounted UnlockingPage.
        flushSync(() => {
          setStartupState('native-unlocking');
        });
        useLegacy = false;

        // Hide the splash and WAIT for its fade to complete. WAAPI
        // runs the animation on the compositor, so React's paint of
        // UnlockingPage (which flushSync just committed to the DOM)
        // composites in parallel with the fade — by frame 2 of the
        // 100ms fade, UnlockingPage is on screen behind the
        // translucent splash. On re-runs (splash already gone) this
        // resolves synchronously.
        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
          await hideSplash();
        }

        // Fire retryUnlock. Fire-and-forget: retryUnlock owns its
        // own error handling and updates startupState / error as
        // appropriate (success → 'connected', cancel/lockout →
        // 'native-locked').
        void retryUnlock();
      } else if (
        deviceOnlyStorage.isSupported()
        && (await deviceOnlyStorage.hasStoredSeed())
      ) {
        // (D) Non-passkey native silent reconnect. Encrypted-at-rest
        //     seed, no biometric prompt. Retrieval is a plain Keychain
        //     / Keystore decrypt — the user sees the splash fade into
        //     the connected wallet with no placeholder page.
        //     `source: 'secureStorage'` skips the re-write back into
        //     storage.
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
          // Fall through to welcome; the user can re-restore manually.
          setIsLoading(false);
        }
      }

      // (E) Legacy flow. Reached on web, or on native when no stored
      //     seed was found in either tier above.
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
          // Passkey mode but no stored seed (e.g. KEY_INVALIDATED on
          // biometric change, or a web host that doesn't support
          // secureStorage). Fall through to the passkey re-derive path.
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
        // Fire-and-forget on the non-passkey tail: we're not racing
        // the biometric prompt here, so there's no reason to await
        // the fade. hideSplash resolves on its own timeline.
        void hideSplash();
      }
    };

    checkForExistingWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initialization
  }, []);

  // Re-fire retryUnlock when the app returns to the foreground while
  // stuck on UnlockingPage. Guards against the case where the user
  // backgrounds the app during the splash fade-out window (see
  // hideSplash in checkForExistingWallet) before the system
  // biometric prompt appears: the BiometricPrompt call would land on
  // a non-STARTED activity, FragmentManager would refuse the
  // transaction, and the authentication callback would never fire —
  // leaving the JS Promise hung and the UnlockingPage visible with no
  // prompt. BiometricPromptAuth.kt also guards this on the native
  // side, but the resume listener is a belt-and-braces safety net so
  // the user can always unstick by tabbing back in. retryUnlock is
  // idempotent via retryUnlockInFlightRef.
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
  };
}
