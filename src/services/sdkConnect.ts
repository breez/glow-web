import {
  Config,
  Network,
  SdkBuilder,
  SparkConfig,
  connect,
  defaultConfig,
  type BreezSdk,
  type Seed,
} from '@breeztech/breez-sdk-spark';
import { getSettings } from './settings';
import { logger, LogCategory } from './logger';
import { formatError } from '../utils/formatError';
import { USDB_TOKEN_IDENTIFIER, USDB_TICKER } from '../constants/stableBalance';

function localCluster(): SparkConfig | null {
  const raw = import.meta.env.VITE_SPARK_LOCAL_CONFIG;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SparkConfig;
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Ignoring unparseable local cluster config', {
      error: formatError(e),
    });
    return null;
  }
}

/**
 * Points the config at a locally-run cluster when one is configured, and
 * reports whether it took over. A local cluster runs no Breez services, so the
 * hosted endpoints have to be cleared or connect fails reaching them. Leaf
 * optimization is turned off so leaves are not split or merged behind a test's
 * back.
 */
function applyLocalCluster(config: Config, network: Network): boolean {
  const cluster = network === 'regtest' ? localCluster() : null;
  if (!cluster) return false;
  config.sparkConfig = cluster;
  config.apiKey = undefined;
  config.lnurlDomain = undefined;
  config.realTimeSyncServerUrl = undefined;
  config.leafOptimizationConfig.autoEnabled = false;
  return true;
}

/** The network this session connects on. Settings switches it by reloading with
 *  the parameter set, so the URL is what the SDK is connected to. */
export function selectedNetwork(): Network {
  return (new URLSearchParams(window.location.search).get('network') ?? 'mainnet') as Network;
}

/**
 * Build a Breez SDK Config from environment and persisted user settings.
 * Pure function — no side effects beyond reading env vars and localStorage.
 */
export function buildConnectConfig(overrideNetwork?: Network): Config {
  const network = overrideNetwork ?? selectedNetwork();
  const config: Config = defaultConfig(network);
  config.apiKey = import.meta.env.VITE_BREEZ_API_KEY;

  if (!applyLocalCluster(config, network) && !config.apiKey) {
    throw new Error('Breez API key not found. Create a .env file with VITE_BREEZ_API_KEY=your_key');
  }

  config.stableBalanceConfig = {
    tokens: [{ label: USDB_TICKER, tokenIdentifier: USDB_TOKEN_IDENTIFIER }],
  };
  // Cross-chain sends are mainnet-only: the SDK rejects the config on any
  // other network at connect time, which aborts the whole connection.
  if (network === 'mainnet') {
    config.crossChainConfig = {};
  }

  try {
    const s = getSettings();
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

/**
 * Connects a wallet. A config built for a local cluster is pointed at that
 * cluster's own indexer, since the hosted one knows nothing about its chain.
 */
export async function connectSdk(params: {
  config: Config;
  seed: Seed;
  storageDir: string;
}): Promise<BreezSdk> {
  const { config, seed, storageDir } = params;
  const chainApiUrl = import.meta.env.VITE_ESPLORA_BASE_URL;
  if (chainApiUrl && config.apiKey == null && config.sparkConfig) {
    const builder = SdkBuilder.new(config, seed).withRestChainService(chainApiUrl, 'esplora');
    return (await builder.withDefaultStorage(storageDir)).build();
  }
  return connect({ config, seed, storageDir });
}
