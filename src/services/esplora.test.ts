import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEsploraClient, esploraBaseUrl } from './esplora';

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const okText = (body: string) => new Response(body, { status: 200 });

describe('esploraBaseUrl', () => {
  // A developer's local indexer is configured through the environment, which
  // would otherwise stand in for every network here.
  beforeEach(() => vi.stubEnv('VITE_ESPLORA_BASE_URL', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('uses mempool.space for mainnet', () => {
    expect(esploraBaseUrl('mainnet')).toBe('https://mempool.space/api');
  });

  it('uses the testnet path for testnet', () => {
    expect(esploraBaseUrl('testnet')).toBe('https://mempool.space/testnet/api');
  });

  it("uses the local Spark environment's chain API for regtest", () => {
    expect(esploraBaseUrl('regtest')).toBe('http://127.0.0.1:8090/api');
  });
});

describe('EsploraClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('VITE_ESPLORA_BASE_URL', '');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const client = () => createEsploraClient('mainnet');

  it('maps the recommended fees onto the three choices offered', async () => {
    fetchMock.mockResolvedValue(
      okJson({ fastestFee: 20, halfHourFee: 12, hourFee: 5, economyFee: 2, minimumFee: 1 }),
    );
    await expect(client().feeRates()).resolves.toEqual({ slow: 5, medium: 12, fast: 20 });
  });

  it('never offers a fee rate below one sat per vbyte', async () => {
    fetchMock.mockResolvedValue(
      okJson({ fastestFee: 1, halfHourFee: 0, hourFee: 0, economyFee: 0, minimumFee: 0 }),
    );
    await expect(client().feeRates()).resolves.toEqual({ slow: 1, medium: 1, fast: 1 });
  });

  it('lists the spendable outputs of an address', async () => {
    fetchMock.mockResolvedValue(
      okJson([
        { txid: 'a', vout: 0, value: 50_000, status: { confirmed: true, block_height: 840_000 } },
        { txid: 'b', vout: 1, value: 10_000, status: { confirmed: false } },
      ]),
    );
    await expect(client().addressUtxos('bc1qfund')).resolves.toEqual([
      { txid: 'a', vout: 0, value: 50_000, confirmed: true, blockHeight: 840_000 },
      { txid: 'b', vout: 1, value: 10_000, confirmed: false, blockHeight: undefined },
    ]);
  });




  it('reads the current tip height', async () => {
    fetchMock.mockResolvedValue(okText('840500'));
    await expect(client().tipHeight()).resolves.toBe(840_500);
  });

  it('broadcasts a single transaction as raw hex', async () => {
    fetchMock.mockResolvedValue(okText('deadbeef'));
    await expect(client().broadcast('aabbcc')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mempool.space/api/tx');
    expect(init).toMatchObject({ method: 'POST', body: 'aabbcc' });
  });

  it('surfaces the rejection reason when a broadcast fails', async () => {
    fetchMock.mockResolvedValue(new Response('min relay fee not met', { status: 400 }));
    await expect(client().broadcast('aabbcc')).rejects.toThrow('min relay fee not met');
  });

  it.each([
    'sendrawtransaction RPC error: {"code":-27,"message":"Transaction already in block chain"}',
    'Transaction outputs already in utxo set',
    'txn-already-in-mempool',
    'txn-already-known',
  ])('treats a transaction the node already has as sent: %s', async detail => {
    fetchMock.mockResolvedValue(new Response(detail, { status: 400 }));
    await expect(client().broadcast('aabbcc')).resolves.toBeUndefined();
  });

  it('submits a parent and its child as one package', async () => {
    fetchMock.mockResolvedValue(okJson({}));
    await client().broadcastPackage('parenthex', 'childhex');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mempool.space/api/v1/txs/package');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(['parenthex', 'childhex']);
  });

  it('surfaces the rejection reason when a package is refused', async () => {
    fetchMock.mockResolvedValue(new Response('package-not-child-with-unconfirmed-parents', { status: 400 }));
    await expect(client().broadcastPackage('a', 'b')).rejects.toThrow(
      'package-not-child-with-unconfirmed-parents',
    );
  });

  it('reads a refusal the node returns inside a successful call', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        package_msg: 'transaction failed',
        'tx-results': { a: { error: 'min relay fee not met' }, b: {} },
      }),
    );
    await expect(client().broadcastPackage('a', 'b')).rejects.toThrow('min relay fee not met');
  });

  it('treats a package the node already holds as sent', async () => {
    fetchMock.mockResolvedValue(
      okJson({ package_msg: 'transaction failed', 'tx-results': { a: { error: 'txn-already-in-mempool' } } }),
    );
    await expect(client().broadcastPackage('a', 'b')).resolves.toBeUndefined();
  });

  describe('when the endpoint never answers', () => {
    const hangingFetch = () =>
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit = {}) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          }),
      );

    const impatient = () => createEsploraClient('mainnet', 20);

    it('gives up on a fee lookup rather than hanging', async () => {
      hangingFetch();
      await expect(impatient().feeRates()).rejects.toThrow();
    });


    it('gives up on a broadcast rather than hanging', async () => {
      hangingFetch();
      await expect(impatient().broadcast('aabbcc')).rejects.toThrow();
    });

    it('gives up on a package broadcast rather than hanging', async () => {
      hangingFetch();
      await expect(impatient().broadcastPackage('a', 'b')).rejects.toThrow();
    });

    it('gives up on a tip lookup rather than hanging', async () => {
      hangingFetch();
      await expect(impatient().tipHeight()).rejects.toThrow();
    });

    it('gives up on an address lookup rather than hanging', async () => {
      hangingFetch();
      await expect(impatient().addressUtxos('bc1qfund')).rejects.toThrow();
    });
  });
});
