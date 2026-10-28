import { describe, it, expect } from 'vitest';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { getPaymentDescription, isConversionPayment, isRefundedConversion } from './paymentDescription';

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

describe('getPaymentDescription', () => {
  it('names a Cash App recipient by cashtag', () => {
    expect(getPaymentDescription(payment({
      paymentType: 'send',
      details: { type: 'lightning', invoice: 'lnbc1', destinationPubkey: 'pk', htlcDetails: {}, lnurlPayInfo: { lnAddress: 'cashapp@cash.app' } },
    } as Partial<Payment>))).toBe('Pay to $cashapp');
  });
});

// The SDK lists a refunded round trip as the refund, a receive, with the send
// nested under it. `to` is the refund, so only `from` says what was attempted.
const refunded = (fromTicker: string, method: Payment['method'], over: Partial<Payment> = {}): Payment => payment({
  method,
  details: { type: 'spark', conversionInfo: { type: 'amm', poolId: 'x', conversionId: 'c', status: 'refunded' } },
  conversionDetails: {
    status: 'refunded',
    conversions: [{
      provider: 'amm',
      status: 'refunded',
      from: { chain: { type: 'spark' }, asset: { ticker: fromTicker, decimals: 0 }, amount: 2000n, fee: 0n },
      to: { chain: { type: 'spark' }, asset: { ticker: fromTicker, decimals: 0 }, amount: 2000n, fee: 0n },
    }],
  },
  ...over,
} as Partial<Payment>);

describe('isRefundedConversion', () => {
  it('is true for a refunded stable-balance conversion', () => {
    expect(isRefundedConversion(refunded('BTC', 'spark'))).toBe(true);
  });

  it('is false for a completed conversion', () => {
    expect(isRefundedConversion(payment({ conversionDetails: { status: 'completed' } } as Partial<Payment>))).toBe(false);
  });

  // A cross-chain refund lands as its own payment, so the send keeps its row.
  it('is false for a cross-chain send', () => {
    expect(isRefundedConversion(refunded('BTC', 'lightning', {
      paymentType: 'send',
      details: { type: 'lightning', conversionInfo: { type: 'orchestra', status: 'refunded' } },
    } as Partial<Payment>))).toBe(false);
  });
});

describe('getPaymentDescription for a refunded conversion', () => {
  it('names a sats to USD attempt, not the bitcoin that came back', () => {
    expect(getPaymentDescription(refunded('BTC', 'spark'))).toBe('Conversion to USD');
  });

  it('names a USD to bitcoin attempt, not the USD that came back', () => {
    expect(getPaymentDescription(refunded('USDB', 'token', {
      details: {
        type: 'token',
        metadata: { ticker: 'USDB' },
        conversionInfo: { type: 'amm', poolId: 'x', conversionId: 'c', status: 'refunded' },
      },
    } as Partial<Payment>))).toBe('Conversion to Bitcoin');
  });
});
