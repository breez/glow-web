import { Config, Network, defaultConfig } from '@breeztech/breez-sdk-spark';
import { getSettings } from '../services/settings';
import { logger, LogCategory } from '../services/logger';
import { formatError } from '../utils/formatError';
import { USDB_TOKEN_IDENTIFIER, USDB_TICKER } from '../constants/stableBalance';

/**
 * Build a Breez SDK Config from environment and persisted user settings.
 * Pure function — no side effects beyond reading env vars and localStorage.
 */
export function buildConnectConfig(overrideNetwork?: Network): Config {
  const breezApiKey = import.meta.env.VITE_BREEZ_API_KEY;
  if (!breezApiKey) {
    throw new Error('Breez API key not found. Create a .env file with VITE_BREEZ_API_KEY=your_key');
  }

  const urlParams = new URLSearchParams(window.location.search);
  const network = (overrideNetwork ?? (urlParams.get('network') ?? 'mainnet')) as Network;
  const config: Config = defaultConfig(network);
  config.apiKey = breezApiKey;
  config.privateEnabledDefault = false;
  config.stableBalanceConfig = {
    tokens: [{ label: USDB_TICKER, tokenIdentifier: USDB_TOKEN_IDENTIFIER }],
  };

  // Apply persisted user settings to config
  try {
    const s = getSettings();
    if (s.crossChainEnabled) {
      config.crossChainConfig = {};
    }
    if (s.depositMaxFee) {
      config.maxDepositClaimFee = s.depositMaxFee;
    }
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
    logger.warn(LogCategory.SDK, 'Failed to apply user settings to config', {
      error: formatError(e),
    });
  }

  return config;
}
