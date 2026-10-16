import { createEsploraClient } from './esplora';

export interface ChainUtxo {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  blockHeight?: number;
}

/** A transaction in a block that spent an output, and what it paid where. */
export interface ChainSpend {
  txid: string;
  blockHeight?: number;
  outputs: { address?: string; value: number }[];
}

export interface FeeRates {
  slow: number;
  medium: number;
  fast: number;
}

/**
 * Chain access the exit needs: what the funding address holds, where the tip is,
 * and how to put a transaction or a 1P1C package on the network. Whether a step
 * has confirmed comes from the sdk, which reads the chain itself. What spent an
 * output is read here, because a replacement may be what confirmed.
 */
export interface ChainClient {
  feeRates(): Promise<FeeRates>;
  addressUtxos(address: string): Promise<ChainUtxo[]>;
  tipHeight(): Promise<number>;
  broadcast(txHex: string): Promise<void>;
  broadcastPackage(parentHex: string, childHex: string): Promise<void>;
  /** Null while the output is unspent, or spent only in the mempool. */
  confirmedSpender(txid: string, vout: number): Promise<ChainSpend | null>;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Chain backend for a network. A locally-run regtest points at its own indexer
 * and mempool, which answer the same way the hosted ones do.
 */
export function createChainClient(network: string): ChainClient {
  return createEsploraClient(network);
}
