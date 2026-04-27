import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { ContactsProvider } from './contexts/ContactsContext';

import { useIOSViewportFix } from './hooks/useIOSViewportFix';
import type { Seed, Payment } from '@breeztech/breez-sdk-spark';

type Screen = 'home' | 'restore' | 'generate' | 'wallet' | 'getRefund' | 'settings' | 'backup' | 'fiatCurrencies' | 'buyProviders' | 'passkey';

// Bridge component that feeds StableBalance formatter back to useBreezSdk via a mutable ref
const StableBalanceFormatterBridge: React.FC<{ formatterRef: React.MutableRefObject<((payment: Payment) => string) | undefined> }> = ({ formatterRef }) => {
  const stableBalance = useStableBalance();
  useEffect(() => {
    formatterRef.current = stableBalance.formatPaymentAmount;
  }, [formatterRef, stableBalance.formatPaymentAmount]);
  return null;
};

const AppContent: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [refundAnimationDirection, setRefundAnimationDirection] = useState<'left' | 'up'>('left');
  const [buyProvidersSource, setBuyProvidersSource] = useState<'wallet' | 'settings'>('wallet');
  const [passkeySdkConnected, setPasskeySdkConnected] = useState(false);
  const { showToast } = useToast();
  const formatPaymentAmountRef = useRef<((payment: Payment) => string) | undefined>(undefined);

  useIOSViewportFix();

  const sdk = useBreezSdk(showToast);

  // Auto-navigate to wallet when SDK reconnects from saved mnemonic
  useEffect(() => {
    if (sdk.isConnected && currentScreen === 'home') {
      setCurrentScreen('wallet');
    }
  }, [sdk.isConnected, currentScreen]);

  // Navigate to wallet after successful connect
  const handleConnect = async (mnemonic: string, restore: boolean) => {
    await sdk.connectWallet({ type: 'mnemonic', mnemonic }, restore);
    setCurrentScreen('wallet');
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
            onCreateNewWallet={() => setCurrentScreen('generate')}
            onUsePasskey={() => setCurrentScreen('passkey')}
            prfAvailable={sdk.prfAvailable}
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
            onOpenBuyProviders={() => { setBuyProvidersSource('settings'); setCurrentScreen('buyProviders'); }}
          />
        );

      case 'fiatCurrencies':
        return (
          <FiatCurrenciesPage onBack={() => setCurrentScreen('settings')} />
        );

      case 'buyProviders':
        return (
          <BuyProvidersPage
            onBack={() => setCurrentScreen(buyProvidersSource === 'settings' ? 'settings' : 'wallet')}
            slideFrom={buyProvidersSource === 'settings' ? 'right' : 'up'}
            network={sdk.config?.network}
          />
        );

      case 'backup':
        return (
          <BackupPage onBack={() => setCurrentScreen('wallet')} />
        );

      case 'restore':
        return (
          <RestorePage
            onConnect={(mnemonic) => handleConnect(mnemonic, true)}
            onBack={() => setCurrentScreen('home')}
            onClearError={sdk.clearError}
            isLoading={sdk.isLoading}
          />
        );

      case 'generate':
        return (
          <GeneratePage
            onMnemonicConfirmed={(mnemonic) => handleConnect(mnemonic, false)}
            onBack={() => setCurrentScreen('home')}
            error={sdk.error}
            onClearError={sdk.clearError}
          />
        );

      case 'wallet':
        if (!sdk.isConnected) {
          return (
            <HomePage
              onRestoreWallet={() => setCurrentScreen('restore')}
              onCreateNewWallet={() => setCurrentScreen('generate')}
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
            onOpenBuyProviders={() => { setBuyProvidersSource('wallet'); setCurrentScreen('buyProviders'); }}
            onBuyBitcoin={sdk.handleBuyBitcoin}
            network={sdk.config?.network}
            onDepositChanged={sdk.fetchUnclaimedDeposits}
          />
        );

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
