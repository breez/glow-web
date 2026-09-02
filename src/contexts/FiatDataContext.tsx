import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Rate, FiatCurrency } from '@breeztech/breez-sdk-spark';
import { useWalletConnection } from './WalletContext';
import { logger, LogCategory } from '../services/logger';

interface FiatData {
  fiatRates: Rate[];
  fiatCurrencies: FiatCurrency[];
}

interface FiatDataContextValue extends FiatData {
  /**
   * Fetch the current rates and publish them, for a caller that prices
   * something and can't ride the 60s refresh. Falls back to the last known
   * values on failure, so a blip degrades the price instead of the flow.
   */
  refreshFiatData: () => Promise<FiatData>;
}

const FiatDataContext = createContext<FiatDataContextValue | null>(null);

export const FiatDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sdk, isConnected } = useWalletConnection();
  const [fiatRates, setFiatRates] = useState<Rate[]>([]);
  const [fiatCurrencies, setFiatCurrencies] = useState<FiatCurrency[]>([]);

  const refreshFiatData = useCallback(async (): Promise<FiatData> => {
    const known = { fiatRates, fiatCurrencies };
    if (!sdk) return known;
    try {
      const [ratesResult, currenciesResult] = await Promise.all([
        sdk.listFiatRates(),
        sdk.listFiatCurrencies(),
      ]);
      setFiatRates(ratesResult.rates);
      setFiatCurrencies(currenciesResult.currencies);
      return { fiatRates: ratesResult.rates, fiatCurrencies: currenciesResult.currencies };
    } catch (error) {
      logger.warn(LogCategory.SDK, 'Failed to refresh fiat data', {
        error: error instanceof Error ? error.message : String(error),
      });
      return known;
    }
  }, [sdk, fiatRates, fiatCurrencies]);

  useEffect(() => {
    if (!isConnected || !sdk) return;
    let cancelled = false;
    const fetchFiatData = async () => {
      try {
        const [ratesResult, currenciesResult] = await Promise.all([
          sdk.listFiatRates(),
          sdk.listFiatCurrencies(),
        ]);
        if (cancelled) return;
        setFiatRates(ratesResult.rates);
        setFiatCurrencies(currenciesResult.currencies);
        logger.info(LogCategory.SDK, 'Fiat data fetched', {
          ratesCount: ratesResult.rates.length,
          currenciesCount: currenciesResult.currencies.length,
        });
      } catch (error) {
        logger.warn(LogCategory.SDK, 'Failed to fetch fiat data', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    void fetchFiatData();
    const interval = setInterval(() => { void fetchFiatData(); }, 60000);

    // A backgrounded WebView freezes the interval, and an iOS standalone PWA
    // resumes a days-old page instead of reloading, so rates would otherwise
    // sit at whatever they were when the app last had the foreground until a
    // relaunch. Mirrors the events `useBreezSdk` resyncs the wallet on.
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    const refetchOnResume = () => {
      if (document.visibilityState !== 'visible') return;
      // Drop any pending one: a hide/show cycle leaves a timer per event
      // otherwise, and they all fire together once the page is back.
      clearTimeout(resumeTimer);
      // iOS 18+ WebKit fails a request started directly on visibilitychange
      // ("TypeError: Load failed"), so wait the same 1.5s the resync does.
      resumeTimer = setTimeout(() => {
        if (document.visibilityState === 'visible') void fetchFiatData();
      }, 1500);
    };
    document.addEventListener('visibilitychange', refetchOnResume);
    // pageshow catches bfcache restores, which skip visibilitychange.
    window.addEventListener('pageshow', refetchOnResume);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(resumeTimer);
      document.removeEventListener('visibilitychange', refetchOnResume);
      window.removeEventListener('pageshow', refetchOnResume);
    };
  }, [isConnected, sdk]);

  return (
    <FiatDataContext.Provider value={{ fiatRates, fiatCurrencies, refreshFiatData }}>
      {children}
    </FiatDataContext.Provider>
  );
};

export const useFiatData = (): FiatDataContextValue => {
  const ctx = useContext(FiatDataContext);
  if (!ctx) {
    throw new Error('useFiatData must be used within a FiatDataProvider');
  }
  return ctx;
};
