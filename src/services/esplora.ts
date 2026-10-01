import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type ChainClient,
  type ChainUtxo,
} from './chain';

const trim = (url: string): string => url.replace(/\/$/, '');

export function esploraBaseUrl(network: string): string {
  const override = import.meta.env?.VITE_ESPLORA_BASE_URL;
  if (override) return trim(override);

  switch (network) {
    case 'testnet':
      return 'https://mempool.space/testnet/api';
    case 'regtest':
      // The local Spark environment's chain API.
      return 'http://127.0.0.1:8090/api';
    default:
      return 'https://mempool.space/api';
  }
}

const atLeastOne = (rate: number | undefined): number => Math.max(1, Math.round(rate ?? 1));

async function failure(response: Response, action: string): Promise<Error> {
  const detail = (await response.text().catch(() => '')).trim();
  return new Error(detail || `${action} failed with status ${response.status}`);
}

// A node reports a transaction it already holds, or has already mined, as a
// rejection. Either way it is out, which is all a broadcast is for.
const alreadyKnown = (detail: string): boolean =>
  /already[ -](in[ -](block ?chain|utxo set|mempool)|known)/i.test(detail);

async function settle(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  const error = await failure(response, action);
  if (!alreadyKnown(error.message)) throw error;
}

interface PackageResult {
  package_msg?: string;
  'tx-results'?: Record<string, { error?: string }>;
}

export function createEsploraClient(
  network: string,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): ChainClient {
  const base = esploraBaseUrl(network);

  // A chain endpoint that accepts the connection and then never answers would
  // otherwise leave the caller pending forever, with no error to react to.
  const send = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });

  const getJson = async <T>(path: string): Promise<T> => {
    const response = await send(path);
    if (!response.ok) throw await failure(response, `GET ${path}`);
    return (await response.json()) as T;
  };

  return {
    async feeRates() {
      const response = await send('/v1/fees/recommended');
      if (!response.ok) throw await failure(response, 'GET /v1/fees/recommended');
      const fees = (await response.json()) as {
        fastestFee: number;
        halfHourFee: number;
        hourFee: number;
      };
      return {
        slow: atLeastOne(fees.hourFee),
        medium: atLeastOne(fees.halfHourFee),
        fast: atLeastOne(fees.fastestFee),
      };
    },

    async addressUtxos(address): Promise<ChainUtxo[]> {
      const utxos = await getJson<
        { txid: string; vout: number; value: number; status: { confirmed: boolean; block_height?: number } }[]
      >(`/address/${address}/utxo`);
      return utxos.map(utxo => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        confirmed: Boolean(utxo.status?.confirmed),
        blockHeight: utxo.status?.block_height,
      }));
    },

    async tipHeight() {
      const response = await send('/blocks/tip/height');
      if (!response.ok) throw await failure(response, 'GET /blocks/tip/height');
      return Number.parseInt((await response.text()).trim(), 10);
    },

    async broadcast(txHex) {
      const response = await send('/tx', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: txHex,
      });
      await settle(response, 'broadcast');
    },

    // Only a node can relay a zero-fee parent with its fee-paying child. The
    // hosted mempool passes this straight to bitcoind's `submitpackage`, so no
    // node of our own is needed.
    async broadcastPackage(parentHex, childHex) {
      const response = await send('/v1/txs/package', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([parentHex, childHex]),
      });
      await settle(response, 'package broadcast');
      // The node answers the call even when it refuses the package.
      const result = (await response.json().catch(() => null)) as PackageResult | null;
      if (!result?.package_msg || result.package_msg === 'success') return;
      const errors = Object.values(result['tx-results'] ?? {}).flatMap(r => (r.error ? [r.error] : []));
      const detail = errors.join('; ') || result.package_msg;
      if (!alreadyKnown(detail)) throw new Error(detail);
    },
  };
}
