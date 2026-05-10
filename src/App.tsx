import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { Capacitor } from '@capacitor/core';
import { WalletProvider, WalletInfoProvider } from './contexts/WalletContext';
import LoadingSpinner from './components/LoadingSpinner';
import PaymentReceivedCelebration from './components/PaymentReceivedCelebration';
import InstallPrompt from './components/InstallPrompt';
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
import PasskeyPage from './pages/PasskeyPage';
import SettingsPage from './pages/SettingsPage';
import FiatCurrenciesPage from './pages/FiatCurrenciesPage';
import BuyProvidersPage from './pages/BuyProvidersPage';
import UnlockPage from './pages/UnlockPage';
import UnlockingPage from './pages/UnlockingPage';
import SetPasswordPage from './pages/SetPasswordPage';
import VaultUnlockPage from './pages/VaultUnlockPage';
import { createVault, createVaultFromMaterial, deriveVaultKey, type VaultKeyMaterial } from './services/vault';
import { isPasswordPwned } from './utils/password';

const PWNED_MESSAGE = 'This password has appeared in a data breach. Please choose a different one.';
import { logger, LogCategory } from './services/logger';
import { formatError } from './utils/formatError';
// Dev-gated Passkey & Labels hub + the AAGUID lookup database it pulls
// in (~245 KB JSON). Code-split so neither the main bundle nor any
// non-dev user pays the parse cost; loads on first navigation into the
// hub. Settles within one paint on a typical connection.
const PasskeySettingsPage = lazy(() => import('./pages/PasskeySettingsPage'));
const PasskeyManagementPage = lazy(() => import('./pages/PasskeyManagementPage'));
const LabelsPage = lazy(() => import('./pages/LabelsPage'));
const PasskeyLocalStatePage = lazy(() => import('./pages/PasskeyLocalStatePage'));
import { ContactsProvider } from './contexts/ContactsContext';

import { useIOSViewportFix } from './hooks/useIOSViewportFix';
import { useStatusBarColor } from './hooks/useStatusBarColor';
import { STATUS_BAR_LOADING } from './utils/statusBarManager';
import { useBackButton } from './hooks/useBackButton';
import type { Seed, Payment } from '@breeztech/breez-sdk-spark';

type Screen = 'home' | 'restore' | 'generate' | 'wallet' | 'getRefund' | 'settings' | 'backup' | 'fiatCurrencies' | 'buyProviders' | 'passkey' | 'unlock' | 'unlocking' | 'passkeySettings' | 'passkeyManagement' | 'labels' | 'passkeyLocalState' | 'setPassword' | 'vaultUnlock' | 'migrate';

// Password vault flow is web-only; matches useBreezSdk.isWeb.
const isWeb = !Capacitor.isNativePlatform();
const LEGACY_MNEMONIC_KEY = 'walletMnemonic';

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
  const [refundAnimationDirection, setRefundAnimationDirection] = useState<'left' | 'up'>('left');
  const [buyProvidersSource, setBuyProvidersSource] = useState<'wallet' | 'settings'>('wallet');
  const [passkeySdkConnected, setPasskeySdkConnected] = useState(false);
  // True when the user entered the passkey screen via the explicit
  // "Create New Wallet" CTA on browsers without `immediateGet`. Skips
  // PasskeyPage's discovery (`detecting`) phase so we don't trigger a
  // cross-device QR picker on the first click of a fresh-user
  // onboarding. Read by PasskeyPage as the `skipDetection` prop.
  const [passkeySkipDetection, setPasskeySkipDetection] = useState(false);
  // Vault flow state shared across SetPasswordPage / GeneratePage / RestorePage.
  // Holds derived key material (CryptoKey is non-extractable) instead of
  // the plaintext password so the password doesn't sit in heap during
  // the seed-confirmation step.
  const [pendingMnemonic, setPendingMnemonic] = useState<string | null>(null);
  const [pendingKeyMaterial, setPendingKeyMaterial] = useState<VaultKeyMaterial | null>(null);
  const [pendingIsRestore, setPendingIsRestore] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const { showToast } = useToast();
  const formatPaymentAmountRef = useRef<((payment: Payment) => string) | undefined>(undefined);

  useIOSViewportFix();

  const sdk = useBreezSdk(showToast);

  // SDK startup state takes precedence; otherwise the user's screen
  // wins, with one exception: an SDK auto-reconnect (saved mnemonic /
  // biometric unlock) promotes the still-initial 'home' to 'wallet'
  // so the user lands in the wallet without an explicit click.
  const currentScreen: Screen = useMemo(() => {
    if (sdk.startupState === 'native-unlocking') return 'unlocking';
    if (sdk.startupState === 'native-locked') return 'unlock';
    if (sdk.startupState === 'vault-locked') return 'vaultUnlock';
    if (sdk.startupState === 'needs-migration') return 'migrate';
    if (sdk.isConnected && userScreen === 'home') return 'wallet';
    return userScreen;
  }, [sdk.startupState, sdk.isConnected, userScreen]);

  // Connect with a mnemonic and land on the wallet screen. Used after
  // every flow that already has the seed in hand (vault unlock,
  // migration, post-vault-create).
  const openWallet = async (mnemonic: string, restore = false) => {
    await sdk.connectWallet({ type: 'mnemonic', mnemonic }, restore);
    setUserScreen('wallet');
  };

  // Wraps a vault-related submit step with the loading / try-catch /
  // error-banner shell that SetPasswordPage and the migrate screen
  // both need. `failureMsg` is shown to the user AND logged.
  const runPasswordStep = async (
    work: () => Promise<void>,
    failureMsg: string,
  ): Promise<void> => {
    setPasswordError(null);
    setPasswordLoading(true);
    try {
      await work();
    } catch (e) {
      logger.error(LogCategory.AUTH, failureMsg, { error: formatError(e) });
      setPasswordError(failureMsg);
    } finally {
      setPasswordLoading(false);
    }
  };

  // Web routes through SetPasswordPage so the vault is created before
  // connectWallet runs. Native skips it: secure storage handles the seed.
  const handleConnect = async (mnemonic: string, restore: boolean) => {
    if (isWeb) {
      setPendingMnemonic(mnemonic);
      setPendingIsRestore(restore);
      setPasswordError(null);
      setUserScreen('setPassword');
      return;
    }
    await openWallet(mnemonic, restore);
  };

  // SetPasswordPage submit. Two flows share the form:
  //   - Restore: pendingMnemonic is set, encrypt + connect inline.
  //   - Create: derive key now (drop plaintext), defer encryption to
  //             GeneratePage once the user confirms the new mnemonic.
  const handlePasswordSet = async (password: string) => {
    await runPasswordStep(async () => {
      if (await isPasswordPwned(password)) {
        setPasswordError(PWNED_MESSAGE);
        return;
      }
      if (pendingMnemonic) {
        await createVault(pendingMnemonic, password);
        const mnemonic = pendingMnemonic;
        const restore = pendingIsRestore;
        setPendingMnemonic(null);
        setPendingIsRestore(false);
        await openWallet(mnemonic, restore);
      } else {
        setPendingKeyMaterial(await deriveVaultKey(password));
        setUserScreen('generate');
      }
    }, 'Failed to set up Glow. Please try again.');
  };

  // GeneratePage confirm. Web non-passkey: encrypt with the key
  // material captured on SetPasswordPage. Native: hand off to handleConnect.
  const handleGenerateConfirm = async (mnemonic: string) => {
    if (!isWeb) {
      await handleConnect(mnemonic, false);
      return;
    }
    if (!pendingKeyMaterial) {
      setUserScreen('setPassword');
      return;
    }
    setPasswordLoading(true);
    try {
      await createVaultFromMaterial(mnemonic, pendingKeyMaterial);
      setPendingKeyMaterial(null);
      await openWallet(mnemonic);
    } catch (e) {
      logger.error(LogCategory.AUTH, 'Failed to create vault after seed confirmation', { error: formatError(e) });
      showToast('error', 'Setup Failed', 'Failed to secure Glow. Please try again.');
    } finally {
      setPasswordLoading(false);
    }
  };

  // Migrate legacy plaintext mnemonic into the vault. Order matters:
  // vault is durable before plaintext goes away, and plaintext goes
  // away before connectWallet so a crash in the connect window can't
  // leave a vault + plaintext pair. A connect failure leaves the
  // vault in place; next launch hits 'vault-locked' for retry.
  const handleMigratePassword = async (password: string) => {
    await runPasswordStep(async () => {
      if (await isPasswordPwned(password)) {
        setPasswordError(PWNED_MESSAGE);
        return;
      }
      const mnemonic = localStorage.getItem(LEGACY_MNEMONIC_KEY);
      if (!mnemonic) {
        setPasswordError('No setup found to migrate.');
        return;
      }
      const wordCount = mnemonic.trim().split(/\s+/).length;
      if (wordCount !== 12 && wordCount !== 24) {
        setPasswordError('Stored recovery phrase is invalid. Please restore manually.');
        return;
      }
      await createVault(mnemonic, password);
      localStorage.removeItem(LEGACY_MNEMONIC_KEY);
      await openWallet(mnemonic);
    }, 'Failed to migrate. Please try again.');
  };

  // VaultUnlockPage owns its own loading + wrong-password feedback;
  // here we just wire the post-decrypt connect with a toast on failure.
  const handleVaultUnlocked = async (mnemonic: string) => {
    try {
      await openWallet(mnemonic);
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to connect after vault unlock', { error: formatError(e) });
      showToast('error', 'Failed to open Glow', 'Please try again.');
    }
  };

  const handleSetPasswordBack = () => {
    setPendingMnemonic(null);
    setPendingKeyMaterial(null);
    setPasswordError(null);
    setUserScreen(pendingMnemonic ? 'restore' : 'home');
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

  const handleLogout = async () => {
    setUserScreen('home');
    await sdk.handleLogout();
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
      case 'backup':
      case 'getRefund':
        setUserScreen('wallet');
        return true;
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
      case 'setPassword':
        setUserScreen('home');
        return true;
      case 'vaultUnlock':
      case 'migrate':
        // Startup-driven; absorb so back doesn't minimise mid-unlock.
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
  }, [currentScreen, buyProvidersSource]), true);

  // Render screens
  const renderCurrentScreen = () => {
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
      currentScreen !== 'unlocking' &&
      currentScreen !== 'vaultUnlock' &&
      currentScreen !== 'setPassword' &&
      currentScreen !== 'migrate'
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
            onCreateNewWallet={() => {
              if (isWeb) {
                // Web: capture password first, GeneratePage consumes it on confirm.
                setPendingMnemonic(null);
                setPendingKeyMaterial(null);
                setPendingIsRestore(false);
                setPasswordError(null);
                setUserScreen('setPassword');
              } else {
                setUserScreen('generate');
              }
            }}
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
          onOpenBackup={() => setUserScreen('backup')}
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
            onCreateNewWallet={() => {
              if (isWeb) {
                // Web: capture password first, GeneratePage consumes it on confirm.
                setPendingMnemonic(null);
                setPendingKeyMaterial(null);
                setPendingIsRestore(false);
                setPasswordError(null);
                setUserScreen('setPassword');
              } else {
                setUserScreen('generate');
              }
            }}
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
            isSecuringSeed={sdk.isSecuringSeed}
            onFlowComplete={handlePasskeyFlowComplete}
            consumeFreshInstallSignal={sdk.consumeFreshInstallSignal}
            skipDetection={passkeySkipDetection}
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

      case 'backup':
        return (
          <>
            {renderWalletPage()}
            <BackupPage onBack={() => setUserScreen('wallet')} />
          </>
        );

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
            onMnemonicConfirmed={handleGenerateConfirm}
            onBack={() => setUserScreen(isWeb ? 'setPassword' : 'home')}
            error={sdk.error}
            onClearError={sdk.clearError}
          />
        );

      case 'setPassword':
        return (
          <SetPasswordPage
            onPasswordSet={handlePasswordSet}
            onBack={handleSetPasswordBack}
            isLoading={passwordLoading}
            error={passwordError}
          />
        );

      case 'vaultUnlock':
        return <VaultUnlockPage onUnlocked={handleVaultUnlocked} />;

      case 'migrate':
        return (
          <SetPasswordPage
            mode="migrate"
            onPasswordSet={handleMigratePassword}
            isLoading={passwordLoading}
            error={passwordError}
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
        <FiatDataProvider>
          <StableBalanceProvider>
            <StableBalanceFormatterBridge formatterRef={formatPaymentAmountRef} />
            <ContactsProvider>
              {renderCurrentScreen()}
            </ContactsProvider>
            {sdk.celebrationPayment !== null && (
              <PaymentReceivedCelebration
                payment={sdk.celebrationPayment}
                onClose={sdk.dismissCelebration}
              />
            )}
            <InstallPrompt />
          </StableBalanceProvider>
        </FiatDataProvider>
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
