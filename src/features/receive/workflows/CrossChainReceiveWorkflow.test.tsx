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

describe('USD receive deposit address', () => {
  it('steps back to the network choice from the header arrow', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));

    expect(await screen.findByText('Select Network for USDC')).toBeInTheDocument();
    expect(screen.queryByTestId('cross-chain-deposit-address')).toBeNull();
  });
});
