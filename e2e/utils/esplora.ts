/**
 * The chain API the app itself reads. Used here to tell apart a transaction the
 * app broadcast from one the operators' watchtower published.
 */
const BASE = process.env.TEST_ESPLORA_URL || 'http://127.0.0.1:8090/api';

interface AddressTx {
  txid: string;
  status: { confirmed: boolean; block_height?: number };
}

export const addressTxs = async (address: string): Promise<AddressTx[]> => {
  const res = await fetch(`${BASE}/address/${address}/txs`);
  if (!res.ok) throw new Error(`esplora ${res.status} for ${address}`);
  return (await res.json()) as AddressTx[];
};

export const confirmedTxids = async (address: string): Promise<string[]> =>
  (await addressTxs(address)).filter(t => t.status.confirmed).map(t => t.txid);

export const txConfirmed = async (txid: string): Promise<boolean> => {
  const res = await fetch(`${BASE}/tx/${txid}`);
  if (!res.ok) return false;
  return ((await res.json()) as { status: { confirmed: boolean } }).status.confirmed;
};

/** Who spent an output, which is how a refund's two rival copies are told apart. */
export const outspend = async (
  txid: string,
  vout: number,
): Promise<{ spent: boolean; txid?: string }> => {
  const res = await fetch(`${BASE}/tx/${txid}/outspend/${vout}`);
  if (!res.ok) throw new Error(`esplora ${res.status} for ${txid}:${vout}`);
  return (await res.json()) as { spent: boolean; txid?: string };
};

/** Resolves once `predicate` holds, or throws when `timeoutMs` runs out. */
export const waitFor = async <T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 120_000, everyMs = 2_000, what = 'condition' } = {},
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read().catch(() => null as T | null);
    if (value !== null && predicate(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, everyMs));
  }
};
