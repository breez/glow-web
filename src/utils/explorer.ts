/**
 * Block explorer link for a Bitcoin L1 transaction.
 *
 * Only deposit and withdraw payments carry an L1 txid. Token payments carry a
 * Spark `txHash` and cross-chain payments settle on the destination chain:
 * neither belongs on mempool.space.
 */
// ponytail: mainnet only. Regtest is a dev-only override with no public
// explorer, so its links dead-end; branch on the network if that ever matters.
export const explorerTxUrl = (txid: string): string => `https://mempool.space/tx/${txid}`;
