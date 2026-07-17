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
import { getCachedStableTicker, setCachedStableTicker, getNativeStableTicker, setNativeStableTicker } from '../services/settings';
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

export interface StableLabelResolution {
  /** The label to display, or null for BTC mode. */
  activeLabel: string | null;
  /** True when the label came from the native backup and must be re-applied to the SDK. */
  recoverToSdk: boolean;
}

/**
 * Reconcile the SDK's active-label read with the durable native backup.
 *
 * The SDK wins when it has a value. When it reports null but the native backup
 * still holds a label, the SDK's local store was wiped (app upgrade / cleared
 * WebView data) — recover by re-applying that label to the SDK rather than
 * treating the null as an intentional deactivation.
 */
export function resolveStableLabel(
  sdkLabel: string | null,
  nativeLabel: string | null
): StableLabelResolution {
  if (sdkLabel) return { activeLabel: sdkLabel, recoverToSdk: false };
  if (nativeLabel) return { activeLabel: nativeLabel, recoverToSdk: true };
  return { activeLabel: null, recoverToSdk: false };
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

  // Resolve the active label on connect. activeLabel is localStorage-seeded so
  // the UI shows the correct mode instantly on reload; this read reconciles it
  // against the SDK and the durable native backup.
  //
  // The SDK stores the label in its local IndexedDB, which shares the WebView
  // storage partition with the localStorage cache — an app upgrade / cleared
  // WebView data wipes both, and the SDK then reports inactive. So a null from
  // the SDK is not authoritative on its own: if the native backup (which
  // survives that wipe) still holds a label, the SDK's store was reset and we
  // recover by re-applying the label to it, rather than clobbering the backup.
  useEffect(() => {
    if (!isConnected || !sdk) return;

    let cancelled = false;

    (async () => {
      try {
        const settings = await sdk.getUserSettings();
        if (cancelled) return;
        const sdkLabel = settings.stableBalanceActiveLabel ?? null;
        // Only read the native backup when the SDK has nothing — the SDK wins
        // whenever it has a value, so there's no need to touch Preferences.
        const nativeLabel = sdkLabel ? null : await getNativeStableTicker();
        if (cancelled) return;

        const { activeLabel: resolved, recoverToSdk } = resolveStableLabel(sdkLabel, nativeLabel);

        if (recoverToSdk && resolved) {
          logger.info(LogCategory.SDK, 'Recovering stable balance from native backup after empty SDK settings', {
            label: resolved,
          });
          try {
            await sdk.updateUserSettings({ stableBalanceActiveLabel: { type: 'set', label: resolved } });
          } catch (e) {
            // The SDK rejects a label that isn't in its configured token list.
            // Stay inactive rather than display a mode the SDK isn't actually
            // in — the same rule the SDK applies to an unknown cached label.
            // The native backup is deliberately left alone: a label that's
            // invalid under this build may be valid again under the next, and
            // clearing it here would destroy the setting for good.
            logger.error(LogCategory.SDK, 'Failed to re-apply stable balance label to SDK', {
              error: e instanceof Error ? e.message : String(e),
            });
            if (cancelled) return;
            setActiveLabel(null);
            setCachedStableTicker(null);
            return;
          }
          if (cancelled) return;
        }

        setActiveLabel(resolved);
        setCachedStableTicker(resolved);
        // Backfill the durable native backup from the SDK's value (covers
        // installs that predate native persistence). Never write it from a
        // null SDK read — that would clobber a backup we may need to recover.
        if (sdkLabel) await setNativeStableTicker(sdkLabel);
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
        await setNativeStableTicker(label);
      } else {
        await sdk.updateUserSettings({
          stableBalanceActiveLabel: { type: 'unset' },
        });
        setActiveLabel(null);
        setCachedStableTicker(null);
        await setNativeStableTicker(null);
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
