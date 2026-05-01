import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Rate, FiatCurrency } from '@breeztech/breez-sdk-spark';
import { useWalletConnection } from './WalletContext';
import { logger, LogCategory } from '../services/logger';

interface FiatData {
  fiatRates: Rate[];
  fiatCurrencies: FiatCurrency[];
}

interface FiatDataContextValue extends FiatData {
  /** Returns cached fiat data if available, otherwise fetches and caches it. */
  getOrFetchFiatData: () => Promise<FiatData>;
}

const FiatDataContext = createContext<FiatDataContextValue | null>(null);

export const FiatDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sdk, isConnected } = useWalletConnection();
  const [fiatRates, setFiatRates] = useState<Rate[]>([]);
  const [fiatCurrencies, setFiatCurrencies] = useState<FiatCurrency[]>([]);

  const getOrFetchFiatData = useCallback(async (): Promise<FiatData> => {
    if (fiatRates.length > 0 && fiatCurrencies.length > 0) {
      return { fiatRates, fiatCurrencies };
    }
    if (!sdk) return { fiatRates: [], fiatCurrencies: [] };
    const [ratesResult, currenciesResult] = await Promise.all([
      sdk.listFiatRates(),
      sdk.listFiatCurrencies(),
    ]);
    setFiatRates(ratesResult.rates);
    setFiatCurrencies(currenciesResult.currencies);
    return { fiatRates: ratesResult.rates, fiatCurrencies: currenciesResult.currencies };
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
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isConnected, sdk]);

  return (
    <FiatDataContext.Provider value={{ fiatRates, fiatCurrencies, getOrFetchFiatData }}>
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
