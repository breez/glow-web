import React, { createContext, useContext, useCallback, useState, useMemo } from 'react';

/**
 * Navigation context to reduce prop drilling for screen navigation.
 * Provides centralized navigation state and callbacks.
 */

export type Screen =
  | 'home'
  | 'restore'
  | 'generate'
  | 'wallet'
  | 'getRefund'
  | 'settings'
  | 'backup'
  | 'fiatCurrencies';

export interface NavigationContextValue {
  currentScreen: Screen;
  navigate: (screen: Screen) => void;
  goBack: () => void;

  // Convenience navigation methods
  navigateToWallet: () => void;
  navigateToSettings: () => void;
  navigateToBackup: () => void;
  navigateToGetRefund: (source?: 'menu' | 'icon') => void;
  navigateToFiatCurrencies: () => void;
  navigateToHome: () => void;
  navigateToRestore: () => void;
  navigateToGenerate: () => void;

  // For GetRefund animation direction
  refundAnimationDirection: 'horizontal' | 'vertical';
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

// Screen hierarchy for back navigation
const screenHierarchy: Record<Screen, Screen | null> = {
  home: null,
  restore: 'home',
  generate: 'home',
  wallet: null, // Can't go back from wallet
  getRefund: 'wallet',
  settings: 'wallet',
  backup: 'wallet',
  fiatCurrencies: 'settings',
};

export interface NavigationProviderProps {
  children: React.ReactNode;
  initialScreen?: Screen;
  onScreenChange?: (screen: Screen) => void;
}

export const NavigationProvider: React.FC<NavigationProviderProps> = ({
  children,
  initialScreen = 'home',
  onScreenChange,
}) => {
  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen);
  const [refundAnimationDirection, setRefundAnimationDirection] = useState<'horizontal' | 'vertical'>('horizontal');

  const navigate = useCallback((screen: Screen) => {
    setCurrentScreen(screen);
    onScreenChange?.(screen);
  }, [onScreenChange]);

  const goBack = useCallback(() => {
    const parentScreen = screenHierarchy[currentScreen];
    if (parentScreen) {
      setCurrentScreen(parentScreen);
      onScreenChange?.(parentScreen);
    }
  }, [currentScreen, onScreenChange]);

  // Convenience methods
  const navigateToWallet = useCallback(() => navigate('wallet'), [navigate]);
  const navigateToSettings = useCallback(() => navigate('settings'), [navigate]);
  const navigateToBackup = useCallback(() => navigate('backup'), [navigate]);
  const navigateToFiatCurrencies = useCallback(() => navigate('fiatCurrencies'), [navigate]);
  const navigateToHome = useCallback(() => navigate('home'), [navigate]);
  const navigateToRestore = useCallback(() => navigate('restore'), [navigate]);
  const navigateToGenerate = useCallback(() => navigate('generate'), [navigate]);

  const navigateToGetRefund = useCallback((source?: 'menu' | 'icon') => {
    setRefundAnimationDirection(source === 'icon' ? 'vertical' : 'horizontal');
    navigate('getRefund');
  }, [navigate]);

  const value = useMemo<NavigationContextValue>(() => ({
    currentScreen,
    navigate,
    goBack,
    navigateToWallet,
    navigateToSettings,
    navigateToBackup,
    navigateToGetRefund,
    navigateToFiatCurrencies,
    navigateToHome,
    navigateToRestore,
    navigateToGenerate,
    refundAnimationDirection,
  }), [
    currentScreen,
    navigate,
    goBack,
    navigateToWallet,
    navigateToSettings,
    navigateToBackup,
    navigateToGetRefund,
    navigateToFiatCurrencies,
    navigateToHome,
    navigateToRestore,
    navigateToGenerate,
    refundAnimationDirection,
  ]);

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
};

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}

export default NavigationContext;
