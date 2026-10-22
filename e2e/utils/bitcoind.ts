/**
 * The regtest node's RPC, with the credentials `regtest:up` writes to
 * `.env.local` (Playwright loads it). Only a node you run answers these.
 */
const RPC_URL = process.env.BITCOIND_RPC_URL;
const RPC_AUTH = Buffer.from(
  `${process.env.BITCOIND_RPC_USER ?? 'rpcuser'}:${process.env.BITCOIND_RPC_PASSWORD ?? 'rpcpassword'}`,
).toString('base64');

// Outside the node's wallet: coinbases accumulating there slow later blocks.
const MINING_ADDRESS = 'bcrt1qs758ursh4q9z627kt3pp5yysm78ddny6txaqgw';

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  if (!RPC_URL) throw new Error('no BITCOIND_RPC_URL: run npm run regtest:up');
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${RPC_AUTH}` },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'e2e', method, params }),
  });
  const text = await response.text();
  let body: { result: T; error: { message: string } | null } | null = null;
  try {
    body = JSON.parse(text) as { result: T; error: { message: string } | null };
  } catch {
    body = null;
  }
  if (body?.error) throw new Error(`${method}: ${body.error.message}`);
  if (!response.ok || !body) throw new Error(`${method}: ${text.slice(0, 200)}`);
  return body.result;
}

export const isBitcoindReachable = async (): Promise<boolean> => {
  try {
    await rpc<number>('getblockcount');
    return true;
  } catch {
    return false;
  }
};

export const tipHeight = (): Promise<number> => rpc<number>('getblockcount');

export const mineBlocks = (count: number): Promise<string[]> =>
  rpc<string[]>('generatetoaddress', [count, MINING_ADDRESS]);

export const newAddress = (label: string): Promise<string> =>
  rpc<string>('getnewaddress', [label, 'bech32']);

export const sendToAddress = (address: string, btc: number): Promise<string> =>
  rpc<string>('sendtoaddress', [address, btc]);

/** Sends an exact amount, left unconfirmed until a block is mined. */
export const sendSats = (address: string, sats: number): Promise<string> =>
  rpc<string>('sendtoaddress', [address, (sats / 100_000_000).toFixed(8)]);

export const mempoolTxids = (): Promise<string[]> => rpc<string[]>('getrawmempool');

// A fee delta this far below zero keeps a transaction out of every block. The
// node adds deltas up, so a release adds back exactly what a hold took away.
const HOLD_SATS = 100_000_000;

export const holdTransaction = (txid: string): Promise<boolean> =>
  rpc<boolean>('prioritisetransaction', [txid, 0, -HOLD_SATS]);

export const releaseTransaction = (txid: string): Promise<boolean> =>
  rpc<boolean>('prioritisetransaction', [txid, 0, HOLD_SATS]);

export const addressBalanceSats = async (address: string): Promise<number> => {
  const scan = await rpc<{ total_amount: number }>('scantxoutset', [
    'start',
    [{ desc: `addr(${address})` }],
  ]);
  return Math.round(scan.total_amount * 100_000_000);
};

/** Mines until every relative timelock in flight can mature, then a little more. */
export const mineToMature = async (blocks: number): Promise<void> => {
  await mineBlocks(blocks + 1);
};

export const decodeRawTx = (hex: string): Promise<{ vin: { txid: string; vout: number }[] }> =>
  rpc<{ vin: { txid: string; vout: number }[] }>('decoderawtransaction', [hex]);

/** Whether an outpoint is spendable right now, mempool included. */
export const isUnspent = async (txid: string, vout: number): Promise<boolean> =>
  (await rpc<unknown>('gettxout', [txid, vout, true])) !== null;
