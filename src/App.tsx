import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { WalletProvider, WalletInfoProvider, WalletStatusProvider } from './contexts/WalletContext';
import LoadingSpinner from './components/LoadingSpinner';
import PaymentReceivedCelebration from './components/PaymentReceivedCelebration';
import InstallPrompt from './components/InstallPrompt';
import OfflineBanner from './components/OfflineBanner';
import StagingGate from './components/StagingGate';
import { ToastProvider, useToast } from './contexts/ToastContext';
import AppShell from './components/layout/AppShell';
import { useBreezSdk } from './hooks/useBreezSdk';
import { FiatDataProvider } from './contexts/FiatDataContext';
import { StableBalanceProvider, useStableBalance } from './contexts/StableBalanceContext';

import HomePage from './pages/HomePage';
import WalletPage from './pages/WalletPage';
import RestorePage from './pages/RestorePage';
import GeneratePage from './pages/GeneratePage';
import GetRefundPage from './pages/GetRefundPage';
import BackupPage from './pages/BackupPage';
import SecurityPage from './pages/SecurityPage';
import LockScreen from './components/LockScreen';
import { useAppLock } from './hooks/useAppLock';
import PasskeyPage from './pages/PasskeyPage';
import type { MigrationEntry, MigrationOutcome } from './features/passkey-migration/types';
import SettingsPage from './pages/SettingsPage';
import AccountDeletedPage from './pages/AccountDeletedPage';
import { isPasskeyMode } from './services/passkeyService';
import FiatCurrenciesPage from './pages/FiatCurrenciesPage';
import BuyProvidersPage from './pages/BuyProvidersPage';
import UnlockPage from './pages/UnlockPage';
import UnlockingPage from './pages/UnlockingPage';
// Dev-gated Passkey & Labels hub + the AAGUID lookup database it pulls
// in (~245 KB JSON). Code-split so neither the main bundle nor any
// non-dev user pays the parse cost; loads on first navigation into the
// hub. Settles within one paint on a typical connection.
const PasskeySettingsPage = lazy(() => import('./pages/PasskeySettingsPage'));
const PasskeyManagementPage = lazy(() => import('./pages/PasskeyManagementPage'));
const LabelsPage = lazy(() => import('./pages/LabelsPage'));
const PasskeyLocalStatePage = lazy(() => import('./pages/PasskeyLocalStatePage'));
// Code-split the rare legacy->shared passkey migration: its modal + service load
// only after the flow is first triggered (gated by migrationEverOpened below).
const PasskeyMigrationModal = lazy(() => import('./features/passkey-migration/PasskeyMigrationModal'));
import { ContactsProvider } from './contexts/ContactsContext';

import { useIOSViewportFix } from './hooks/useIOSViewportFix';
import { useStatusBarColor } from './hooks/useStatusBarColor';
import { STATUS_BAR_LOADING } from './utils/statusBarManager';
import { useBackButton } from './hooks/useBackButton';
import type { Seed, Payment, BreezSdk } from '@breeztech/breez-sdk-spark';

const PASSKEY_MIGRATION_ENABLED = true;

type Screen = 'home' | 'restore' | 'generate' | 'wallet' | 'getRefund' | 'settings' | 'backup' | 'security' | 'fiatCurrencies' | 'buyProviders' | 'passkey' | 'unlock' | 'unlocking' | 'passkeySettings' | 'passkeyManagement' | 'labels' | 'passkeyLocalState';

// Full-screen dim spinner shown while sdk.isLoading is true (logout in
// progress, SDK reconnect, etc). Wrapped as its own component so the
// useStatusBarColor effect only fires while the overlay is mounted:
// during logout WalletPage unmounts and the status bar stack goes
// empty, so without this component the system bars would fall back to
// the wallet page glass tint which visibly mismatches bg-spark-void/95.
const GlobalLoadingOverlay: React.FC = () => {
  useStatusBarColor(STATUS_BAR_LOADING);
  return (
    <div className="absolute inset-0 bg-spark-void/95 backdrop-blur-sm z-50 flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );
};

// Bridge component that feeds StableBalance formatter back to useBreezSdk via a mutable ref
const StableBalanceFormatterBridge: React.FC<{ formatterRef: React.MutableRefObject<((payment: Payment) => string) | undefined> }> = ({ formatterRef }) => {
  const stableBalance = useStableBalance();
  useEffect(() => {
    formatterRef.current = stableBalance.formatPaymentAmount;
  }, [formatterRef, stableBalance.formatPaymentAmount]);
  return null;
};

const AppContent: React.FC = () => {
  // User-driven navigation only. SDK-derived screens ('unlock',
  // 'unlocking', auto-'wallet' on reconnect) are layered in by
  // `currentScreen` below.
  const [userScreen, setUserScreen] = useState<Screen>('home');
  // Where the open BackupPage was launched from: the side menu (web) or
  // the Security & Backup page (native). Drives its back target and
  // whether SecurityPage stays mounted beneath it.
  const [backupSource, setBackupSource] = useState<'settings' | 'security'>('settings');
  const [refundAnimationDirection, setRefundAnimationDirection] = useState<'left' | 'up'>('left');
  const [buyProvidersSource, setBuyProvidersSource] = useState<'wallet' | 'settings'>('wallet');
  const [passkeySdkConnected, setPasskeySdkConnected] = useState(false);
  // True when the user entered the passkey screen via the explicit
  // "Create New Wallet" CTA on browsers without `immediateGet`. Skips
  // PasskeyPage's discovery (`detecting`) phase so we don't trigger a
  // cross-device QR picker on the first click of a fresh-user
  // onboarding. Read by PasskeyPage as the `skipDetection` prop.
  const [passkeySkipDetection, setPasskeySkipDetection] = useState(false);
  // Passkey-RP migration modal state.
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  // Sticky: stays true after the first open so the lazy modal remains mounted
  // (preserving its isOpen-gated cleanup) rather than unmounting on close.
  const [migrationEverOpened, setMigrationEverOpened] = useState(false);
  const [migrationEntry, setMigrationEntry] = useState<MigrationEntry>('banner');
  const migrationResolveRef = useRef<((outcome: MigrationOutcome) => void) | null>(null);
  const hasAutoOpenedMigrationRef = useRef(false);
  const { showToast } = useToast();
  const formatPaymentAmountRef = useRef<((payment: Payment) => string) | undefined>(undefined);

  useIOSViewportFix();

  const sdk = useBreezSdk(showToast);
  // App lock overlays everything (including the unlock/backup screens)
  // while locked; rendered last in the tree so it stacks on top.
  const appLock = useAppLock();

  // SDK startup state takes precedence; otherwise the user's screen
  // wins, with one exception: an SDK auto-reconnect (saved mnemonic /
  // biometric unlock) promotes the still-initial 'home' to 'wallet'
  // so the user lands in the wallet without an explicit click.
  const currentScreen: Screen = useMemo(() => {
    if (sdk.startupState === 'native-unlocking') return 'unlocking';
    if (sdk.startupState === 'native-locked') return 'unlock';
    if (sdk.isConnected && userScreen === 'home') return 'wallet';
    return userScreen;
  }, [sdk.startupState, sdk.isConnected, userScreen]);

  // Navigate to wallet after successful connect
  const handleConnect = async (mnemonic: string, restore: boolean) => {
    await sdk.connectWallet({ type: 'mnemonic', mnemonic }, restore);
    setUserScreen('wallet');
  };

  // Navigate to wallet after passkey connect
  const handlePasskeyConnect = async (seed: Seed, label: string) => {
    try {
      await sdk.connectWallet(seed, true, label);
      setPasskeySdkConnected(true);
    } catch {
      // Stay on passkey screen — sdk.error will be set by useBreezSdk
    }
  };

  const handlePasskeyFlowComplete = useCallback(() => {
    setPasskeySdkConnected(false);
    setUserScreen('wallet');
  }, []);

  // Auto-open the migration banner once per page load when a legacy-RP wallet
  // connects and shared migration is still pending.
  useEffect(() => {
    if (!PASSKEY_MIGRATION_ENABLED) return;

    if (
      sdk.isConnected
      && sdk.needsPasskeyMigration
      && !migrationModalOpen
      && !hasAutoOpenedMigrationRef.current
    ) {
      hasAutoOpenedMigrationRef.current = true;
      setMigrationEntry('banner');
      setMigrationModalOpen(true);
      setMigrationEverOpened(true);
    }
  }, [sdk.isConnected, sdk.needsPasskeyMigration, migrationModalOpen]);

  // Opened from PasskeyPage when no shared credential is found: the modal probes
  // for a legacy passkey to migrate. Resolves 'proceed' (caller may create a
  // fresh shared passkey) or 'handled' (migration ran or the user cancelled).
  const requestMigrationCheck = useCallback((): Promise<MigrationOutcome> => {
    if (!PASSKEY_MIGRATION_ENABLED) {
      return Promise.resolve('proceed');
    }

    return new Promise<MigrationOutcome>((resolve) => {
      migrationResolveRef.current = resolve;
      setMigrationEntry('login');
      setMigrationModalOpen(true);
      setMigrationEverOpened(true);
    });
  }, []);

  const handleMigrationClose = useCallback((outcome: MigrationOutcome) => {
    setMigrationModalOpen(false);
    const resolve = migrationResolveRef.current;
    migrationResolveRef.current = null;
    resolve?.(outcome);
  }, []);

  // Adopt the migrated SDK only; the modal stays open to show its Done step.
  // Closing + navigation happen when the user clicks Done (handleMigrationClose):
  // a login-entry flow navigates via PasskeyPage's onBack on the resolved
  // outcome, and a banner flow is already on the wallet.
  const handleMigrationSwitch = useCallback(async (newSdk: BreezSdk, label: string) => {
    await sdk.adoptMigratedSdk(newSdk, label);
  }, [sdk]);

  const handleLogout = async () => {
    setUserScreen('home');
    hasAutoOpenedMigrationRef.current = false;
    await sdk.handleLogout();
  };

  // Account deletion. While phase !== 'idle', renderCurrentScreen
  // early-returns the AccountDeletedPage overlay, replacing the whole
  // screen tree BEFORE the SDK disconnects: a mounted SettingsPage
  // would otherwise trip useWallet() on the transient null client
  // (same hazard as onSwitchCredential below). Passkey mode is
  // captured up front because the wipe clears the localStorage key
  // isPasskeyMode() reads.
  const [deletionPhase, setDeletionPhase] = useState<'idle' | 'deleting' | 'done'>('idle');
  const [deletedPasskeyMode, setDeletedPasskeyMode] = useState(false);
  const handleDeleteAccount = async () => {
    setDeletedPasskeyMode(isPasskeyMode());
    setDeletionPhase('deleting');
    try {
      await sdk.handleDeleteAccount();
      setUserScreen('home');
      hasAutoOpenedMigrationRef.current = false;
      setDeletionPhase('done');
    } catch (e) {
      setDeletionPhase('idle');
      showToast('error', 'Could not delete account', e instanceof Error ? e.message : undefined);
    }
  };

  // Android hardware back button — screen navigation fallback at the
  // bottom of the back-button handler stack (utils/backButton.ts).
  // Open bottom sheets, drawers and confirm dialogs push their own
  // handlers via useBackButton when they mount, so those absorb the
  // event first (LIFO). This handler only runs when nothing else is
  // open and walks one step back in the screen hierarchy.
  //
  //   return `true`  → event handled, walk stops
  //   return `false` → fall through to the base of the stack, which
  //                    calls App.minimizeApp() (same as pressing Home)
  //
  // Nothing in the stack ever calls App.exitApp(). Destroying the
  // activity process while a system-UI BiometricPrompt is showing
  // orphans the dialog — SystemUI keeps it on screen with an
  // unresponsive Cancel button and only a device reboot clears it.
  // On `unlock` / `unlocking` we also absorb (rather than minimise)
  // because the biometric dialog is typically visible; the user can
  // cancel via its own Cancel button.
  useBackButton(useCallback(() => {
    switch (currentScreen) {
      case 'settings':
      case 'getRefund':
        setUserScreen('wallet');
        return true;
      case 'backup':
        setUserScreen(backupSource === 'security' ? 'security' : 'settings');
        return true;
      case 'security':
      case 'fiatCurrencies':
      case 'passkeySettings':
        setUserScreen('settings');
        return true;
      case 'passkeyManagement':
      case 'labels':
      case 'passkeyLocalState':
        setUserScreen('passkeySettings');
        return true;
      case 'buyProviders':
        setUserScreen(buyProvidersSource === 'settings' ? 'settings' : 'wallet');
        return true;
      case 'restore':
      case 'generate':
      case 'passkey':
        setUserScreen('home');
        return true;
      case 'unlock':
      case 'unlocking':
        // Biometric prompt may be showing — don't minimise, just
        // absorb. User can cancel the biometric via its own Cancel.
        return true;
      case 'home':
      case 'wallet':
      default:
        // Root user screens: fall through to App.minimizeApp()
        // (same as pressing Home). Matches standard Android UX.
        return false;
    }
  }, [currentScreen, buyProvidersSource, backupSource]), true);

  // Render screens
  const renderCurrentScreen = () => {
    // Deletion overlay wins over everything, including startup-state
    // overlays: it must stay up while the SDK tears down beneath it.
    if (deletionPhase !== 'idle') {
      return (
        <AccountDeletedPage
          phase={deletionPhase}
          wasPasskey={deletedPasskeyMode}
          onDone={() => setDeletionPhase('idle')}
        />
      );
    }

    // Startup-state overlays take precedence and are derived directly
    // from `sdk.startupState`. The `currentScreen` memo above already
    // maps these to 'unlocking' / 'unlock', but the explicit early
    // returns below keep the SDK state authoritative even if
    // `currentScreen` later grows additional sources of truth.
    //
    // This matters for cold-launch unlock: useBreezSdk flips
    // startupState='native-unlocking', then waits for paint before
    // fading the splash. Because the derivation runs synchronously
    // during render, UnlockingPage commits in the same render tick as
    // the state change, not on the tick-later commit that a routing
    // effect would have produced.
    if (sdk.startupState === 'native-unlocking') {
      return <UnlockingPage />;
    }
    if (sdk.startupState === 'native-locked') {
      return (
        <UnlockPage
          isLoading={sdk.isLoading}
          error={sdk.error}
          onUnlock={sdk.retryUnlock}
          onAbandon={handleLogout}
        />
      );
    }

    if (
      sdk.isLoading &&
      currentScreen !== 'restore' &&
      currentScreen !== 'passkey' &&
      currentScreen !== 'unlock' &&
      currentScreen !== 'unlocking'
    ) {
      return <GlobalLoadingOverlay />;
    }

    // Wallet-layer renderer. Used both as the `wallet` case itself and
    // as a backdrop beneath overlay SlideInPages (Settings / Backup /
    // GetRefund / BuyProviders / FiatCurrencies) so their enter/leave
    // slide animations reveal the wallet underneath instead of empty
    // space. Before this, the underlying WalletPage popped in only
    // after the overlay's leave animation completed, which felt jumpy.
    const renderWalletPage = () => {
      if (!sdk.isConnected) {
        // Safety net: overlay cases are unreachable without a live
        // wallet connection, but fall back to HomePage anyway to
        // preserve the pre-refactor behavior of the `wallet` case.
        return (
          <HomePage
            onRestoreWallet={() => setUserScreen('restore')}
            onCreateNewWallet={() => setUserScreen('generate')}
            onUsePasskey={() => { setPasskeySkipDetection(false); setUserScreen('passkey'); }}
            onCreatePasskey={() => { setPasskeySkipDetection(true); setUserScreen('passkey'); }}
            prfAvailable={sdk.prfAvailable}
          />
        );
      }
      return (
        <WalletPage
          walletInfo={sdk.walletInfo}
          transactions={sdk.transactions}
          unclaimedDeposits={sdk.unclaimedDeposits}
          refreshWalletData={sdk.refreshWalletData}
          isSyncing={sdk.isSyncing}
          error={sdk.error}
          onClearError={sdk.clearError}
          onLogout={handleLogout}
          hasRejectedDeposits={sdk.hasRejectedDeposits}
          onOpenGetRefund={(source?: 'menu' | 'icon') => {
            setRefundAnimationDirection(source === 'icon' ? 'up' : 'left');
            setUserScreen('getRefund');
          }}
          onOpenSettings={() => setUserScreen('settings')}
          onOpenBuyProviders={() => { setBuyProvidersSource('wallet'); setUserScreen('buyProviders'); }}
          onBuyBitcoin={sdk.handleBuyBitcoin}
          network={sdk.config?.network}
          onDepositChanged={sdk.fetchUnclaimedDeposits}
        />
      );
    };

    // Settings-layer renderer. Used both as the `settings` case and as
    // a backdrop beneath nested overlays (FiatCurrencies and
    // BuyProviders when reached from Settings) so those close
    // animations reveal Settings rather than skipping back to the
    // wallet directly.
    const renderSettingsPage = () => (
      <SettingsPage
        onBack={() => setUserScreen('wallet')}
        config={sdk.config}
        onOpenFiatCurrencies={() => setUserScreen('fiatCurrencies')}
        onOpenBuyProviders={() => { setBuyProvidersSource('settings'); setUserScreen('buyProviders'); }}
        onOpenPasskeySettings={() => setUserScreen('passkeySettings')}
        onOpenSecurity={() => setUserScreen('security')}
        onOpenBackup={() => { setBackupSource('settings'); setUserScreen('backup'); }}
        onDeleteAccount={() => { void handleDeleteAccount(); }}
      />
    );

    // Backdrop beneath the three sub-pages so their close animations
    // reveal the hub rather than skipping back to Settings.
    const renderPasskeySettingsPage = () => (
      <PasskeySettingsPage
        onBack={() => setUserScreen('settings')}
        onOpenPasskey={() => setUserScreen('passkeyManagement')}
        onOpenLabels={() => setUserScreen('labels')}
        onOpenLocalState={() => setUserScreen('passkeyLocalState')}
        onSwitchRp={async (rpId) => {
          await sdk.switchPasskeyRp(rpId);
          setUserScreen('wallet');
        }}
      />
    );

    // Layered cases (wallet + overlay screens) all return Fragments so
    // React reconciliation treats them as the same tree shape across
    // transitions — WalletPage / SettingsPage instances (and their
    // state, scroll position, open bottom sheets) are preserved when
    // an overlay opens or closes over them, rather than unmounted +
    // remounted. Non-wallet cases (home / restore / generate / passkey /
    // unlock / unlocking) use their own distinct tree shapes.
    switch (currentScreen) {
      case 'home':
        return (
          <HomePage
            onRestoreWallet={() => setUserScreen('restore')}
            onCreateNewWallet={() => setUserScreen('generate')}
            onUsePasskey={() => { setPasskeySkipDetection(false); setUserScreen('passkey'); }}
            onCreatePasskey={() => { setPasskeySkipDetection(true); setUserScreen('passkey'); }}
            prfAvailable={sdk.prfAvailable}
          />
        );

      case 'passkey':
        return (
          <PasskeyPage
            onWalletRestored={handlePasskeyConnect}
            onBack={() => {
              setPasskeySdkConnected(false);
              setUserScreen('home');
            }}
            sdkConnected={passkeySdkConnected}
            onFlowComplete={handlePasskeyFlowComplete}
            consumeFreshInstallSignal={sdk.consumeFreshInstallSignal}
            skipDetection={passkeySkipDetection}
            onRequestMigrationCheck={requestMigrationCheck}
          />
        );

      case 'unlocking':
        return <UnlockingPage />;

      case 'unlock':
        return (
          <UnlockPage
            isLoading={sdk.isLoading}
            error={sdk.error}
            onUnlock={sdk.retryUnlock}
            onAbandon={handleLogout}
          />
        );

      case 'getRefund':
        return (
          <>
            {renderWalletPage()}
            <GetRefundPage
              onBack={() => setUserScreen('wallet')}
              animationDirection={refundAnimationDirection}
            />
          </>
        );

      case 'settings':
        return (
          <>
            {renderWalletPage()}
            {renderSettingsPage()}
          </>
        );

      case 'fiatCurrencies':
        return (
          <>
            {renderWalletPage()}
            {renderSettingsPage()}
            <FiatCurrenciesPage onBack={() => setUserScreen('settings')} />
          </>
        );

      case 'passkeySettings':
        return (
          <>
            {renderWalletPage()}
            {renderSettingsPage()}
            <Suspense fallback={null}>
              {renderPasskeySettingsPage()}
            </Suspense>
          </>
        );

      case 'passkeyManagement':
        return (
          <>
            {renderWalletPage()}
            {renderSettingsPage()}
            <Suspense fallback={null}>
              {renderPasskeySettingsPage()}
              <PasskeyManagementPage
                onBack={() => setUserScreen('passkeySettings')}
                onSwitchCredential={async (credId) => {
                  // Route as soon as the cred is pinned (synchronously)
                  // so the layered SettingsPage unmounts before
                  // useBreezSdk nulls the SDK in the disconnect step.
                  // Otherwise SettingsPage's useWallet() throws on the
                  // transient render and blanks the screen.
                  await sdk.prepareSwitchPasskeyCredential(credId, () => {
                    setPasskeySdkConnected(false);
                    setPasskeySkipDetection(false);
                    setUserScreen('passkey');
                  });
                }}
              />
            </Suspense>
          </>
        );

      case 'labels':
        return (
          <>
            {renderWalletPage()}
            {renderSettingsPage()}
            <Suspense fallback={null}>
              {renderPasskeySettingsPage()}
              <LabelsPage
                onBack={() => setUserScreen('passkeySettings')}
                onSwitchLabel={async (label) => {
                  await sdk.switchPasskeyLabel(label);
                  setUserScreen('wallet');
                }}
              />
            </Suspense>
          </>
        );

      case 'passkeyLocalState':
        return (
          <>
            {renderWalletPage()}
            {renderSettingsPage()}
            <Suspense fallback={null}>
              {renderPasskeySettingsPage()}
              <PasskeyLocalStatePage onBack={() => setUserScreen('passkeySettings')} onCompleted={handleLogout} />
            </Suspense>
          </>
        );

      case 'buyProviders':
        return (
          <>
            {renderWalletPage()}
            {buyProvidersSource === 'settings' && renderSettingsPage()}
            <BuyProvidersPage
              onBack={() => setUserScreen(buyProvidersSource === 'settings' ? 'settings' : 'wallet')}
              slideFrom={buyProvidersSource === 'settings' ? 'right' : 'up'}
              // Wallet-sourced = modal-style presentation (slides up from
              // the Buy button) → X close affordance in the header.
              // Settings-sourced = drill-in nav (slides in from the
              // right) → < back affordance. Matches iOS/Material
              // conventions for modal vs. push navigation.
              closeStyle={buyProvidersSource === 'settings' ? 'back' : 'close'}
              network={sdk.config?.network}
            />
          </>
        );

      // Security & Backup share one branch so SecurityPage stays
      // mounted (gate passed, options state intact) underneath an
      // opened BackupPage — returning from Backup must not re-run the
      // PIN/biometric gate. On web, Backup opens directly from
      // Settings and SecurityPage never mounts.
      case 'backup':
      case 'security': {
        const backupFromSecurity = backupSource === 'security';
        return (
          <>
            {renderWalletPage()}
            {renderSettingsPage()}
            {(currentScreen === 'security' || backupFromSecurity) && (
              <SecurityPage
                onBack={() => setUserScreen('settings')}
                onOpenBackup={() => {
                  setBackupSource('security');
                  setUserScreen('backup');
                }}
              />
            )}
            {currentScreen === 'backup' && (
              <BackupPage
                closeStyle="back"
                onBack={() => setUserScreen(backupFromSecurity ? 'security' : 'settings')}
              />
            )}
          </>
        );
      }

      case 'restore':
        return (
          <RestorePage
            onConnect={(mnemonic) => handleConnect(mnemonic, true)}
            onBack={() => setUserScreen('home')}
            onClearError={sdk.clearError}
            isLoading={sdk.isLoading}
          />
        );

      case 'generate':
        return (
          <GeneratePage
            onMnemonicConfirmed={(mnemonic) => handleConnect(mnemonic, false)}
            onBack={() => setUserScreen('home')}
            error={sdk.error}
            onClearError={sdk.clearError}
          />
        );

      case 'wallet':
        return <>{renderWalletPage()}</>;

      default:
        return <div>Unknown screen</div>;
    }
  };

  return (
    <WalletProvider client={sdk.sdk} isConnected={sdk.isConnected} subscribeToSdkEvents={sdk.subscribeToSdkEvents}>
      <WalletInfoProvider walletInfo={sdk.walletInfo}>
        <WalletStatusProvider hasPendingConversion={sdk.hasPendingConversion}>
          <FiatDataProvider>
            <StableBalanceProvider>
              <StableBalanceFormatterBridge formatterRef={formatPaymentAmountRef} />
              <ContactsProvider>
                {renderCurrentScreen()}
              </ContactsProvider>
              {/* Held back (not just covered) while locked: the
                  celebration auto-dismisses on a timer, so mounting it
                  behind the lock screen would burn it unseen. Deferring
                  the mount plays it in full after unlock. */}
              {sdk.celebrationPayment !== null && !appLock.locked && (
                <PaymentReceivedCelebration
                  payment={sdk.celebrationPayment}
                  onClose={sdk.dismissCelebration}
                />
              )}
              {migrationEverOpened && (
                <Suspense fallback={null}>
                  <PasskeyMigrationModal
                    isOpen={migrationModalOpen}
                    entry={migrationEntry}
                    activeLegacySdk={sdk.sdk}
                    onClose={handleMigrationClose}
                    onSwitchToNewWallet={handleMigrationSwitch}
                  />
                </Suspense>
              )}
              <InstallPrompt />
              <OfflineBanner />
              {appLock.locked && (
                <LockScreen
                  biometricGate={appLock.biometricGate}
                  suppressAutoBiometric={currentScreen === 'unlocking' || currentScreen === 'unlock'}
                  unlockWithPin={appLock.unlockWithPin}
                  unlockWithBiometric={appLock.unlockWithBiometric}
                />
              )}
            </StableBalanceProvider>
          </FiatDataProvider>
        </WalletStatusProvider>
      </WalletInfoProvider>
    </WalletProvider>
  );
};

function App() {
  return (
    <StagingGate>
      <AppShell>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AppShell>
    </StagingGate>
  );
}

export default App;
