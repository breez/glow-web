import {
  Config,
  Network,
  SdkBuilder,
  connect,
  defaultConfig,
  parseSparkConfig,
  type BreezSdk,
  type Seed,
} from '@breeztech/breez-sdk-spark';
import { getSettings } from './settings';
import { esploraBaseUrl } from './esplora';
import { logger, LogCategory } from './logger';
import { formatError } from '../utils/formatError';
import { USDB_TOKEN_IDENTIFIER, USDB_TICKER } from '../constants/stableBalance';

/**
 * The spark-config.json of the local Spark environment (the spark-sdk's
 * regtest/local/) that regtest runs on, when the dev server was given one.
 */
function localEnvironmentConfig(network: Network): string | null {
  return network === 'regtest' ? __SPARK_CONFIG__ : null;
}

/**
 * Points a regtest config at the local Spark environment, and reports whether
 * it took over. The environment serves its own LNURL and data-sync services at
 * their default ports, and takes no API key.
 */
function applyLocalEnvironment(config: Config, network: Network): boolean {
  const sparkConfig = localEnvironmentConfig(network);
  if (!sparkConfig) return false;
  config.sparkConfig = parseSparkConfig(sparkConfig);
  config.apiKey = undefined;
  config.lnurlDomain = 'http://127.0.0.1:8080';
  // The JS SDK reaches the data-sync service over gRPC-Web.
  config.realTimeSyncServerUrl = 'http://127.0.0.1:8082';
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

  if (!applyLocalEnvironment(config, network) && !config.apiKey) {
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
 * Connects a wallet. A config built for the local environment is pointed at
 * the environment's own chain API, since the hosted one knows nothing about
 * its chain.
 */
export async function connectSdk(params: {
  config: Config;
  seed: Seed;
  storageDir: string;
}): Promise<BreezSdk> {
  const { config, seed, storageDir } = params;
  if (localEnvironmentConfig(config.network)) {
    const builder = SdkBuilder.new(config, seed).withRestChainService(
      esploraBaseUrl(config.network),
      'mempoolSpace',
    );
    return (await builder.withDefaultStorage(storageDir)).build();
  }
  return connect({ config, seed, storageDir });
}
