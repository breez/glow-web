import { describe, expect, it } from 'vitest';
import type { BreezSdk, Contact } from '@breeztech/breez-sdk-spark';
import { paymentIdentifierLabel, resolvePaymentIdentifier, searchContacts } from './useContacts';

const contact = (name: string, paymentIdentifier: string) =>
  ({ id: name, name, paymentIdentifier, createdAt: 0, updatedAt: 0 }) as Contact;

describe('paymentIdentifierLabel', () => {
  it('shows a Cash App address as its cashtag', () => {
    expect(paymentIdentifierLabel('cashapp@cash.app')).toBe('$cashapp');
    expect(paymentIdentifierLabel('CashApp@Cash.App')).toBe('$cashapp');
  });

  it('leaves other addresses alone', () => {
    expect(paymentIdentifierLabel('cashapp@getalby.com')).toBe('cashapp@getalby.com');
    expect(paymentIdentifierLabel('cashapp@cash.app.evil.com')).toBe('cashapp@cash.app.evil.com');
  });
});

describe('searchContacts', () => {
  it('finds a Cash App contact by its cashtag', () => {
    const cashApp = contact('Payments', 'cashapp@cash.app');
    expect(searchContacts([cashApp, contact('Ann', 'ann@getalby.com')], '$cash')).toEqual([cashApp]);
  });
});

describe('resolvePaymentIdentifier', () => {
  const wallet = (parsed: object | null) =>
    ({ parse: async () => { if (!parsed) throw new Error('invalid input'); return parsed; } }) as unknown as BreezSdk;
  const cashApp = { type: 'lightningAddress', address: 'cashapp@cash.app' };

  it('keeps the saved value when the field is untouched', async () => {
    expect(await resolvePaymentIdentifier(wallet(null), '$cashapp', 'cashapp@cash.app'))
      .toEqual({ paymentIdentifier: 'cashapp@cash.app' });
  });

  it('saves the lowercase address a cashtag resolves to', async () => {
    expect(await resolvePaymentIdentifier(wallet(cashApp), '$CashApp')).toEqual({ paymentIdentifier: 'cashapp@cash.app' });
  });

  it('rejects a cashtag that does not resolve to a Lightning address', async () => {
    expect(await resolvePaymentIdentifier(wallet(null), '$cashapp')).toEqual({ error: 'Cashtag not found' });
    expect(await resolvePaymentIdentifier(wallet({ type: 'bip21' }), '$cashapp')).toEqual({ error: 'Cashtag not found' });
  });

  it('rejects a malformed address before parsing', async () => {
    expect(await resolvePaymentIdentifier(wallet(cashApp), 'not an address')).toEqual({ error: 'Invalid Lightning address format' });
  });

  it('keeps a user@domain that resolves to something else', async () => {
    expect(await resolvePaymentIdentifier(wallet({ type: 'bip21' }), 'ann@example.com')).toEqual({ paymentIdentifier: 'ann@example.com' });
  });
});
