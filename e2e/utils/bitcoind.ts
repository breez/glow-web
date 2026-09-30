/**
 * The Bitcoin node of the local Spark environment, at its default port and with
 * its fixed credentials. Its wallet holds what the environment mined.
 */
const RPC_URL = process.env.BITCOIND_RPC_URL ?? 'http://127.0.0.1:18443/wallet/default';
const RPC_AUTH = Buffer.from(
  `${process.env.BITCOIND_RPC_USER ?? 'rpcuser'}:${process.env.BITCOIND_RPC_PASSWORD ?? 'rpcpassword'}`,
).toString('base64');

// Outside the node's wallet: coinbases accumulating there slow later blocks.
const MINING_ADDRESS = 'bcrt1qs758ursh4q9z627kt3pp5yysm78ddny6txaqgw';

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
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

/**
 * Whether the chain holds still between the blocks a test mines. The local
 * environment mines a block every 5 seconds unless told to mine only on
 * request.
 */
export const minesOnlyOnRequest = async (): Promise<boolean> => {
  const before = await tipHeight();
  await new Promise(resolve => setTimeout(resolve, 7_000));
  return (await tipHeight()) === before;
};

export const mineBlocks = (count: number): Promise<string[]> =>
  rpc<string[]>('generatetoaddress', [count, MINING_ADDRESS]);

export const newAddress = (label: string): Promise<string> =>
  rpc<string>('getnewaddress', [label, 'bech32']);

export const sendToAddress = (address: string, btc: number): Promise<string> =>
  rpc<string>('sendtoaddress', [address, btc]);

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
