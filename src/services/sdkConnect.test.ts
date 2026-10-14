import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USDB_TICKER, USDB_TOKEN_IDENTIFIER } from '../constants/stableBalance';
import { buildConnectConfig } from './sdkConnect';

describe('buildConnectConfig', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BREEZ_API_KEY', 'test-key');
    vi.stubEnv('VITE_SPARK_LOCAL_CONFIG', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets the stable balance token and cross-chain sends on mainnet', () => {
    const config = buildConnectConfig('mainnet');
    expect(config.stableBalanceConfig?.tokens).toEqual([{ label: USDB_TICKER, tokenIdentifier: USDB_TOKEN_IDENTIFIER }]);
    expect(config.crossChainConfig).toBeDefined();
  });

  it('leaves both out on regtest, where the SDK refuses them at connect', () => {
    const config = buildConnectConfig('regtest');
    expect(config.stableBalanceConfig).toBeUndefined();
    expect(config.crossChainConfig).toBeUndefined();
  });
});
