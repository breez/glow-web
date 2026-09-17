import { normalizeChainName } from './crossChainRoutes';

/**
 * Block explorer link for a Bitcoin L1 transaction.
 *
 * Only deposit and withdraw payments carry an L1 txid. Token payments carry a
 * Spark `txHash`, which belongs on no public explorer, and a cross-chain
 * payment settles on its destination chain: see `chainExplorerTxUrl`.
 */
// ponytail: mainnet only. Regtest is a dev-only override with no public
// explorer, so its links dead-end; branch on the network if that ever matters.
export const explorerTxUrl = (txid: string): string => `https://mempool.space/tx/${txid}`;

// Keyed on `normalizeChainName`, so "Arbitrum One" and "Polygon POS" resolve
// with the plain names. Values take the hash appended.
const CHAIN_EXPLORERS: Record<string, string> = {
  arbitrum: 'https://arbiscan.io/tx/',
  avalanche: 'https://snowtrace.io/tx/',
  base: 'https://basescan.org/tx/',
  bsc: 'https://bscscan.com/tx/',
  ethereum: 'https://etherscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
  solana: 'https://solscan.io/tx/',
  tron: 'https://tronscan.org/#/transaction/',
};

/**
 * Block explorer link for a cross-chain payment's external leg. The supported
 * chains come from the SDK's route pairs, so one we have no explorer for is
 * expected: undefined means show the hash without a link, never a guessed URL.
 */
export function chainExplorerTxUrl(chain: string, txHash: string): string | undefined {
  const base = CHAIN_EXPLORERS[normalizeChainName(chain)];
  return base ? `${base}${txHash}` : undefined;
}
