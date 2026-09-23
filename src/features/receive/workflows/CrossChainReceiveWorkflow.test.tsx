import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk, CrossChainRoutePair, ReceivePaymentRequest } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import { setLastUsdReceiveRoute } from '@/services/settings';
import ReceivePaymentDialog from '../ReceivePaymentDialog';

const usdcOn = (chain: string, limits?: { minUsdCents?: number; maxUsdCents?: number }): CrossChainRoutePair => ({
  provider: 'orchestra',
  chain,
  asset: 'USDC',
  decimals: 6,
  exactOutEligible: false,
  acceptedAssets: [{ asset: { type: 'bitcoin' }, limits }],
  deliveryMethods: ['spark'],
}) as unknown as CrossChainRoutePair;

const withCrossChainReceive = (routes: CrossChainRoutePair[]): BreezSdk => {
  const client = createMockClient() as unknown as BreezSdk;
  client.getCrossChainRoutes = vi.fn().mockResolvedValue(routes);
  const receive = client.receivePayment.bind(client);
  client.receivePayment = vi.fn().mockImplementation(async (request: ReceivePaymentRequest) =>
    request.paymentMethod.type === 'crossChain'
      ? {
          paymentRequest: 'solana:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
          fee: 0n,
          crossChainInfo: {
            depositAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
            depositAmount: '10050000',
            expectedReceivedAmount: '12298',
            destinationAsset: 'BTC',
            serviceFeeAmount: '10000',
            serviceFeeAsset: 'USDC',
            expiresAt: 1_900_000_000,
          },
        }
      : receive(request),
  );
  return client;
};

const openUsdTab = async (client: BreezSdk) => {
  render(
    <ToastProvider>
      <WalletProvider client={client} isConnected>
        <FiatDataProvider>
          <StableBalanceProvider>
            <ReceivePaymentDialog isOpen onClose={vi.fn()} />
          </StableBalanceProvider>
        </FiatDataProvider>
      </WalletProvider>
    </ToastProvider>,
  );
  await waitForSheetOpen();
  fireEvent.click(screen.getByTestId('usd-tab'));
};

describe('USD receive deposit address', () => {
  // `settings.ts` caches its reads, so the remembered route is set through
  // the service rather than written past it into localStorage.
  beforeEach(() => localStorage.clear());

  it('steps back to the amount from the header arrow', async () => {
    const client = withCrossChainReceive([usdcOn('solana'), usdcOn('base')]);
    await openUsdTab(client);

    fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));
    fireEvent.click(await screen.findByText('Solana'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('cross-chain-deposit-address');

    // The deposit reads as an instruction, the route is one stated line, and
    // the figures answer each other in a card of their own.
    expect(screen.getByText('Sender pays')).toBeInTheDocument();
    expect(screen.getByTestId('cross-chain-receive-route-summary')).toHaveTextContent('USDC on Solana');
    expect(screen.getByText('0.01')).toBeInTheDocument();
    expect(screen.getByText('~₿12 298')).toBeInTheDocument();

    // The code leads, folded under the address it belongs to. It still folds
    // away for a sender who only wants the address.
    const qrToggle = screen.getByRole('button', { name: 'Hide deposit address QR code' });
    expect(qrToggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(qrToggle);
    expect(screen.getByRole('button', { name: 'Show deposit address QR code' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));

    // Back lands on the amount, with the chip still naming what was just used.
    expect(await screen.findByTestId('cross-chain-receive-amount-input')).toBeInTheDocument();
    expect(screen.getByText('USDC on Solana')).toBeInTheDocument();
    expect(screen.queryByTestId('cross-chain-deposit-address')).toBeNull();
  });

  it('states the fee in its own asset, not the route\'s', async () => {
    // BSC USDC is an 18-decimal route, while Orchestra prices its fee in USDC
    // on Solana at 6. Formatting the fee at the route's scale turns five cents
    // into a millionth of one.
    setLastUsdReceiveRoute({ asset: 'USDC', chain: 'bsc' });
    const client = createMockClient() as unknown as BreezSdk;
    const bsc = { ...usdcOn('bsc'), decimals: 18 } as CrossChainRoutePair;
    client.getCrossChainRoutes = vi.fn().mockResolvedValue([bsc]);
    client.receivePayment = vi.fn().mockResolvedValue({
      paymentRequest: '0x7182aaa',
      fee: 0n,
      crossChainInfo: {
        depositAddress: '0x7182aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3b9bb8',
        depositAmount: '50680000000000000000',
        expectedReceivedAmount: '58617',
        destinationAsset: 'BTC',
        serviceFeeAmount: '50360',
        serviceFeeAsset: 'USDC',
        expiresAt: 1_900_000_000,
      },
    });
    await openUsdTab(client);
    fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '50.43' } });
    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));
    await screen.findByTestId('cross-chain-deposit-address');

    expect(screen.getByText('$50.68')).toBeInTheDocument();
    expect(screen.getByText('0.05')).toBeInTheDocument();
    // What was typed is not a row: the hero already states what to ask for.
    expect(screen.queryByText('You asked for')).toBeNull();
    // A fee under a cent states a bound rather than rounding away to nothing.
    expect(screen.queryByText('0.00')).toBeNull();
  });

  it('states the range beside the label and holds the amount to it', async () => {
    setLastUsdReceiveRoute({ asset: 'USDC', chain: 'solana' });
    const client = withCrossChainReceive([usdcOn('solana', { minUsdCents: 80, maxUsdCents: 8_980_000 })]);
    await openUsdTab(client);

    // Stated beside the label, so typing does not take it away.
    expect(await screen.findByTestId('cross-chain-receive-limits')).toHaveTextContent('$0.80 – $89 800');
    fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '0.50' } });
    expect(screen.getByTestId('cross-chain-receive-limits')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));
    expect(await screen.findByText('This network takes at least $0.80.')).toBeInTheDocument();
    expect(screen.queryByTestId('cross-chain-deposit-address')).toBeNull();

    fireEvent.change(screen.getByTestId('cross-chain-receive-amount-input'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));
    await screen.findByTestId('cross-chain-deposit-address');
  });

  it('takes the tabs away once there is a request to lose', async () => {
    setLastUsdReceiveRoute({ asset: 'USDC', chain: 'solana' });
    const client = withCrossChainReceive([usdcOn('solana'), usdcOn('base')]);
    await openUsdTab(client);

    fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '10' } });
    expect(screen.getByTestId('btc-tab')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));
    await screen.findByTestId('cross-chain-deposit-address');
    expect(screen.queryByTestId('btc-tab')).toBeNull();

    // The header arrow is the way back, and the tabs return with the form.
    // `useSheetBack` registers through an effect, so the arrow lands a render late.
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('cross-chain-receive-amount-input')).toBeInTheDocument();
    expect(screen.getByTestId('btc-tab')).toBeInTheDocument();
  });

  it('keeps the amount and network across a trip to the BTC tab', async () => {
    setLastUsdReceiveRoute({ asset: 'USDC', chain: 'solana' });
    const client = withCrossChainReceive([usdcOn('solana'), usdcOn('base')]);
    await openUsdTab(client);

    fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '42' } });
    await screen.findByText('USDC on Solana');

    fireEvent.click(screen.getByTestId('btc-tab'));
    expect(screen.queryByTestId('cross-chain-receive-amount-input')).toBeNull();
    fireEvent.click(screen.getByTestId('usd-tab'));

    expect(await screen.findByTestId('cross-chain-receive-amount-input')).toHaveValue('42');
    expect(screen.getByText('USDC on Solana')).toBeInTheDocument();
  });

  it('names the remembered network before the routes arrive', async () => {
    setLastUsdReceiveRoute({ asset: 'USDC', chain: 'solana' });
    const client = withCrossChainReceive([usdcOn('solana'), usdcOn('base')]);
    // Held in flight, so the chip has only what was remembered to go on.
    client.getCrossChainRoutes = vi.fn(() => new Promise<CrossChainRoutePair[]>(() => {}));
    await openUsdTab(client);

    expect(await screen.findByTestId('cross-chain-receive-route-chip'))
      .toHaveTextContent('USDC on Solana');
  });

  it('asks again when the remembered network is no longer offered', async () => {
    setLastUsdReceiveRoute({ asset: 'USDC', chain: 'solana' });
    const client = withCrossChainReceive([usdcOn('base')]);
    await openUsdTab(client);

    await waitFor(() => expect(screen.getByTestId('cross-chain-receive-route-chip'))
      .toHaveTextContent('Select network'));
  });

  it('skips the picker when a network is remembered', async () => {
    setLastUsdReceiveRoute({ asset: 'USDC', chain: 'solana' });
    const client = withCrossChainReceive([usdcOn('solana'), usdcOn('base')]);
    await openUsdTab(client);

    expect(await screen.findByText('USDC on Solana')).toBeInTheDocument();
    fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));

    await screen.findByTestId('cross-chain-deposit-address');
    expect(screen.queryByText('Select Network for USDC')).toBeNull();
  });
});

describe('USD receive amount', () => {
  it('accepts a comma as the decimal separator', async () => {
    const client = createMockClient() as unknown as BreezSdk;

    render(
      <ToastProvider>
        <WalletProvider client={client} isConnected>
          <FiatDataProvider>
            <StableBalanceProvider>
              <ReceivePaymentDialog isOpen onClose={vi.fn()} />
            </StableBalanceProvider>
          </FiatDataProvider>
        </WalletProvider>
      </ToastProvider>,
    );
    await waitForSheetOpen();

    fireEvent.click(screen.getByTestId('usd-tab'));
    const amount = await screen.findByTestId('cross-chain-receive-amount-input');
    fireEvent.change(amount, { target: { value: '5,50' } });

    expect(amount).toHaveValue('5.50');
    expect(screen.getByTestId('cross-chain-receive-continue')).toBeEnabled();
  });
});

describe('USD receive when the routes do not arrive', () => {
  beforeEach(() => localStorage.clear());
  // The backoff is jumped rather than waited out, and react-modal-sheet's own
  // 50ms open poll is why the clock still has to run on its own.

  // Three attempts, spaced by the workflow's backoff, before it gives up.
  const exhaustRetries = async (client: BreezSdk) => {
    await waitFor(() => expect(client.getCrossChainRoutes).toHaveBeenCalledTimes(1));
    for (const calls of [2, 3]) {
      await vi.advanceTimersByTimeAsync(6_000);
      await waitFor(() => expect(client.getCrossChainRoutes).toHaveBeenCalledTimes(calls));
    }
  };

  it('retries, then says so rather than spinning at a fetch that ended', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const client = withCrossChainReceive([]);
      client.getCrossChainRoutes = vi.fn().mockRejectedValue(new Error('offline'));
      await openUsdTab(client);
      await exhaustRetries(client);

      const chip = await screen.findByTestId('cross-chain-receive-route-chip');
      expect(chip).toHaveTextContent('Networks unavailable');
      expect(chip).not.toHaveTextContent('Loading networks');
      // Tappable, because it is the way back: the CTA below it is not.
      expect(chip).toBeEnabled();
      expect(screen.getByText('Could not load the networks. Please try again.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the CTA shut while there is no network to send to', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const client = withCrossChainReceive([]);
      client.getCrossChainRoutes = vi.fn().mockRejectedValue(new Error('offline'));
      await openUsdTab(client);
      await exhaustRetries(client);

      fireEvent.change(screen.getByTestId('cross-chain-receive-amount-input'), { target: { value: '50' } });
      expect(screen.getByTestId('cross-chain-receive-continue')).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers on a tap once the routes come back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Remembered, so the recovered chip has a name to go back to. The failed
      // state hides it meanwhile: nothing has confirmed the route still runs.
      setLastUsdReceiveRoute({ asset: 'USDC', chain: 'base' });
      const client = withCrossChainReceive([]);
      client.getCrossChainRoutes = vi.fn().mockRejectedValue(new Error('offline'));
      await openUsdTab(client);
      await exhaustRetries(client);
      expect(screen.getByTestId('cross-chain-receive-route-chip')).toHaveTextContent('Networks unavailable');

      client.getCrossChainRoutes = vi.fn().mockResolvedValue([usdcOn('base')]);
      fireEvent.click(screen.getByTestId('cross-chain-receive-route-chip'));

      await waitFor(() =>
        expect(screen.getByTestId('cross-chain-receive-route-chip')).toHaveTextContent('USDC on Base'));
      expect(screen.queryByText('Could not load the networks. Please try again.')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // An empty list is the same dead end as a refused request, and used to leave
  // the chip spinning at a fetch that had returned.
  it('treats an empty route list as a failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const client = withCrossChainReceive([]);
      await openUsdTab(client);
      await exhaustRetries(client);

      expect(await screen.findByTestId('cross-chain-receive-route-chip'))
        .toHaveTextContent('Networks unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
});
