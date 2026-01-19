import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Config, GetInfoResponse, Network, Payment, SdkEvent, defaultConfig, Rate, FiatCurrency } from '@breeztech/breez-sdk-spark';
import { WalletProvider, useWallet } from './contexts/WalletContext';
import LoadingSpinner from './components/LoadingSpinner';
import PaymentReceivedCelebration from './components/PaymentReceivedCelebration';
import { ToastProvider, useToast } from './contexts/ToastContext';

// Import our page components
import HomePage from './pages/HomePage';
import RestorePage from './pages/RestorePage';
import GeneratePage from './pages/GeneratePage';
import WalletPage from './pages/WalletPage';
import UnclaimedDepositsPage from './pages/UnclaimedDepositsPage';
import BackupPage from './pages/BackupPage';
import SettingsPage from './pages/SettingsPage';
import FiatCurrenciesPage from './pages/FiatCurrenciesPage';
import { getSettings } from './services/settings';

// Main App without toast functionality
const AppContent: React.FC = () => {
  // Screen navigation state
  const [currentScreen, setCurrentScreen] = useState<'home' | 'restore' | 'generate' | 'wallet' | 'unclaimedDeposits' | 'settings' | 'backup' | 'fiatCurrencies'>('home');

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [walletInfo, setWalletInfo] = useState<GetInfoResponse | null>(null);
  const [transactions, setTransactions] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fiatRates, setFiatRates] = useState<Rate[]>([]);
  const [fiatCurrencies, setFiatCurrencies] = useState<FiatCurrency[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [hasUnclaimedDeposits, setHasUnclaimedDeposits] = useState<boolean>(false);
  const [celebrationAmount, setCelebrationAmount] = useState<number | null>(null);

  const { showToast } = useToast();

  // Add a ref to store the event listener ID
  const eventListenerIdRef = useRef<string | null>(null);

  // Function to refresh wallet data (usable via a callback)
  const wallet = useWallet();

  const refreshWalletData = useCallback(async (showLoading: boolean = true) => {
    if (!isConnected) return;

    try {
      if (showLoading) {
        setIsLoading(true);
      }

      const info = await wallet.getWalletInfo();
      const txns = await wallet.getTransactions();

      setWalletInfo(info);
      setTransactions(txns);
    } catch (error) {
      console.error('Error refreshing wallet data:', error);
      setError('Failed to refresh wallet data.');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [isConnected, wallet]);

  // Fetch unclaimed deposits list and update indicator
  const fetchUnclaimedDeposits = useCallback(async () => {
    try {
      const deposits = await wallet.unclaimedDeposits();
      setHasUnclaimedDeposits((deposits?.length ?? 0) > 0);
    } catch (e) {
      console.warn('Failed to fetch unclaimed deposits:', e);
      setHasUnclaimedDeposits(false);
    }
  }, [wallet]);


  // SDK event handler with toast notifications and auto-close of receive dialog
  const handleSdkEvent = useCallback((event: SdkEvent) => {
    console.log('SDK event received:', event);

    // Handle synced events
    if (event.type === 'synced') {
      console.log('Synced event received, refreshing data...');

      // If this is the first sync event after connecting, mark restoration as complete
      if (isRestoring) {
        setIsRestoring(false);
      }

      // Don't show loading indicator for automatic refresh
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    }

    // Handle SDK events with toast notifications
    if (event.type === 'synced') {
      console.log('Wallet synced event received');
      // Refresh wallet data when synced
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    } else if (event.type === 'paymentSucceeded') {
      console.log('Payment succeeded event received');
      const isReceived = event.payment.paymentType === 'receive';
      
      if (isReceived) {
        // Show celebration animation for received payments
        setCelebrationAmount(Number(event.payment.amount));
      } else {
        // Show toast for sent payments
        showToast(
          'success',
          'Payment Sent',
          `${event.payment.amount} sats sent successfully`
        );
      }
      refreshWalletData(false);
    } else if (event.type === 'claimedDeposits') {
      console.log('Claim deposits succeeded event received');
      if (currentScreen !== 'unclaimedDeposits') {
        showToast(
          'success',
          'Deposits Claimed Successfully',
          `${event.claimedDeposits.length} deposits were claimed`
        );
      }
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    } else if (event.type === 'unclaimedDeposits') {
      console.log('Claim deposits failed event received');
      if (currentScreen !== 'unclaimedDeposits') {
        showToast(
          'error',
          'Failed to Claim Deposits',
          `${event.unclaimedDeposits.length} deposits could not be claimed`
        );
      }
      // Refresh the list as some may remain unclaimed
      fetchUnclaimedDeposits();
    }
    refreshWalletData(false);
  }, [refreshWalletData, showToast, isRestoring, fetchUnclaimedDeposits, currentScreen]);

  // Fetch fiat rates from SDK
  const fetchFiatData = useCallback(async () => {
    try {
      const [rates, currencies] = await Promise.all([
        wallet.listFiatRates(),
        wallet.listFiatCurrencies(),
      ]);
      setFiatRates(rates);
      setFiatCurrencies(currencies);
    } catch (error) {
      console.warn('Failed to fetch fiat data:', error);
    }
  }, [wallet]);

  // Set up periodic fiat rate fetching
  useEffect(() => {
    if (isConnected) {
      // Fetch immediately upon connection
      fetchFiatData();

      // Then set up interval for every 60 seconds
      const interval = setInterval(fetchFiatData, 60000);

      // Clean up interval on disconnect
      return () => clearInterval(interval);
    }
  }, [isConnected, fetchFiatData]);

  // Try to connect with saved mnemonic on app startup (run once)
  useEffect(() => {
    console.log('useEffect checkForExistingWallet...');
    const checkForExistingWallet = async () => {
      console.log('checkForExistingWallet...');
      const savedMnemonic = wallet.getSavedMnemonic();
      console.log('Saved mnemonic:', savedMnemonic);
      if (savedMnemonic) {
        try {
          setIsLoading(true);
          await connectWallet(savedMnemonic, false);
          console.log('Connected to wallet');
          setCurrentScreen('wallet'); // Navigate to wallet screen
        } catch (error) {
          console.error('Failed to connect with saved mnemonic:', error);
          setError('Failed to connect with saved mnemonic. Please try again.');
          wallet.clearMnemonic();
          setCurrentScreen('home'); // Go back to home screen on failure
          setIsLoading(false);
        }
      } else {
        setCurrentScreen('home'); // Show home screen if no saved mnemonic
        setIsLoading(false);
      }
    };

    checkForExistingWallet();

    // No cleanup here; logout handles disconnect explicitly
  }, []);

  // Set up event listener when connected
  useEffect(() => {
    if (isConnected) {
      console.log('Setting up event listener...');
      wallet.addEventListener(handleSdkEvent)
        .then(listenerId => {
          eventListenerIdRef.current = listenerId;
          console.log('Registered event listener with ID:', listenerId);
        })
        .catch(error => {
          console.error('Failed to add event listener:', error);
          setError('Failed to set up event listeners.');
        });

      return () => {
        // Clean up by removing the specific listener
        if (eventListenerIdRef.current) {
          wallet.removeEventListener(eventListenerIdRef.current)
            .catch(error => console.error('Error removing event listener:', error));
          eventListenerIdRef.current = null;
        }
      };
    }
  }, [isConnected, handleSdkEvent, wallet]);

  const connectWallet = async (mnemonic: string, restore: boolean, overrideNetwork?: Network) => {
    try {
      console.log('Connecting wallet...');
      // Guard against double-connect
      if (wallet.connected()) {
        console.log('Already connected; skipping connectWallet');
        return;
      }
      console.log('Connecting wallet...');
      setIsLoading(true);
      setIsRestoring(restore); // Mark that we're restoring data      
      setError(null);

      // Initialize wallet with mnemonic

      const breezApiKey = import.meta.env.VITE_BREEZ_API_KEY;

      if (!breezApiKey) {
        showToast('error', 'Missing API Key', 'Please add VITE_BREEZ_API_KEY to your .env file');
        throw new Error('Breez API key not found. Create a .env file with VITE_BREEZ_API_KEY=your_key');
      }

      const urlParams = new URLSearchParams(window.location.search);
      const network = (overrideNetwork ?? (urlParams.get('network') ?? 'mainnet')) as Network;
      const config: Config = defaultConfig(network);
      config.apiKey = breezApiKey;
      config.privateEnabledDefault = false;

      // Apply persisted user settings to config
      try {
        const s = getSettings();
        // Max fee for deposit claim
        if (s.depositMaxFee) {
          config.maxDepositClaimFee = s.depositMaxFee;
        }
        // Optional settings
        if (s.syncIntervalSecs != null) {
          config.syncIntervalSecs = s.syncIntervalSecs;
        }
        if (s.lnurlDomain != null) {
          config.lnurlDomain = s.lnurlDomain;
        }
        if (s.preferSparkOverLightning != null) {
          config.preferSparkOverLightning = s.preferSparkOverLightning;
        }
      } catch (e) {
        console.warn('Failed to apply user settings to config:', e);
      }

      setConfig(config);
      await wallet.initWallet(mnemonic, config);

      console.log('Wallet connected successfully');
      // Save mnemonic for future use
      wallet.saveMnemonic(mnemonic);

      // Get wallet info and transactions
      const info = await wallet.getWalletInfo();
      const txns = await wallet.getTransactions();

      setWalletInfo(info);
      setTransactions(txns);

      setIsConnected(true);
      // Fetch unclaimed deposits indicator after connect
      await fetchUnclaimedDeposits();
      setCurrentScreen('wallet'); // Navigate to wallet screen
      // We'll keep isLoading true until first sync for new wallets
      setIsLoading(false);

    } catch (error) {
      console.error('Error connecting wallet:', error);
      setError('Failed to connect wallet. Please check your mnemonic and try again.');
      setIsRestoring(false);
      setIsLoading(false);
    }
  };

  // Handle logout
  const handleLogout = useCallback(async () => {
    try {
      setIsLoading(true);

      // Disconnect from Breez SDK
      if (isConnected) {
        await wallet.disconnect();
      }

      // Clear the stored mnemonic
      wallet.clearMnemonic();

      // Reset state
      setIsConnected(false);
      setWalletInfo(null);
      setTransactions([]);

      // Navigate back to home screen
      setCurrentScreen('home');

      // Show logout success toast
      showToast('success', 'Successfully logged out');
    } catch (error) {
      console.error('Logout failed:', error);
      setError('Failed to log out properly. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, showToast]);

  // Navigation handlers
  const navigateToRestore = () => setCurrentScreen('restore');
  const navigateToGenerate = () => setCurrentScreen('generate');
  const navigateToHome = () => setCurrentScreen('home');
  const clearError = () => setError(null);

  // Determine which screen to render
  const renderCurrentScreen = () => {
    if (isLoading) {
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
            onRestoreWallet={navigateToRestore}
            onCreateNewWallet={navigateToGenerate}
          />
        );

      case 'unclaimedDeposits':
        return (
          <UnclaimedDepositsPage
            onBack={() => setCurrentScreen('wallet')}
            onChanged={fetchUnclaimedDeposits}
          />
        );

      case 'settings':
        return (
          <SettingsPage 
            onBack={() => setCurrentScreen('wallet')} 
            config={config}
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
            onConnect={(mnemonic) => connectWallet(mnemonic, true)}
            onBack={navigateToHome}
            onClearError={clearError}
          />
        );

      case 'generate':
        return (
          <GeneratePage
            onMnemonicConfirmed={(mnemonic) => connectWallet(mnemonic, false)}
            onBack={navigateToHome}
            error={error}
            onClearError={clearError}
          />
        );

      case 'wallet':
        return (
          <WalletPage
            walletInfo={walletInfo}
            transactions={transactions}
            fiatRates={fiatRates}
            fiatCurrencies={fiatCurrencies}
            refreshWalletData={refreshWalletData}
            isRestoring={isRestoring}
            error={error}
            onClearError={clearError}
            onLogout={handleLogout}
            hasUnclaimedDeposits={hasUnclaimedDeposits}
            onOpenUnclaimedDeposits={() => setCurrentScreen('unclaimedDeposits')}
            onOpenSettings={() => setCurrentScreen('settings')}
            onOpenBackup={() => setCurrentScreen('backup')}
          />
        );

      default:
        return <div>Unknown screen</div>;
    }
  };

  return (
    <>
      {renderCurrentScreen()}
      {celebrationAmount !== null && (
        <PaymentReceivedCelebration
          amount={celebrationAmount}
          onClose={() => setCelebrationAmount(null)}
        />
      )}
    </>
  );
};

// Wrap the App with ToastProvider
function App() {
  return (
    <ToastProvider>
      <WalletProvider>
        <div className="h-full flex main-wrapper">
          <div id="content-root" className="h-full w-full max-w-4xl mx-auto relative">
            <AppContent />
          </div>
        </div>
      </WalletProvider>
    </ToastProvider>
  );
}

export default App;
