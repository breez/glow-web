import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { useWalletConnection } from './WalletContext';
import { useFiatData } from './FiatDataContext';
import { USDB_TOKEN_IDENTIFIER, USDB_TICKER } from '../constants/stableBalance';
import {
  type TokenDisplayConfig,
  buildTokenDisplayConfig,
  formatTokenAmount,
  getTokenAmountFromPayment,
} from '../utils/tokenFormatting';
import { logger, LogCategory } from '../services/logger';
import { getCachedStableTicker, setCachedStableTicker } from '../services/settings';
import { formatWithSpaces } from '@/utils/formatNumber';

interface StableBalanceContextValue {
  isActive: boolean;
  activeLabel: string | null;
  tokenIdentifier: string | null;
  displayConfig: TokenDisplayConfig | null;
  btcFiatRate: number;
  formatPaymentAmount: (payment: Payment) => string;
  toggleStableBalance: (label: string | null) => Promise<void>;
  isToggling: boolean;
}

const StableBalanceContext = createContext<StableBalanceContextValue | null>(null);

interface StableBalanceProviderProps {
  children: React.ReactNode;
}

export const StableBalanceProvider: React.FC<StableBalanceProviderProps> = ({ children }) => {
  const { sdk, isConnected } = useWalletConnection();
  const { fiatRates, fiatCurrencies } = useFiatData();
  const [activeLabel, setActiveLabel] = useState<string | null>(() => getCachedStableTicker());
  // Underlying value; the consumer-facing `displayConfig` below gates on
  // connection status, so external callers see null when disconnected.
  const [rawDisplayConfig, setDisplayConfig] = useState<TokenDisplayConfig | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  // Derive tokenIdentifier from activeLabel
  const tokenIdentifier = useMemo(() => {
    if (!activeLabel) return null;
    if (activeLabel === USDB_TICKER) return USDB_TOKEN_IDENTIFIER;
    return null;
  }, [activeLabel]);

  // Load active label from SDK on connect. activeLabel is cache-seeded
  // so the UI shows the correct mode instantly on reload; the SDK read
  // here corrects any drift.
  useEffect(() => {
    if (!isConnected || !sdk) return;

    let cancelled = false;

    (async () => {
      try {
        const settings = await sdk.getUserSettings();
        if (cancelled) return;
        const label = settings.stableBalanceActiveLabel ?? null;
        setActiveLabel(label);
        setCachedStableTicker(label);
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Failed to load user settings for stable balance', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => { cancelled = true; };
  }, [isConnected, sdk]);

  const displayConfig = isConnected && sdk ? rawDisplayConfig : null;

  // Fetch token metadata and build display config (re-runs when fiat currencies load for better symbol matching)
  useEffect(() => {
    if (!tokenIdentifier || !sdk) return;

    let cancelled = false;

    (async () => {
      try {
        const result = await sdk.getTokensMetadata({ tokenIdentifiers: [tokenIdentifier] });
        if (cancelled) return;

        const metadata = result.tokensMetadata[0];
        if (metadata) {
          const config = buildTokenDisplayConfig(metadata, fiatCurrencies);
          setDisplayConfig(config);
          logger.info(LogCategory.SDK, 'Stable balance display config built', {
            symbol: config.symbol,
            decimals: config.decimals,
            fractionSize: config.fractionSize,
          });
        }
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Failed to fetch token metadata for stable balance', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => { cancelled = true; };
  }, [tokenIdentifier, fiatCurrencies, sdk]);

  // Extract BTC rate for the matched fiat currency
  const btcFiatRate = displayConfig?.fiatCurrencyId
    ? (fiatRates.find(r => r.coin === displayConfig.fiatCurrencyId)?.value ?? 0)
    : 0;

  const isActive = !!activeLabel && !!tokenIdentifier && !!displayConfig;

  // Toggle stable balance via SDK user settings
  const toggleStableBalance = useCallback(async (label: string | null) => {
    if (!sdk) return;
    setIsToggling(true);
    try {
      if (label) {
        await sdk.updateUserSettings({
          stableBalanceActiveLabel: { type: 'set', label },
        });
        setActiveLabel(label);
        setCachedStableTicker(label);
      } else {
        await sdk.updateUserSettings({
          stableBalanceActiveLabel: { type: 'unset' },
        });
        setActiveLabel(null);
        setCachedStableTicker(null);
      }
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to toggle stable balance', {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsToggling(false);
    }
  }, [sdk]);

  const formatPaymentAmount = useCallback(
    (payment: Payment): string => {
      // When the conversion amount was adjusted (min limit floor or dust prevention),
      // the token amount doesn't match the payment — show sats instead
      if (payment.conversionDetails?.conversions?.some(c => c.amountAdjustment)) {
        return `₿${formatWithSpaces(Number(payment.amount))}`;
      }

      const tokenInfo = getTokenAmountFromPayment(payment);

      if (displayConfig && tokenInfo) {
        return formatTokenAmount(tokenInfo.amount, displayConfig);
      }

      if (tokenInfo) {
        const config = buildTokenDisplayConfig(tokenInfo.metadata, fiatCurrencies);
        return formatTokenAmount(tokenInfo.amount, config);
      }

      return `₿${formatWithSpaces(Number(payment.amount))}`;
    },
    [displayConfig, fiatCurrencies]
  );

  const value = useMemo<StableBalanceContextValue>(
    () => ({
      isActive,
      activeLabel,
      tokenIdentifier,
      displayConfig,
      btcFiatRate,
      formatPaymentAmount,
      toggleStableBalance,
      isToggling,
    }),
    [isActive, activeLabel, tokenIdentifier, displayConfig, btcFiatRate, formatPaymentAmount, toggleStableBalance, isToggling]
  );

  return (
    <StableBalanceContext.Provider value={value}>
      {children}
    </StableBalanceContext.Provider>
  );
};

export const useStableBalance = (): StableBalanceContextValue => {
  const ctx = useContext(StableBalanceContext);
  if (!ctx) {
    throw new Error('useStableBalance must be used within a StableBalanceProvider');
  }
  return ctx;
};
