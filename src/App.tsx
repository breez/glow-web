import React, { useState, useEffect } from 'react';
import { WalletProvider } from './contexts/WalletContext';
import LoadingSpinner from './components/LoadingSpinner';
import PaymentReceivedCelebration from './components/PaymentReceivedCelebration';
import NotificationPrompt from './components/NotificationPrompt';
import InstallPrompt from './components/InstallPrompt';
import StagingGate from './components/StagingGate';
import { ToastProvider, useToast } from './contexts/ToastContext';
import AppShell from './components/layout/AppShell';
import { useBreezClient } from './hooks/useBreezClient';

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

  const client = useBreezClient(showToast);

  // Auto-navigate to wallet when SDK reconnects from saved mnemonic
  useEffect(() => {
    if (client.isConnected && currentScreen === 'home') {
      setCurrentScreen('wallet');
    }
  }, [client.isConnected, currentScreen]);

  // Navigate to wallet after successful connect
  const handleConnect = async (mnemonic: string, restore: boolean) => {
    await client.connectWallet(mnemonic, restore);
    setCurrentScreen('wallet');
  };

  const handleLogout = async () => {
    await client.handleLogout();
    setCurrentScreen('home');
  };

  // Render screens
  const renderCurrentScreen = () => {
    if (client.isLoading && currentScreen !== 'restore') {
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
            config={client.config}
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
            onClearError={client.clearError}
            isLoading={client.isLoading}
          />
        );

      case 'generate':
        return (
          <GeneratePage
            onMnemonicConfirmed={(mnemonic) => handleConnect(mnemonic, false)}
            onBack={() => setCurrentScreen('home')}
            error={client.error}
            onClearError={client.clearError}
          />
        );

      case 'wallet':
        return (
          <WalletPage
            walletInfo={client.walletInfo}
            transactions={client.transactions}
            unclaimedDeposits={client.unclaimedDeposits}
            fiatRates={client.fiatRates}
            fiatCurrencies={client.fiatCurrencies}
            refreshWalletData={client.refreshWalletData}
            isSyncing={client.isSyncing}
            error={client.error}
            onClearError={client.clearError}
            onLogout={handleLogout}
            hasRejectedDeposits={client.hasRejectedDeposits}
            onOpenGetRefund={(source?: 'menu' | 'icon') => {
              setRefundAnimationDirection(source === 'icon' ? 'up' : 'left');
              setCurrentScreen('getRefund');
            }}
            onOpenSettings={() => setCurrentScreen('settings')}
            onOpenBackup={() => setCurrentScreen('backup')}
            onOpenBuyBitcoin={client.handleBuyBitcoin}
            onDepositChanged={client.fetchUnclaimedDeposits}
          />
        );

      default:
        return <div>Unknown screen</div>;
    }
  };

  return (
    <>
      {renderCurrentScreen()}
      {client.celebrationAmount !== null && (
        <PaymentReceivedCelebration
          amount={client.celebrationAmount}
          onClose={client.dismissCelebration}
        />
      )}
      {client.isConnected && <NotificationPrompt />}
      <InstallPrompt />
    </>
  );
};

function App() {
  return (
    <StagingGate>
      <WalletProvider>
        <AppShell>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </AppShell>
      </WalletProvider>
    </StagingGate>
  );
}

export default App;
