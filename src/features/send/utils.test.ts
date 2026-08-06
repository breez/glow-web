import { describe, expect, it } from 'vitest';
import type { SendPaymentMethod } from '@breeztech/breez-sdk-spark';
import { getSendDestination } from './utils';

// Only the fields getSendDestination reads; the rest of each variant is noise here.
const method = (m: unknown) => m as SendPaymentMethod;

describe('getSendDestination', () => {
  it('reads the destination out of every send payment method', () => {
    expect(getSendDestination(method({ type: 'bitcoinAddress', address: { address: 'bc1qtest' } })).value)
      .toBe('bc1qtest');
    expect(getSendDestination(method({ type: 'sparkAddress', address: 'sp1test' })).value)
      .toBe('sp1test');
    expect(getSendDestination(method({ type: 'sparkInvoice', sparkInvoiceDetails: { invoice: 'sparkrt1test' } })).value)
      .toBe('sparkrt1test');
    expect(getSendDestination(method({ type: 'bolt11Invoice', invoiceDetails: { invoice: { bolt11: 'lnbc1test' } } })).value)
      .toBe('lnbc1test');
    expect(getSendDestination(method({ type: 'crossChainAddress', recipientAddress: '0xtest' })).value)
      .toBe('0xtest');
  });

  it('labels every variant', () => {
    for (const type of ['bitcoinAddress', 'sparkAddress', 'sparkInvoice', 'bolt11Invoice', 'crossChainAddress']) {
      const m = method({
        type,
        address: type === 'bitcoinAddress' ? { address: 'a' } : 'a',
        sparkInvoiceDetails: { invoice: 'a' },
        invoiceDetails: { invoice: { bolt11: 'a' } },
        recipientAddress: 'a',
      });
      expect(getSendDestination(m).label).toBeTruthy();
    }
  });
});
