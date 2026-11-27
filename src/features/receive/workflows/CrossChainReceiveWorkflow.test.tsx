import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BreezSdk, CrossChainRoutePair, ReceivePaymentRequest } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import ReceivePaymentDialog from '../ReceivePaymentDialog';

const usdcOn = (chain: string): CrossChainRoutePair => ({
  provider: 'orchestra',
  chain,
  asset: 'USDC',
  decimals: 6,
  exactOutEligible: false,
  acceptedAssets: [{ asset: { type: 'bitcoin' } }],
  deliveryMethods: ['spark'],
}) as unknown as CrossChainRoutePair;

/** Walks the USD tab to the deposit address, with the quote the SDK answers with. */
async function openDepositAddress(quote: { expectedReceivedAmount: bigint; tokenIdentifier?: string }) {
  const client = createMockClient() as unknown as BreezSdk;
  client.getCrossChainRoutes = vi.fn().mockResolvedValue([usdcOn('solana'), usdcOn('base')]);
  const receive = client.receivePayment.bind(client);
  client.receivePayment = vi.fn().mockImplementation(async (request: ReceivePaymentRequest) =>
    request.paymentMethod.type === 'crossChain'
      ? {
          paymentRequest: 'solana:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
          fee: 0n,
          crossChainInfo: {
            depositAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
            depositAmount: 10_050_000n,
            destinationAsset: 'BTC',
            serviceFeeAmount: 10_000n,
            serviceFeeAsset: 'USDC',
            expiresAt: 1_900_000_000,
            ...quote,
          },
        }
      : receive(request),
  );

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
  fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '10' } });
  fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));
  fireEvent.click(await screen.findByText('Solana'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByTestId('cross-chain-deposit-address');
}

describe('USD receive deposit address', () => {
  it('steps back to the network choice from the header arrow', async () => {
    await openDepositAddress({ expectedReceivedAmount: 12_298n });

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));

    expect(await screen.findByText('Select Network for USDC')).toBeInTheDocument();
    expect(screen.queryByTestId('cross-chain-deposit-address')).toBeNull();
  });

  // The line once rendered only "You'll receive": the amount sat in a value the
  // string never used. Both payout kinds are checked, since each has its own branch.
  it('shows a sats payout through SatAmount', async () => {
    await openDepositAddress({ expectedReceivedAmount: 12_298n });

    const line = screen.getByText(/You'll receive/);
    expect(line).toHaveTextContent("You'll receive ~₿12 298");
    expect(line.querySelector('[class*="word-spacing"]')).not.toBeNull();
  });

  it('shows a dollar payout as text', async () => {
    await openDepositAddress({ expectedReceivedAmount: 9_900_000n, tokenIdentifier: 'btkn1usdb' });

    expect(screen.getByText(/You'll receive/)).toHaveTextContent(/You'll receive ~\$9\.9/);
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

describe('USD receive routes', () => {
  it('says USD payments are disabled, without the SDK config hint', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    client.getCrossChainRoutes = vi.fn().mockRejectedValue(
      new Error('Cross-chain payments are disabled: set the cross-chain config to enable them'),
    );

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
    fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));

    expect(await screen.findByText('USD payments are disabled')).toBeInTheDocument();
    expect(screen.queryByText(/cross-chain config/)).toBeNull();
  });
});
