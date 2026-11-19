import { describe, it, expect } from 'vitest';
import type { Payment } from '@breeztech/breez-sdk-spark';
import {
  parseCrossChainAmount,
  formatCrossChainAmount,
  getCrossChainDestination,
  getCrossChainOutcome,
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
    estimatedOut: 1_030_000n,
    assetDecimals: 6,
    status: 'completed',
    orderId: 'o1',
    quoteId: 'q1',
  };

  // Amounts are bigints, so a zero is falsy where its string form was not.
  it('keeps a delivered amount of zero', () => {
    const dest = getCrossChainDestination(crossChainPayment({ ...orchestra, deliveredAmount: 0n }));
    expect(dest.deliveredAmount).toBe(0n);
  });

  it('surfaces the external tx hash', () => {
    const dest = getCrossChainDestination(crossChainPayment({ ...orchestra, externalTxHash: '5jQ8f' }));
    expect(dest.externalTxHash).toBe('5jQ8f');
  });

  it('leaves it undefined before the external leg broadcasts', () => {
    expect(getCrossChainDestination(crossChainPayment(orchestra)).externalTxHash).toBeUndefined();
  });

  it('surfaces the refund tx hash once refunded', () => {
    const dest = getCrossChainDestination(crossChainPayment({ ...orchestra, status: 'refunded', refundTxHash: '0x2707' }));
    expect(dest.refundTxHash).toBe('0x2707');
    expect(getCrossChainDestination(crossChainPayment(orchestra)).refundTxHash).toBeUndefined();
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

describe('getCrossChainOutcome', () => {
  const orchestra = {
    type: 'orchestra',
    chain: 'Base',
    recipientAddress: '0xabc',
    estimatedOut: 1_030_000n,
    assetDecimals: 6,
    orderId: 'o1',
    quoteId: 'q1',
  };

  it('reports a failed or refunded order on a completed payment', () => {
    expect(getCrossChainOutcome(crossChainPayment({ ...orchestra, status: 'failed' }))).toBe('failed');
    expect(getCrossChainOutcome(crossChainPayment({ ...orchestra, status: 'refunded' }))).toBe('refunded');
  });

  it('reports a receive recorded as a failed payment', () => {
    const receive = (status: string) => ({
      ...crossChainPayment({ ...orchestra, status }),
      paymentType: 'receive',
      status: 'failed',
    } as Payment);
    expect(getCrossChainOutcome(receive('refunded'))).toBe('refunded');
    expect(getCrossChainOutcome(receive('failed'))).toBe('failed');
  });

  // A legacy refundNeeded row is still waiting on Orchestra, like pending.
  it('is null while in flight or once delivered', () => {
    for (const status of ['pending', 'refundNeeded', 'completed']) {
      expect(getCrossChainOutcome(crossChainPayment({ ...orchestra, status }))).toBeNull();
    }
  });

  it('ignores other providers', () => {
    expect(getCrossChainOutcome(crossChainPayment({ ...orchestra, type: 'boltz', status: 'failed' }))).toBeNull();
  });
});
