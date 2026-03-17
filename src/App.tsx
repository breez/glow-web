import React, { useState, useEffect, useCallback } from 'react';
import { WalletProvider } from './contexts/WalletContext';
import LoadingSpinner from './components/LoadingSpinner';
import PaymentReceivedCelebration from './components/PaymentReceivedCelebration';
import InstallPrompt from './components/InstallPrompt';
import StagingGate from './components/StagingGate';
import { ToastProvider, useToast } from './contexts/ToastContext';
import AppShell from './components/layout/AppShell';
import { useBreezSdk } from './hooks/useBreezSdk';
import { createVault } from './services/vault';

import HomePage from './pages/HomePage';
import WalletPage from './pages/WalletPage';
import RestorePage from './pages/RestorePage';
import GeneratePage from './pages/GeneratePage';
import GetRefundPage from './pages/GetRefundPage';
import BackupPage from './pages/BackupPage';
import PasskeyPage from './pages/PasskeyPage';
import SettingsPage from './pages/SettingsPage';
import FiatCurrenciesPage from './pages/FiatCurrenciesPage';
import SetPasswordPage from './pages/SetPasswordPage';
import UnlockPage from './pages/UnlockPage';
import MigrationPage from './pages/MigrationPage';
import { useIOSViewportFix } from './hooks/useIOSViewportFix';
import type { Seed } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from './services/logger';
import { formatError } from './utils/formatError';

type Screen = 'home' | 'restore' | 'generate' | 'wallet' | 'getRefund' | 'settings' | 'backup' | 'fiatCurrencies' | 'passkey' | 'setPassword' | 'unlock' | 'migrate';

const MNEMONIC_KEY = 'walletMnemonic';

const AppContent: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [refundAnimationDirection, setRefundAnimationDirection] = useState<'left' | 'up'>('left');
  const [passkeySdkConnected, setPasskeySdkConnected] = useState(false);
  const [pendingMnemonic, setPendingMnemonic] = useState<string | null>(null);
  const [pendingIsRestore, setPendingIsRestore] = useState(false);
  const [pendingPassword, setPendingPassword] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const { showToast } = useToast();

  useIOSViewportFix();

  const sdk = useBreezSdk(showToast);

  // Route based on startup state
  useEffect(() => {
    switch (sdk.startupState) {
      case 'vault-locked':
        setCurrentScreen('unlock');
        break;
      case 'needs-migration':
        setCurrentScreen('migrate');
        break;
      case 'no-wallet':
        if (currentScreen === 'home' || currentScreen === 'unlock' || currentScreen === 'migrate') {
          setCurrentScreen('home');
        }
        break;
      case 'connected':
        if (['home', 'unlock', 'migrate'].includes(currentScreen)) {
          setCurrentScreen('wallet');
        }
        break;
    }
  }, [sdk.startupState]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setCurrentScreen('wallet');
  }, []);

  const handleLogout = async () => {
    setCurrentScreen('home');
    await sdk.handleLogout();
  };

  // Render screens
  const renderCurrentScreen = () => {
    if (sdk.isLoading && currentScreen !== 'restore' && currentScreen !== 'passkey') {
      return (
        <div className="absolute inset-0 bg-spark-void/95 backdrop-blur-sm z-50 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      );
    }

    switch (currentScreen) {
      case 'home':
        return (
          <HomePage
            onRestoreWallet={() => setCurrentScreen('restore')}
            onCreateNewWallet={() => {
              setPendingIsRestore(false);
              setPendingMnemonic(null);
              setCurrentScreen('setPassword');
            }}
            onUsePasskey={() => setCurrentScreen('passkey')}
            prfAvailable={sdk.prfAvailable}
          />
        );

      case 'setPassword':
        return (
          <SetPasswordPage
            onPasswordSet={async (password) => {
              setPasswordError(null);
              setPasswordLoading(true);
              try {
                if (pendingMnemonic) {
                  // Restore flow: mnemonic already entered, encrypt and connect
                  await createVault(pendingMnemonic, password);
                  await sdk.connectWallet({ type: 'mnemonic', mnemonic: pendingMnemonic }, pendingIsRestore);
                  setPendingMnemonic(null);
                  setPendingIsRestore(false);
                  setCurrentScreen('wallet');
                } else {
                  // Generate flow: save password, go to seed display
                  setPendingPassword(password);
                  setCurrentScreen('generate');
                }
              } catch (e) {
                logger.error(LogCategory.AUTH, 'Failed during password setup', { error: formatError(e) });
                setPasswordError('Failed to set up wallet. Please try again.');
              } finally {
                setPasswordLoading(false);
              }
            }}
            onBack={() => {
              setPendingMnemonic(null);
              setPendingPassword(null);
              setPasswordError(null);
              setCurrentScreen(pendingMnemonic ? 'restore' : 'home');
            }}
            isLoading={passwordLoading}
            error={passwordError}
          />
        );

      case 'unlock':
        return (
          <UnlockPage
            onUnlocked={async (mnemonic) => {
              await sdk.connectWallet({ type: 'mnemonic', mnemonic }, false);
              setCurrentScreen('wallet');
            }}
            onForgotPassword={() => setCurrentScreen('restore')}
          />
        );

      case 'migrate':
        return (
          <MigrationPage
            onPasswordSet={async (password) => {
              setPasswordError(null);
              setPasswordLoading(true);
              try {
                const mnemonic = localStorage.getItem(MNEMONIC_KEY);
                if (!mnemonic) {
                  setPasswordError('No wallet found to migrate.');
                  return;
                }
                await createVault(mnemonic, password);
                localStorage.removeItem(MNEMONIC_KEY);
                await sdk.connectWallet({ type: 'mnemonic', mnemonic }, false);
                setCurrentScreen('wallet');
              } catch (e) {
                logger.error(LogCategory.AUTH, 'Failed during migration', { error: formatError(e) });
                setPasswordError('Failed to secure wallet. Please try again.');
              } finally {
                setPasswordLoading(false);
              }
            }}
            isLoading={passwordLoading}
            error={passwordError}
          />
        );

      case 'passkey':
        return (
          <PasskeyPage
            onWalletRestored={handlePasskeyConnect}
            onBack={() => {
              setPasskeySdkConnected(false);
              setCurrentScreen('home');
            }}
            sdkConnected={passkeySdkConnected}
            onFlowComplete={handlePasskeyFlowComplete}
          />
        );

      case 'getRefund':
        return (
          <GetRefundPage
            onBack={() => setCurrentScreen('wallet')}
            animationDirection={refundAnimationDirection}
          />
        );

      case 'settings':
        return (
          <SettingsPage
            onBack={() => setCurrentScreen('wallet')}
            config={sdk.config}
            onOpenFiatCurrencies={() => setCurrentScreen('fiatCurrencies')}
          />
        );

      case 'fiatCurrencies':
        return (
          <FiatCurrenciesPage onBack={() => setCurrentScreen('settings')} />
        );

      case 'backup':
        return (
          <BackupPage onBack={() => setCurrentScreen('wallet')} mnemonic={sdk.walletMnemonic} />
        );

      case 'restore':
        return (
          <RestorePage
            onConnect={async (mnemonic) => {
              setPendingMnemonic(mnemonic);
              setPendingIsRestore(true);
              setCurrentScreen('setPassword');
            }}
            onBack={() => setCurrentScreen('home')}
            onClearError={sdk.clearError}
            isLoading={sdk.isLoading}
          />
        );

      case 'generate':
        return (
          <GeneratePage
            onMnemonicConfirmed={async (mnemonic) => {
              if (!pendingPassword) return;
              setPasswordLoading(true);
              try {
                await createVault(mnemonic, pendingPassword);
                await sdk.connectWallet({ type: 'mnemonic', mnemonic }, false);
                setPendingPassword(null);
                setCurrentScreen('wallet');
              } catch (e) {
                logger.error(LogCategory.AUTH, 'Failed to create vault after seed confirmation', { error: formatError(e) });
                sdk.clearError();
                showToast('error', 'Setup Failed', 'Failed to encrypt wallet. Please try again.');
              } finally {
                setPasswordLoading(false);
              }
            }}
            onBack={() => {
              setPendingPassword(null);
              setCurrentScreen('setPassword');
            }}
            error={sdk.error}
            onClearError={sdk.clearError}
          />
        );

      case 'wallet':
        if (!sdk.isConnected) {
          return (
            <HomePage
              onRestoreWallet={() => setCurrentScreen('restore')}
              onCreateNewWallet={() => {
                setPendingIsRestore(false);
                setPendingMnemonic(null);
                setCurrentScreen('setPassword');
              }}
              onUsePasskey={() => setCurrentScreen('passkey')}
              prfAvailable={sdk.prfAvailable}
            />
          );
        }
        return (
          <WalletPage
            walletInfo={sdk.walletInfo}
            transactions={sdk.transactions}
            unclaimedDeposits={sdk.unclaimedDeposits}
            fiatRates={sdk.fiatRates}
            fiatCurrencies={sdk.fiatCurrencies}
            refreshWalletData={sdk.refreshWalletData}
            isSyncing={sdk.isSyncing}
            error={sdk.error}
            onClearError={sdk.clearError}
            onLogout={handleLogout}
            hasRejectedDeposits={sdk.hasRejectedDeposits}
            onOpenGetRefund={(source?: 'menu' | 'icon') => {
              setRefundAnimationDirection(source === 'icon' ? 'up' : 'left');
              setCurrentScreen('getRefund');
            }}
            onOpenSettings={() => setCurrentScreen('settings')}
            onOpenBackup={() => setCurrentScreen('backup')}
            onOpenBuyBitcoin={sdk.handleBuyBitcoin}
            onDepositChanged={sdk.fetchUnclaimedDeposits}
          />
        );

      default:
        return <div>Unknown screen</div>;
    }
  };

  return (
    <WalletProvider client={sdk.sdk}>
      {renderCurrentScreen()}
      {sdk.celebrationAmount !== null && (
        <PaymentReceivedCelebration
          amount={sdk.celebrationAmount}
          onClose={sdk.dismissCelebration}
        />
      )}
      <InstallPrompt />
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
