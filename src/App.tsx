import React, { useState, useEffect } from 'react';
import { WalletProvider } from './contexts/WalletContext';
import LoadingSpinner from './components/LoadingSpinner';
import PaymentReceivedCelebration from './components/PaymentReceivedCelebration';
import InstallPrompt from './components/InstallPrompt';
import StagingGate from './components/StagingGate';
import { ToastProvider, useToast } from './contexts/ToastContext';
import AppShell from './components/layout/AppShell';
import { useBreezSdk } from './hooks/useBreezSdk';

import HomePage from './pages/HomePage';
import WalletPage from './pages/WalletPage';
import RestorePage from './pages/RestorePage';
import GeneratePage from './pages/GeneratePage';
import GetRefundPage from './pages/GetRefundPage';
import BackupPage from './pages/BackupPage';
import SettingsPage from './pages/SettingsPage';
import FiatCurrenciesPage from './pages/FiatCurrenciesPage';
import { useIOSViewportFix } from './hooks/useIOSViewportFix';

type Screen = 'home' | 'restore' | 'generate' | 'wallet' | 'getRefund' | 'settings' | 'backup' | 'fiatCurrencies';

const AppContent: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [refundAnimationDirection, setRefundAnimationDirection] = useState<'left' | 'up'>('left');
  const { showToast } = useToast();

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
    await sdk.connectWallet(mnemonic, restore);
    setCurrentScreen('wallet');
  };

  const handleLogout = async () => {
    await sdk.handleLogout();
    setCurrentScreen('home');
  };

  // Render screens
  const renderCurrentScreen = () => {
    if (sdk.isLoading && currentScreen !== 'restore') {
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
