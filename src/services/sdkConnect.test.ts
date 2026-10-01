import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Seed } from '@breeztech/breez-sdk-spark';
import { buildConnectConfig, connectSdk } from './sdkConnect';

const sdk = vi.hoisted(() => ({
  connect: vi.fn(async () => 'hosted-sdk'),
  withRestChainService: vi.fn(),
}));

vi.mock('@breeztech/breez-sdk-spark', async importOriginal => {
  const actual = await importOriginal<typeof import('@breeztech/breez-sdk-spark')>();
  return {
    ...actual,
    connect: sdk.connect,
    SdkBuilder: {
      new: () => ({
        withRestChainService: (url: string, apiType: string) => {
          sdk.withRestChainService(url, apiType);
          return { withDefaultStorage: async () => ({ build: async () => 'local-sdk' }) };
        },
      }),
    },
  };
});

// The shape of the spark-config.json a local Spark environment writes.
const ENVIRONMENT_CONFIG = JSON.stringify({
  coordinator_identifier: '0000000000000000000000000000000000000000000000000000000000000001',
  threshold: 2,
  signing_operators: [
    {
      id: 0,
      identifier: '0000000000000000000000000000000000000000000000000000000000000001',
      address: 'http://127.0.0.1:8535',
      identity_public_key: '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f',
    },
  ],
  ssp_config: {
    base_url: 'http://127.0.0.1:59049',
    identity_public_key: '03e7343c4fdcffdce7b0041c4f482948a1058f8fe8d5a48e0a0c4e884d0e7cc124',
    schema_endpoint: 'graphql/spark/rc',
  },
  expected_withdraw_bond_sats: 10000,
  expected_withdraw_relative_block_locktime: 1000,
});

const seed: Seed = { type: 'mnemonic', mnemonic: 'abandon '.repeat(11) + 'about' };

describe('on a local Spark environment', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BREEZ_API_KEY', 'test-key');
    vi.stubEnv('VITE_ESPLORA_BASE_URL', '');
    vi.stubGlobal('__SPARK_CONFIG__', ENVIRONMENT_CONFIG);
    sdk.connect.mockClear();
    sdk.withRestChainService.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("connects regtest to the environment's operators and SSP", () => {
    const config = buildConnectConfig('regtest');
    expect(config.sparkConfig?.signingOperators[0].address).toBe('http://127.0.0.1:8535');
    expect(config.sparkConfig?.sspConfig.baseUrl).toBe('http://127.0.0.1:59049');
  });

  it("uses the environment's own services and no API key", () => {
    const config = buildConnectConfig('regtest');
    expect(config.lnurlDomain).toBe('http://127.0.0.1:8080');
    expect(config.realTimeSyncServerUrl).toBe('http://127.0.0.1:8082');
    expect(config.apiKey).toBeUndefined();
  });

  it("reads regtest's chain from the environment's chain API", async () => {
    await expect(
      connectSdk({ config: buildConnectConfig('regtest'), seed, storageDir: 'test' }),
    ).resolves.toBe('local-sdk');
    expect(sdk.withRestChainService).toHaveBeenCalledWith('http://127.0.0.1:8090/api', 'mempoolSpace');
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it('leaves mainnet on the hosted network', async () => {
    const config = buildConnectConfig('mainnet');
    expect(config.apiKey).toBe('test-key');
    expect(config.sparkConfig?.sspConfig.baseUrl).not.toBe('http://127.0.0.1:59049');

    await expect(connectSdk({ config, seed, storageDir: 'test' })).resolves.toBe('hosted-sdk');
    expect(sdk.withRestChainService).not.toHaveBeenCalled();
  });
});
