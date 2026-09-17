import { describe, it, expect } from 'vitest';
import type { Payment } from '@breeztech/breez-sdk-spark';
import {
  parseCrossChainAmount,
  formatCrossChainAmount,
  getCrossChainDestination,
} from './crossChainFormat';

describe('parseCrossChainAmount', () => {
  it('scales a whole dollar value', () => {
    expect(parseCrossChainAmount('1', 6)).toBe(1_000_000n);
    expect(parseCrossChainAmount('1', 18)).toBe(1_000_000_000_000_000_000n);
  });

  it('scales cents', () => {
    expect(parseCrossChainAmount('10.55', 6)).toBe(10_550_000n);
    expect(parseCrossChainAmount('0.01', 6)).toBe(10_000n);
  });

  // The reason this doesn't scale through Number: the float path is exact for
  // small values and silently wrong past 2^53, so testing $1 proves nothing.
  it('stays exact where float scaling drifts', () => {
    expect(parseCrossChainAmount('99999.99', 18)).toBe(99_999_990_000_000_000_000_000n);
    expect(BigInt(Math.round(99999.99 * 10 ** 18))).not.toBe(99_999_990_000_000_000_000_000n);
  });

  it('truncates fraction digits finer than the asset', () => {
    expect(parseCrossChainAmount('1.239', 2)).toBe(123n);
  });

  it('handles a bare fraction and an empty value', () => {
    expect(parseCrossChainAmount('.5', 6)).toBe(500_000n);
    expect(parseCrossChainAmount('', 6)).toBe(0n);
  });

  it('round-trips through formatCrossChainAmount', () => {
    for (const [value, decimals] of [['10.55', 6], ['1', 18], ['0.01', 6]] as const) {
      expect(formatCrossChainAmount(parseCrossChainAmount(value, decimals), decimals))
        .toBe(String(Number(value)));
    }
  });
});

const crossChainPayment = (convInfo: unknown): Payment => ({
  id: 'p1',
  paymentType: 'send',
  status: 'completed',
  amount: 1000n,
  fees: 0n,
  timestamp: 0,
  method: 'spark',
  details: { type: 'spark', conversionInfo: convInfo },
} as Payment);

describe('getCrossChainDestination', () => {
  const orchestra = {
    type: 'orchestra',
    chain: 'Solana',
    recipientAddress: '8kBoWYZadELjg8dgS2c5DXyapr8y8fsGY2HZWsaagguz',
    estimatedOut: '1030000',
    assetDecimals: 6,
    status: 'completed',
    orderId: 'o1',
    quoteId: 'q1',
  };

  it('surfaces the external tx hash', () => {
    const dest = getCrossChainDestination(crossChainPayment({ ...orchestra, externalTxHash: '5jQ8f' }));
    expect(dest.externalTxHash).toBe('5jQ8f');
  });

  it('leaves it undefined before the external leg broadcasts', () => {
    expect(getCrossChainDestination(crossChainPayment(orchestra)).externalTxHash).toBeUndefined();
  });

  // Boltz has no such field, so the rest of the destination must still resolve.
  it('leaves it undefined for boltz', () => {
    const dest = getCrossChainDestination(crossChainPayment({
      ...orchestra,
      type: 'boltz',
      swapId: 's1',
      invoice: 'lnbc1',
      invoiceAmountSats: 1000,
      maxSlippageBps: 50,
    }));
    expect(dest.externalTxHash).toBeUndefined();
    expect(dest.chainName).toBe('Solana');
  });
});
