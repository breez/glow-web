import { describe, it, expect } from 'vitest';
import { chainExplorerTxUrl } from './explorer';

const HASH = '5jQ8f4nR2xKp9wLm3vTa7cYd8sHbN4kLm2';

describe('chainExplorerTxUrl', () => {
  it('resolves a plain chain name', () => {
    expect(chainExplorerTxUrl('Solana', HASH)).toBe(`https://solscan.io/tx/${HASH}`);
    expect(chainExplorerTxUrl('base', HASH)).toBe(`https://basescan.org/tx/${HASH}`);
  });

  // The suffixed spellings are what the SDK's route pairs actually carry, so a
  // map keyed on the bare names only works through normalizeChainName.
  it('resolves the suffixed spellings the SDK uses', () => {
    expect(chainExplorerTxUrl('Arbitrum One', HASH)).toBe(`https://arbiscan.io/tx/${HASH}`);
    expect(chainExplorerTxUrl('Polygon POS', HASH)).toBe(`https://polygonscan.com/tx/${HASH}`);
  });

  it('keeps the hash in the fragment for Tron', () => {
    expect(chainExplorerTxUrl('tron', HASH)).toBe(`https://tronscan.org/#/transaction/${HASH}`);
  });

  it('returns undefined for a chain we have no explorer for', () => {
    expect(chainExplorerTxUrl('someNewChain', HASH)).toBeUndefined();
  });
});
