import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { InputType } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { useSendPayment } from './useSendPayment';

const BOLT11 = 'lnbc100n1test';

/** Stands in for the SDK parser, which strips a `lightning:` prefix and reports
 *  the bare invoice in the details it returns. */
const bolt11Details = (input: string) =>
  ({
    type: 'bolt11Invoice',
    invoice: { bolt11: input.replace(/^lightning:/i, '') },
    amountMsat: 10000,
    expiry: 3600,
    timestamp: Math.floor(Date.now() / 1000),
  }) as unknown as InputType;

function renderSendPayment(parse: (input: string) => Promise<InputType>, overrides: Record<string, unknown> = {}) {
  const client = createMockClient({ parse: vi.fn().mockImplementation(parse), ...overrides } as never);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WalletProvider client={client} isConnected>
      <FiatDataProvider>
        <StableBalanceProvider>{children}</StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
  return { client, ...renderHook(() => useSendPayment(), { wrapper }) };
}

describe('processInput destinations', () => {
  it('prepares a scanned `lightning:` invoice with the bare bolt11 (breez/glow-app#168)', async () => {
    const { client, result } = renderSendPayment(async (input) => bolt11Details(input));

    await act(() => result.current.processInput(`lightning:${BOLT11}`));

    await waitFor(() =>
      expect(client.prepareSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRequest: { type: 'input', input: BOLT11 } }),
      ),
    );
    // The field still shows what was scanned, so back-navigation is not surprising.
    expect(result.current.paymentInput?.rawInput).toBe(`lightning:${BOLT11}`);
  });

  it('prepares a BIP21 URI with the address it wraps', async () => {
    const address = 'bc1qtest';
    const { client, result } = renderSendPayment(
      async (uri) =>
        ({
          type: 'bip21',
          uri,
          amountSat: 1000,
          paymentMethods: [{ type: 'bitcoinAddress', address }],
        }) as unknown as InputType,
    );

    await act(() => result.current.processInput(`bitcoin:${address}?amount=0.00001`));

    await waitFor(() =>
      expect(client.prepareSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRequest: { type: 'input', input: address } }),
      ),
    );
  });

  it('refuses an address from another network before preparing (#450)', async () => {
    const { client, result } = renderSendPayment(
      async (address) => ({ type: 'bitcoinAddress', address, network: 'testnet3' }) as unknown as InputType,
    );

    await act(() => result.current.processInput('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'));

    expect(result.current.error).toBe('That is a testnet address. Enter a mainnet Bitcoin address.');
    expect(result.current.currentStep).toBe('input');
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['Invalid input: Lnurl error: lnurl contains invalid k1 parameter', 'This login code is not valid. Refresh the site for a new one.'],
    ['Invalid input: Lnurl error: lnurl contains unsupported action', 'This login code is not valid. Refresh the site for a new one.'],
    ['Invalid input: invalid input', 'Invalid payment destination'],
  ])('names a broken login code apart from other bad input (%s)', async (sdkError, shown) => {
    const { result } = renderSendPayment(() => Promise.reject(new Error(sdkError)));

    await act(() => result.current.processInput('lnurl1bad'));

    expect(result.current.error).toBe(shown);
  });

  it('prepares an invoice with a sub-sat amount rounded up, as the SDK requires', async () => {
    const { client, result } = renderSendPayment(
      async (input) => ({ ...(bolt11Details(input) as object), amountMsat: 654_321 }) as InputType,
    );

    await act(() => result.current.processInput(BOLT11));

    await waitFor(() =>
      expect(client.prepareSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRequest: { type: 'input', input: BOLT11 }, amount: 655n }),
      ),
    );
  });

  const onchain = { type: 'bitcoinAddress', address: 'bc1qtest' };
  const spark = { type: 'sparkAddress', address: 'spark1test' };

  it.each([
    { rail: 'Lightning', methods: [onchain, spark, bolt11Details(BOLT11)], paid: BOLT11 },
    { rail: 'on-chain', methods: [spark, onchain], paid: 'bc1qtest' },
  ])('pays a unified BIP21 over $rail whatever order the parser lists it in', async ({ methods, paid }) => {
    const { client, result } = renderSendPayment(
      async (uri) => ({ type: 'bip21', uri, amountSat: 1000, paymentMethods: methods }) as unknown as InputType,
    );

    await act(() => result.current.processInput('bitcoin:bc1qtest?amount=0.00001'));

    await waitFor(() =>
      expect(client.prepareSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRequest: { type: 'input', input: paid } }),
      ),
    );
  });
});

describe('an invoice the wallet already paid', () => {
  it('shows a plain message instead of the send error', async () => {
    const { client, result } = renderSendPayment(async (input) => bolt11Details(input));
    client.sendPayment = vi.fn().mockRejectedValue(new Error(
      'status: AlreadyExists, message: "preimage request already exists for paymentHash hash1"',
    ));

    await act(() => result.current.processInput(BOLT11));
    await waitFor(() => expect(result.current.prepareResponse).not.toBeNull());
    await act(() => result.current.handleSend());

    expect(result.current.paymentResult).toBe('failure');
    expect(result.current.error).toBe('This invoice has already been paid.');
  });
});

describe('an expired invoice (#543)', () => {
  const EXPIRED_MESSAGE = 'This invoice has expired. Ask the recipient for a new one.';
  const SDK_EXPIRED = 'Invalid input: Invoice has expired';

  /** Created at the epoch with an hour to live. */
  const expiredDetails = (input: string, amountMsat?: number) =>
    ({ ...(bolt11Details(input) as object), amountMsat, timestamp: 0, expiry: 3600 }) as InputType;

  it.each([
    ['with an amount', 10_000],
    ['without an amount', undefined],
  ])('says so on the input step without preparing, for an invoice %s', async (_, amountMsat) => {
    const { client, result } = renderSendPayment(async (input) => expiredDetails(input, amountMsat));

    await act(() => result.current.processInput(BOLT11));

    expect(result.current.error).toBe(EXPIRED_MESSAGE);
    expect(result.current.currentStep).toBe('input');
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
  });

  it('says so as soon as one is pasted, before Continue', async () => {
    const { result } = renderSendPayment(async (input) => expiredDetails(input, 10_000));

    await act(() => result.current.processInput(BOLT11, { requireReview: true }));

    expect(result.current.error).toBe(EXPIRED_MESSAGE);
  });

  it('does not fall back to the address in a unified BIP21', async () => {
    const { client, result } = renderSendPayment(
      async (uri) =>
        ({
          type: 'bip21',
          uri,
          amountSat: 10,
          paymentMethods: [{ type: 'bitcoinAddress', address: 'bc1qtest', network: 'bitcoin' }, expiredDetails(BOLT11, 10_000)],
        }) as unknown as InputType,
    );

    await act(() => result.current.processInput(`bitcoin:bc1qtest?amount=0.0000001&lightning=${BOLT11}`));

    expect(result.current.error).toBe(EXPIRED_MESSAGE);
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
  });

  it('still prepares an invoice in its last second, as the SDK does', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(3600_999);
    try {
      const { client, result } = renderSendPayment(async (input) => expiredDetails(input, 10_000));

      await act(() => result.current.processInput(BOLT11));

      expect(result.current.error).toBeNull();
      expect(client.prepareSendPayment).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes back to the input step when it expires during amount entry', async () => {
    const { result } = renderSendPayment(
      async (input) => ({ ...(bolt11Details(input) as object), amountMsat: undefined }) as InputType,
      { prepareSendPayment: vi.fn().mockRejectedValue(new Error(SDK_EXPIRED)) },
    );

    await act(() => result.current.processInput(BOLT11));
    expect(result.current.currentStep).toBe('amount');
    await act(() => result.current.onAmountNext(1000n));

    expect(result.current.error).toBe(EXPIRED_MESSAGE);
    expect(result.current.currentStep).toBe('input');
    expect(result.current.prepareResponse).toBeNull();
  });

  it('fails the send with the same message when it expires on the confirm screen', async () => {
    const { client, result } = renderSendPayment(async (input) => bolt11Details(input));
    client.sendPayment = vi.fn().mockRejectedValue(new Error(SDK_EXPIRED));

    await act(() => result.current.processInput(BOLT11));
    await waitFor(() => expect(result.current.prepareResponse).not.toBeNull());
    await act(() => result.current.handleSend());

    expect(result.current.paymentResult).toBe('failure');
    expect(result.current.error).toBe(EXPIRED_MESSAGE);
  });
});

describe('prepare errors', () => {
  it('asks to try again in a few minutes while reserved leaves keep the balance from settling (#535)', async () => {
    const { result } = renderSendPayment(
      async (address) => ({ type: 'bitcoinAddress', address, network: 'bitcoin' }) as unknown as InputType,
      {
        prepareSendPayment: vi
          .fn()
          .mockRejectedValue(new Error('Tree service error: generic error: Failed to select leaves after all retries')),
      },
    );

    await act(() => result.current.processInput('bc1qtest'));
    await act(() => result.current.onAmountNext(1000n, true));

    expect(result.current.error).toBe('Could not prepare the payment while your balance settles. Please try again in a few minutes.');
  });
});
