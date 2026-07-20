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
import { sdkReady } from '@/services/sdkReady';
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
import { wipeAllLocalData } from '../services/accountDeletion';
import { hideSplash } from '../main';
import {
  prfAvailability,
  isPasskeyMode,
  setPasskeyMode,
  clearPasskeyMode,
  clearKnownCredentials,
  getKnownCredentialIdsBase64,
  hasPasskeyHistory,
  markLabelUsed,
  invalidatePasskey,
  pinActivePasskeyCredentialId,
  signInPinnedToActiveCredential,
  setPendingSwitchFromCredentialId,
  getPasskeyRpId,
  setPasskeyRpId,
  isMigrationInProgress,
  isPasskeyMigrated,
} from '../services/passkeyService';
import { LEGACY_RP_ID, SHARED_RP_ID, rpId as defaultRpId } from '../services/passkeyPrfProvider';
import { secureStorage, deviceOnlyStorage, SecureStorageError } from '../services/secureStorage';
import { clearPin, isAppLockSupported } from '../services/appLock';


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

async function initSdkLogging() {
  if (sdkLoggerInitialized) return;
  sdkLoggerInitialized = true;
  // initLogging is a WASM call; wait for the module. Runs on mount, so this
  // must not assume the SDK is already initialized now that boot is deferred.
  // The logging bridge is non-critical, so a failed SDK init is swallowed here
  // (the connect path surfaces the real error to the user).
  try {
    await sdkReady();
    initLogging({ log: (entry: LogEntry) => logSdkMessage(entry.level, entry.line) });
  } catch {
    /* SDK unavailable; skip the log bridge. */
  }
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
  /**
   * True when the connected wallet is on the legacy RP ID while a distinct shared
   * RP ID is configured and migration hasn't been done/skipped. Drives the
   * migration banner. Only ever true when SHARED_RP_ID is configured.
   */
  needsPasskeyMigration: boolean;
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
  handleLogout: (opts?: { silent?: boolean }) => Promise<void>;
  /**
   * Account deletion (App Store 5.1.1(v)): logs out, then wipes
   * everything logout leaves behind: SDK databases, Preferences,
   * remaining localStorage, the device credential-id registry, and the
   * in-memory log buffer.
   */
  handleDeleteAccount: () => Promise<void>;
  /**
   * Adopt the (already connected + synced) new SDK produced by the passkey-RP
   * migration as the active wallet, keeping mnemonic / stable-ticker / network
   * state since it is the same wallet from the user's view.
   */
  adoptMigratedSdk: (newSdk: BreezSdk, label: string) => Promise<void>;
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
  /** Dev tool: re-derive the current label under `newRpId` and reconnect immediately. */
  switchPasskeyRp: (newRpId: string) => Promise<void>;
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
  const [needsPasskeyMigration, setNeedsPasskeyMigration] = useState(false);
  const [prfAvailable, setPrfAvailable] = useState(false);
  const [startupState, setStartupState] = useState<StartupState>('loading');

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

        if (!hasConversionInfo && isReceived && !isMigrationInProgress()) {
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
    const createStart = performance.now();
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

      void initSdkLogging();
      logger.info(LogCategory.PERF, '[onboarding] connect.begin', { restore, source });

      // WASM is initialized lazily now (services/sdkReady). connectWallet is the
      // first guaranteed SDK use (buildConnectConfig -> defaultConfig, then
      // connect), so wait for the module here. Usually already resolved.
      await sdkReady();
      const cfg = buildConnectConfig();
      setConfig(cfg);

      // connect() = Spark auth + initial wallet sync (no Nostr; the label
      // publish was already kicked off, fire-and-forget, inside register()).
      connectedSdk = await logger.time('[onboarding] sdk.connect', () => connect({
        config: cfg,
        seed,
        storageDir: 'spark-wallet-example',
      }));
      setSdk(connectedSdk);

      logger.sdkInitialized();
      logger.authSuccess(passkeyLabel != null ? 'passkey' : seed.type);
      logger.info(LogCategory.SDK, 'Wallet connected successfully');

      // Non-sensitive marker so the legacy path can still detect
      // passkey mode if secure storage is unavailable later
      // (KEY_INVALIDATED on biometric change).
      if (passkeyLabel != null) {
        // Persist the RP ID this wallet was derived under so the next
        // sign-in/resume targets the same one. Resume backfills the stored
        // value before calling connectWallet; a fresh connect (no stored RP
        // ID yet) records the default (shared when configured, else legacy).
        setPasskeyMode(passkeyLabel, getPasskeyRpId() ?? defaultRpId);
        markLabelUsed(passkeyLabel);
        // Offer migration when this wallet is still on the legacy RP ID and a
        // distinct shared RP ID is configured and not yet migrated/skipped.
        const onLegacyRp = (getPasskeyRpId() ?? LEGACY_RP_ID) === LEGACY_RP_ID;
        // Migration is a web-only flow (the modal uses the browser passkey
        // client); native keeps its fixed RP ID and never migrates.
        setNeedsPasskeyMigration(
          !Capacitor.isNativePlatform() && !!SHARED_RP_ID && SHARED_RP_ID !== LEGACY_RP_ID && !isPasskeyMigrated() && onLegacyRp,
        );
      }

      // Persist the seed. Skip entirely when it was just retrieved from
      // the native vault. Native => device-only tier, always (silent
      // launch; PIN/biometric gating is app-level, see appLock.ts).
      // Web passkey => no cache, web non-passkey => plaintext fallback.
      // Failures are non-fatal: the wallet is already connected, and
      // the storage layer emits its own typed breadcrumb.
      if (source !== 'secureStorage') {
        if (deviceOnlyStorage.isSupported()) {
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

      // Mark connected as soon as the SDK is ready, so the wallet screen
      // shows immediately instead of waiting on the getInfo / listPayments
      // round-trips. Balance, history and unclaimed deposits load in the
      // background: the balance header waits for walletInfo (renders nothing
      // until then, never a stale zero) and isSyncing drives the indicator.
      setIsConnected(true);
      setStartupState('connected');
      setIsLoading(false);
      // Total covers connect + persist; getInfo/history load in the
      // background below. Add the earlier passkey.register/signIn time for
      // the full button-tap-to-usable figure.
      logger.info(LogCategory.PERF, '[onboarding] connect.total', {
        ms: Math.round(performance.now() - createStart),
      });

      void (async () => {
        try {
          const [info, txns] = await logger.time('[onboarding] sdk.getInfoAndPayments', () =>
            Promise.all([
              connectedSdk!.getInfo({}),
              connectedSdk!.listPayments({ offset: 0, limit: 100 }),
            ]));
          setWalletInfo(info);
          setTransactions(filterOngoingConversionPayments(txns.payments));
          logger.info(LogCategory.SDK, 'Connected wallet identity', {
            identityPubkey: info.identityPubkey,
            label: passkeyLabel ?? null,
          });
        } catch (e) {
          logger.warn(LogCategory.SDK, 'Background wallet data load failed', { error: formatError(e) });
        }
        try {
          const result = await connectedSdk!.listUnclaimedDeposits({});
          const deposits = result.deposits;
          setUnclaimedDeposits(deposits);
          setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
        } catch (e) {
          logger.warn(LogCategory.SDK, 'Failed to fetch unclaimed deposits', { error: formatError(e) });
        }
      })();
    } catch (e) {
      const errorMsg = formatError(e);
      logger.error(LogCategory.SDK, 'Error connecting wallet', { error: errorMsg });
      logger.authFailure(passkeyLabel != null ? 'passkey' : seed.type, errorMsg);

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

  const handleLogout = useCallback(async (opts?: { silent?: boolean }) => {
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
    // Drop the app lock with the wallet it protected, so onboarding
    // for the next wallet doesn't start behind the old wallet's PIN.
    if (isAppLockSupported()) {
      try { await clearPin(); } catch { /* non-fatal */ }
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
    setNeedsPasskeyMigration(false);
    setIsLoading(false);
    setStartupState('no-wallet');
    clearNetworkOverride();
    if (!opts?.silent) {
      showToast('success', 'Successfully logged out');
    }
  }, [sdk, showToast]);

  const handleDeleteAccount = useCallback(async () => {
    await handleLogout({ silent: true });
    // Forget the device credential-id registry too: on native it lives
    // in the passkey plugin's Keychain / Block Store, which no web-side
    // storage wipe can reach. Signal-free, so the passkey itself stays
    // usable in the credential manager for a later restore.
    await clearKnownCredentials();
    await wipeAllLocalData();
    // Drop the wiped account's log breadcrumbs from memory so a later
    // persist can't re-seed the deleted glow-logs database with them.
    logger.clear();
  }, [handleLogout]);

  const adoptMigratedSdk = useCallback(async (newSdk: BreezSdk, label: string): Promise<void> => {
    logger.info(LogCategory.AUTH, 'Adopting migrated SDK', { label });

    // Disconnect the legacy SDK we were running. Unlike handleLogout this keeps
    // mnemonic / stable-ticker / network state: from the user's view it is the
    // same wallet, now under the shared RP ID.
    const oldSdk = sdk;
    if (oldSdk) {
      try {
        await oldSdk.disconnect();
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Old SDK disconnect failed during migration adoption', { error: formatError(e) });
      }
    }

    // Take ownership of the already connected + synced new SDK. Here we set mode
    // + RP ID so resume targets the new wallet; the migration flow pins the shared
    // credential as active right after this hand-off returns.
    setSdk(newSdk);
    // Login-entry migration never ran connectWallet on this hook, so `config`
    // is still null; set it (as connectWallet does) or `config.network` stays
    // undefined and the Buy list drops Cash App until reload.
    setConfig(buildConnectConfig());
    setPasskeyMode(label, SHARED_RP_ID ?? defaultRpId);
    markLabelUsed(label);
    shownPaymentIdsRef.current.clear();
    setCelebrationPayment(null);

    try {
      const [info, txns] = await Promise.all([
        newSdk.getInfo({}),
        newSdk.listPayments({ offset: 0, limit: 100 }),
      ]);
      setWalletInfo(info);
      setTransactions(filterOngoingConversionPayments(txns.payments));
      logger.info(LogCategory.SDK, 'Connected wallet identity', {
        identityPubkey: info.identityPubkey,
        label,
      });
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to load migrated wallet data', { error: formatError(e) });
    }
    setIsConnected(true);
    setIsSyncing(false);
    setNeedsPasskeyMigration(false);
    // Match connectWallet's terminal state so any startup/loading gate clears.
    setStartupState('connected');
    setIsLoading(false);

    try {
      const result = await newSdk.listUnclaimedDeposits({});
      setUnclaimedDeposits(result.deposits);
      setHasRejectedDeposits(result.deposits.some(d => isDepositRejected(d.txid, d.vout)));
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to load deposits for migrated wallet', { error: formatError(e) });
    }
  }, [sdk]);

  // Swap the connected wallet: invalidate the cached passkey, derive a new
  // wallet via PRF (a cancel here leaves the current wallet untouched), then
  // disconnect, clear per-wallet state, reconnect and rehydrate. `rpId` is
  // passed only for an RP switch (persisted before connect so a resume derives
  // under it); a label switch leaves the RP unchanged. `what` names the switch
  // in error/log copy.
  const reconnectWithDerivedWallet = useCallback(async (
    derive: () => Promise<{ seed: Seed; label: string }>,
    what: string,
    rpId?: string,
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);

    invalidatePasskey();

    let wallet;
    try {
      wallet = await derive();
    } catch (e) {
      setIsLoading(false);
      throw e;
    }

    if (sdk) {
      try {
        await sdk.disconnect();
      } catch (e) {
        logger.warn(LogCategory.SDK, `SDK disconnect failed during ${what} switch`, {
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

    // Persist the target RP before connect so a resume/relaunch derives under it.
    if (rpId) setPasskeyRpId(rpId);

    let connectedSdk: BreezSdk | undefined;
    try {
      await sdkReady();
      const cfg = buildConnectConfig();
      setConfig(cfg);

      connectedSdk = await connect({
        config: cfg,
        seed: wallet.seed,
        storageDir: 'spark-wallet-example',
      });
      setSdk(connectedSdk);
      setPasskeyMode(wallet.label, rpId);

      if (deviceOnlyStorage.isSupported()) {
        try {
          await deviceOnlyStorage.storeSeed(wallet.seed);
        } catch {
          // In-memory seed keeps the session alive. The old label's
          // cached seed may survive; next launch reconnects it and the
          // user can switch again.
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
        logger.warn(LogCategory.SDK, `Deposit fetch failed after ${what} switch`, {
          error: formatError(e),
        });
      }
    } catch (e) {
      const errorMsg = formatError(e);
      logger.error(LogCategory.SDK, `Failed to connect after ${what} switch`, { error: errorMsg });
      if (connectedSdk) {
        try { await connectedSdk.disconnect(); } catch { /* best-effort */ }
        setSdk(null);
      }
      setError(`Failed to switch ${what}. Please try again.`);
      throw e;
    } finally {
      setIsSyncing(false);
      setIsLoading(false);
    }
  }, [sdk]);

  const switchPasskeyLabel = useCallback((newLabel: string): Promise<void> => {
    // Same passkey, same RP the active session uses (legacy for a not-yet-migrated
    // user, shared after migration). Pin to the active credential so the OS doesn't
    // derive the new label under a different identity.
    return reconnectWithDerivedWallet(
      () => signInPinnedToActiveCredential(newLabel, getPasskeyRpId() ?? LEGACY_RP_ID).then(r => r.wallet),
      'label',
    );
  }, [reconnectWithDerivedWallet]);

  // Dev tool: switch the active passkey between the legacy and shared RP and
  // reconnect immediately, instead of only writing the RP id and waiting for the
  // next sign-in. Keeps the current label and re-derives it under the target RP.
  const switchPasskeyRp = useCallback((newRpId: string): Promise<void> => {
    if ((getPasskeyRpId() ?? LEGACY_RP_ID) === newRpId) return Promise.resolve();
    // The #264 per-RP pin won't match a different RP, so the derive falls back to
    // the OS picker, surfacing the credential that lives under the target RP.
    const currentLabel = localStorage.getItem('passkeyLabel') ?? undefined;
    return reconnectWithDerivedWallet(
      () => signInPinnedToActiveCredential(currentLabel, newRpId).then(r => r.wallet),
      'passkey RP',
      newRpId,
    );
  }, [reconnectWithDerivedWallet]);

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
        // Existing users derive under their stored RP ID, defaulting to
        // legacy so enabling the shared RP can't orphan a pre-migration wallet.
        const effectiveRpId = getPasskeyRpId() ?? LEGACY_RP_ID;
        const response = await signInPinnedToActiveCredential(effectiveLabel, effectiveRpId);
        if (!getPasskeyRpId()) setPasskeyRpId(effectiveRpId);
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
      // Legacy migration: pre-app-lock builds kept the seed
      // biometric-bound. Move it to the device-only tier (this prompt
      // was the last mandatory one; PIN/biometric gating is app-level
      // now, see appLock.ts). Write-then-clear so a crash mid-move
      // can only duplicate the seed, never lose it.
      try {
        await deviceOnlyStorage.storeSeed(seed);
        await secureStorage.clearSeed();
        logger.info(LogCategory.AUTH, 'Migrated biometric-bound seed to device-only tier');
      } catch {
        // Best-effort; the next successful unlock retries.
      }
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

  // Route SDK-internal logs to the ring buffer from app start (not just
  // from connectWallet), so the passkey register / label-publish phase is
  // captured in Share Logs. Idempotent, so connectWallet's call no-ops.
  // Without this the ~30s register() is a black box in exported logs, and
  // we can't split the WebAuthn ceremony from the Nostr label publish.
  useEffect(() => { void initSdkLogging(); }, []);

  // Check PRF availability on mount. Shared promise: the splash waits on this
  // same check before revealing, so the welcome screen is never shown with the
  // wrong onboarding flow (prfAvailable defaults to false until it settles).
  useEffect(() => {
    prfAvailability().then(setPrfAvailable).catch(() => setPrfAvailable(false));
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

      // (B0) Stale bound-tier residue. A live seed one tier down (or a
      //     saved mnemonic) means the bound-tier entry is a 0.0.3
      //     orphan or a half-finished migration duplicate, not the
      //     active wallet. Clear it so it can't hijack startup with a
      //     biometric prompt for the wrong seed, or wipe a working
      //     wallet via the KEY_INVALIDATED path below.
      let staleBoundTierCleared = false;
      if (secureStorage.isSupported() && (await secureStorage.hasStoredSeed())) {
        const hasLiveSeedBelow =
          (await deviceOnlyStorage.hasStoredSeed())
          || (!isPasskeyMode() && getSavedMnemonic() != null);
        if (hasLiveSeedBelow) {
          await secureStorage.clearSeed().catch(() => { /* best-effort */ });
          staleBoundTierCleared = true;
          logger.warn(LogCategory.AUTH, 'Cleared stale biometric-bound seed');
        }
      }

      // (B) Legacy biometric-bound seed (pre-app-lock builds). One last
      //     OS-prompted unlock, after which retryUnlock migrates the
      //     seed to the device-only tier and this branch never runs
      //     again. Order matters so the OS prompt lands over a
      //     fully-painted UnlockingPage, not a black splash: flushSync
      //     commits the route change before hideSplash() awaits the
      //     WAAPI fade on the compositor, then retryUnlock fires.
      //     CSS-transition-based fades janked the main thread on
      //     Android WebView; WAAPI sidesteps that.
      let useLegacy = true;
      if (
        !staleBoundTierCleared
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
        // (C) Native default silent reconnect. Plain decrypt, no
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

      // (D) Legacy flow: web, or native with no stored seed.
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
            // Existing users derive under their stored RP ID, defaulting to
            // legacy so enabling the shared RP can't orphan a pre-migration wallet.
            const effectiveRpId = getPasskeyRpId() ?? LEGACY_RP_ID;
            const result = await signInPinnedToActiveCredential(effectiveLabel, effectiveRpId);
            if (!getPasskeyRpId()) setPasskeyRpId(effectiveRpId);
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
    needsPasskeyMigration,
    prfAvailable,
    hasPasskeyBefore: hasPasskeyHistory(),
    isFreshInstallRestore: freshInstallRestore,
    startupState,
    // Actions
    connectWallet,
    refreshWalletData,
    fetchUnclaimedDeposits,
    handleLogout,
    handleDeleteAccount,
    adoptMigratedSdk,
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
    switchPasskeyRp,
    prepareSwitchPasskeyCredential,
  };
}
