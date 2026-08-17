import { describe, expect, it } from 'vitest';
import type { SendPaymentMethod } from '@breeztech/breez-sdk-spark';
import { getSendDestination, getLnurlPayAddress } from './utils';

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

// A scanned lnurl1... blob has no `address`, so the lightning address it
// belongs to has to come from LUD-16 metadata or not at all (#366).
describe('getLnurlPayAddress', () => {
  const details = (over: Record<string, unknown>) => ({
    callback: 'https://breez.tips/cb',
    minSendable: 1000,
    maxSendable: 100_000_000,
    metadataStr: '[["text/plain","Tips"]]',
    commentAllowed: 0,
    domain: 'breez.tips',
    url: 'https://breez.tips/.well-known/lnurlp/alice',
    ...over,
  }) as unknown as Parameters<typeof getLnurlPayAddress>[0];

  it('prefers the parsed address when the SDK resolved one', () => {
    expect(getLnurlPayAddress(details({
      address: 'alice@breez.tips',
      metadataStr: '[["text/identifier","bob@breez.tips"]]',
    }))).toBe('alice@breez.tips');
  });

  it('recovers the address from a text/identifier entry', () => {
    expect(getLnurlPayAddress(details({
      metadataStr: '[["text/plain","Tips"],["text/identifier","alice@breez.tips"]]',
    }))).toBe('alice@breez.tips');
  });

  it('recovers the address from a text/email entry', () => {
    expect(getLnurlPayAddress(details({
      metadataStr: '[["text/email","alice@breez.tips"]]',
    }))).toBe('alice@breez.tips');
  });

  it('returns undefined for an LNURL that is not a lightning address', () => {
    expect(getLnurlPayAddress(details({}))).toBeUndefined();
  });

  it('rejects an identifier that contacts would not accept', () => {
    expect(getLnurlPayAddress(details({
      metadataStr: '[["text/identifier","not an address"]]',
    }))).toBeUndefined();
  });

  it('survives metadata from a hostile host', () => {
    for (const metadataStr of ['not json', '{}', '[42]', '[["text/identifier"]]', '[["text/identifier",7]]', 'null']) {
      expect(getLnurlPayAddress(details({ metadataStr }))).toBeUndefined();
    }
  });
});
