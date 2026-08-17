import { describe, it, expect } from 'vitest';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { isConversionPayment } from './paymentDescription';

const payment = (over: Partial<Payment>): Payment => ({
  id: 'p1',
  paymentType: 'receive',
  status: 'completed',
  amount: 1000n,
  fees: 0n,
  timestamp: 0,
  method: 'lightning',
  ...over,
} as Payment);

describe('isConversionPayment', () => {
  it('is false for a plain receive', () => {
    expect(isConversionPayment(payment({
      details: { type: 'lightning', invoice: 'lnbc1', destinationPubkey: 'pk', htlcDetails: {} },
    } as Partial<Payment>))).toBe(false);
  });

  it('is true for a cross-chain leg carrying conversionInfo', () => {
    expect(isConversionPayment(payment({
      details: { type: 'spark', conversionInfo: { type: 'amm', poolId: 'x', conversionId: 'c', status: 'completed' } },
    } as Partial<Payment>))).toBe(true);
  });

  // The stable-balance case: the parent carries only conversionDetails.
  it('is true for a conversion parent carrying only conversionDetails', () => {
    expect(isConversionPayment(payment({
      details: { type: 'spark' },
      conversionDetails: { status: 'completed' },
    } as Partial<Payment>))).toBe(true);
  });
});
