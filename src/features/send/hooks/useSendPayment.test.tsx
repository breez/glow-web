import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { useSendPayment } from './useSendPayment';

function renderSendPayment(client: BreezSdk) {
  return renderHook(() => useSendPayment(), {
    wrapper: ({ children }) => (
      <WalletProvider client={client} isConnected>
        <FiatDataProvider>
          <StableBalanceProvider>{children}</StableBalanceProvider>
        </FiatDataProvider>
      </WalletProvider>
    ),
  });
}

// A repeat call in the same tick must not reach the SDK. `isLoading` cannot do
// that on its own: React state settles on the next render, so the latch is a ref.
describe('useSendPayment in-flight guard', () => {
  it('sends once when handleSend is called twice before the re-render', async () => {
    const client = createMockClient();
    const { result } = renderSendPayment(client);

    // The mock parses this as a bolt11 with an embedded amount, so the hook
    // prepares straight away and lands on the confirm step.
    await act(async () => {
      await result.current.processInput('lnbc1test');
    });
    await waitFor(() => expect(result.current.prepareResponse).not.toBeNull());

    await act(async () => {
      await Promise.all([result.current.handleSend(), result.current.handleSend()]);
    });

    expect(client.sendPayment).toHaveBeenCalledTimes(1);
  });

  it('runs once when handleRun is called twice before the re-render', async () => {
    const client = createMockClient();
    const { result } = renderSendPayment(client);
    const runner = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      await Promise.all([result.current.handleRun(runner), result.current.handleRun(runner)]);
    });

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after the first attempt settles', async () => {
    const client = createMockClient();
    const { result } = renderSendPayment(client);
    const runner = vi.fn().mockRejectedValue(new Error('boom'));

    await act(async () => {
      await result.current.handleRun(runner);
    });
    await act(async () => {
      await result.current.handleRun(runner);
    });

    expect(runner).toHaveBeenCalledTimes(2);
  });
});
