import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Config, GetInfoResponse, Network, Payment, SdkEvent, defaultConfig, Rate, FiatCurrency, DepositInfo } from '@breeztech/breez-sdk-spark';
import { WalletProvider, useWallet } from './contexts/WalletContext';
import LoadingSpinner from './components/LoadingSpinner';
import PaymentReceivedCelebration from './components/PaymentReceivedCelebration';
import NotificationPrompt from './components/NotificationPrompt';
import InstallPrompt from './components/InstallPrompt';
import StagingGate from './components/StagingGate';
import { ToastProvider, useToast } from './contexts/ToastContext';
import AppShell from './components/layout/AppShell';
import { hideSplash } from './main';

import HomePage from './pages/HomePage';
import WalletPage from './pages/WalletPage';
import RestorePage from './pages/RestorePage';
import GeneratePage from './pages/GeneratePage';
import GetRefundPage from './pages/GetRefundPage';
import BackupPage from './pages/BackupPage';
import SettingsPage from './pages/SettingsPage';
import FiatCurrenciesPage from './pages/FiatCurrenciesPage';

import { getSettings } from './services/settings';
import { isDepositRejected } from './services/depositState';
import {
  showPaymentReceivedNotification,
  showDepositClaimedNotification,
} from './services/notificationService';
import { useIOSViewportFix } from './hooks/useIOSViewportFix';

// Main App without toast functionality
const AppContent: React.FC = () => {
  // Screen navigation state
  const [currentScreen, setCurrentScreen] = useState<'home' | 'restore' | 'generate' | 'wallet' | 'getRefund' | 'settings' | 'backup' | 'fiatCurrencies'>('home');

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);

  // Track if this is the initial app load (splash screen handles this)
  const isInitialLoadRef = useRef<boolean>(true);
  const [walletInfo, setWalletInfo] = useState<GetInfoResponse | null>(null);
  const [transactions, setTransactions] = useState<Payment[]>([]);
  const [unclaimedDeposits, setUnclaimedDeposits] = useState<DepositInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fiatRates, setFiatRates] = useState<Rate[]>([]);
  const [fiatCurrencies, setFiatCurrencies] = useState<FiatCurrency[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [hasUnclaimedDeposits, setHasUnclaimedDeposits] = useState<boolean>(false);
  const [celebrationAmount, setCelebrationAmount] = useState<number | null>(null);
  const [refundAnimationDirection, setRefundAnimationDirection] = useState<'left' | 'up'>('left');

  const { showToast } = useToast();

  // Fix iOS Safari viewport bug where gap appears after keyboard dismisses
  useIOSViewportFix();

  useEffect(() => {
    const lnurlEnabled = config?.lnurlDomain ? 'true' : 'false';
    document.body.setAttribute('data-lnurl-enabled', lnurlEnabled);
    return () => {
      document.body.setAttribute('data-lnurl-enabled', 'false');
    };
  }, [config?.lnurlDomain]);

  // Add a ref to store the event listener ID
  const eventListenerIdRef = useRef<string | null>(null);

  // Track recently shown payment celebrations to avoid duplicates
  const shownPaymentIdsRef = useRef<Set<string>>(new Set());

  // Ref to access currentScreen in callbacks without causing re-renders (advanced-event-handler-refs optimization)
  const currentScreenRef = useRef(currentScreen);
  currentScreenRef.current = currentScreen;

  // Function to refresh wallet data (usable via a callback)
  const wallet = useWallet();

  const refreshWalletData = useCallback(async (showLoading: boolean = true) => {
    if (!isConnected) return;

    try {
      if (showLoading) {
        setIsLoading(true);
      }

      // Fetch wallet info and transactions in parallel (async-parallel optimization)
      const [info, txns] = await Promise.all([
        wallet.getWalletInfo(),
        wallet.getTransactions(),
      ]);

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
  // Warning icon should only show for REJECTED deposits
  const fetchUnclaimedDeposits = useCallback(async () => {
    try {
      const deposits = await wallet.unclaimedDeposits();
      setUnclaimedDeposits(deposits);
      // Check if any of the unclaimed deposits have been rejected
      const hasRejected = deposits.some(d => isDepositRejected(d.txid, d.vout));
      setHasUnclaimedDeposits(hasRejected);
    } catch (e) {
      console.warn('Failed to fetch unclaimed deposits:', e);
      setUnclaimedDeposits([]);
      setHasUnclaimedDeposits(false);
    }
  }, [wallet]);


  // SDK event handler with toast notifications and auto-close of receive dialog
  const handleSdkEvent = useCallback((event: SdkEvent) => {
    console.log('SDK event received:', event);

    if (event.type === 'synced') {
      console.log('Synced event received, refreshing data...');

      // If this is the first sync event after connecting, mark restoration as complete
      if (isRestoring) {
        console.log('Restoration sync complete. Hiding overlay.');
        setIsRestoring(false);
      }

      // Set sync indicator for e2e tests
      document.body.setAttribute('data-wallet-synced', 'true');

      // Don't show loading indicator for automatic refresh
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    } else if (event.type === 'paymentSucceeded') {
      console.log('Payment succeeded event received');
      const paymentId = event.payment.id;

      // Deduplicate: only show notification if we haven't shown it for this payment
      if (!shownPaymentIdsRef.current.has(paymentId)) {
        shownPaymentIdsRef.current.add(paymentId);
        // Clean up old IDs after 30 seconds to prevent memory growth
        setTimeout(() => shownPaymentIdsRef.current.delete(paymentId), 30000);

        const isReceived = event.payment.paymentType === 'receive';
        const amountSats = Number(event.payment.amount);

        if (isReceived) {
          // Show celebration animation for received payments
          setCelebrationAmount(amountSats);
          // Also show push notification (will only show if app is in background)
          showPaymentReceivedNotification(amountSats);
        } else {
          // Show toast for sent payments
          showToast(
            'success',
            'Payment Sent',
            `${event.payment.amount} sats sent successfully`
          );
        }
      }
      refreshWalletData(false);
    } else if (event.type === 'claimedDeposits') {
      console.log('Claim deposits succeeded event received');
      // Use ref to check screen without adding to dependencies
      if (currentScreenRef.current !== 'getRefund') {
        showToast(
          'success',
          'Deposits Claimed Successfully',
          `${event.claimedDeposits.length} deposits were claimed`
        );
      }
      // Show push notification for claimed deposits
      showDepositClaimedNotification(event.claimedDeposits.length);
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    } else if (event.type === 'unclaimedDeposits') {
      console.log('Claim deposits failed event received');
      // Use ref to check screen without adding to dependencies
      if (currentScreenRef.current !== 'getRefund') {
        showToast(
          'error',
          'Failed to Claim Deposits',
          `${event.unclaimedDeposits.length} deposits could not be claimed`
        );
      }
      // Refresh the list as some may remain unclaimed
      fetchUnclaimedDeposits();
    }
  }, [refreshWalletData, showToast, isRestoring, fetchUnclaimedDeposits]);

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
    // Initialize log session for persistent logging
    wallet.initLogSession().catch((e) => {
      console.warn('Failed to initialize log session:', e);
    });

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

      // Initial load complete - hide splash and mark as done
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        hideSplash();
      }
    };

    checkForExistingWallet();

    // No cleanup here; logout handles disconnect explicitly
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initialization
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
      console.log(`Starting wallet connection (restore: ${restore})...`);
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

      // Get wallet info and transactions in parallel (async-parallel optimization)
      const [info, txns] = await Promise.all([
        wallet.getWalletInfo(),
        wallet.getTransactions(),
      ]);

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
      setConfig(null);
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

      // End log session before clearing data
      await wallet.endLogSession();

      // Clear the stored mnemonic
      wallet.clearMnemonic();

      // Reset state
      setIsConnected(false);
      setWalletInfo(null);
      setTransactions([]);
      setConfig(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wallet excluded to avoid re-creating on every render
  }, [isConnected, showToast]);

  // Navigation handlers
  const navigateToRestore = () => setCurrentScreen('restore');
  const navigateToGenerate = () => setCurrentScreen('generate');
  const navigateToHome = () => setCurrentScreen('home');
  const clearError = () => setError(null);

  // Determine which screen to render
  const renderCurrentScreen = () => {
    // During initial load, splash screen handles the loading state
    // Don't show React LoadingSpinner to avoid double-spinner
    if (isLoading && isInitialLoadRef.current) {
      return null;
    }

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
            unclaimedDeposits={unclaimedDeposits}
            fiatRates={fiatRates}
            fiatCurrencies={fiatCurrencies}
            refreshWalletData={refreshWalletData}
            isRestoring={isRestoring}
            error={error}
            onClearError={clearError}
            onLogout={handleLogout}
            hasUnclaimedDeposits={hasUnclaimedDeposits}
            onOpenGetRefund={(source?: 'menu' | 'icon') => {
              setRefundAnimationDirection(source === 'icon' ? 'up' : 'left');
              setCurrentScreen('getRefund');
            }}
            onOpenSettings={() => setCurrentScreen('settings')}
            onOpenBackup={() => setCurrentScreen('backup')}
            onDepositChanged={fetchUnclaimedDeposits}
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
      {/* Show notification prompt after wallet is connected */}
      {isConnected && <NotificationPrompt />}
      {/* Show install prompt for PWA installation */}
      <InstallPrompt />
    </>
  );
};

// Wrap the App with ToastProvider and StagingGate
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
