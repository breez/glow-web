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
  }) as unknown as InputType;

function renderSendPayment(parse: (input: string) => Promise<InputType>) {
  const client = createMockClient({ parse: vi.fn().mockImplementation(parse) } as never);
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
});
